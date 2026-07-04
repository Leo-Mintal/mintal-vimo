package qwen

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"mintal-vimo/vimo-go/internal/config"
	"mintal-vimo/vimo-go/internal/llm"
)

type Client struct {
	baseURL string
	apiKey  string
	model   string
	params  config.ModelParams
	http    *http.Client
}

func NewClient(cfg config.ProviderConfig) *Client {
	timeout := time.Duration(cfg.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	return &Client{
		baseURL: strings.TrimRight(cfg.BaseURL, "/"),
		apiKey:  cfg.APIKey,
		model:   cfg.ChatModel,
		params:  cfg.DefaultParams,
		http: &http.Client{
			Timeout: timeout,
		},
	}
}

func (c *Client) Chat(ctx context.Context, req llm.ChatRequest) (*llm.ChatResponse, error) {
	if c.baseURL == "" {
		return nil, fmt.Errorf("model base_url is empty")
	}
	if c.model == "" {
		return nil, fmt.Errorf("chat model is empty")
	}

	body := chatCompletionRequest{
		Model:          c.model,
		Messages:       req.Messages,
		Temperature:    firstFloat(req.Temperature, c.params.Temperature),
		TopP:           firstFloat(req.TopP, c.params.TopP),
		MaxTokens:      firstInt(req.MaxTokens, c.params.MaxTokens),
		ResponseFormat: req.ResponseFormat,
		Stream:         false,
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, chatCompletionsURL(c.baseURL), bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("model request failed with status %d", resp.StatusCode)
	}

	var parsed chatCompletionResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("decode model response: %w", err)
	}
	if len(parsed.Choices) == 0 {
		return nil, fmt.Errorf("model returned no choices")
	}
	return &llm.ChatResponse{
		Content: parsed.Choices[0].Message.Content,
		Raw:     raw,
	}, nil
}

func (c *Client) StreamChat(ctx context.Context, req llm.ChatRequest, onDelta func(string) error) error {
	if c.baseURL == "" {
		return fmt.Errorf("model base_url is empty")
	}
	if c.model == "" {
		return fmt.Errorf("chat model is empty")
	}
	if onDelta == nil {
		return fmt.Errorf("stream delta callback is required")
	}

	body := chatCompletionRequest{
		Model:          c.model,
		Messages:       req.Messages,
		Temperature:    firstFloat(req.Temperature, c.params.Temperature),
		TopP:           firstFloat(req.TopP, c.params.TopP),
		MaxTokens:      firstInt(req.MaxTokens, c.params.MaxTokens),
		ResponseFormat: req.ResponseFormat,
		Stream:         true,
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, chatCompletionsURL(c.baseURL), bytes.NewReader(payload))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	if c.apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("model stream request failed with status %d", resp.StatusCode)
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var event strings.Builder
	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" {
			if err := handleStreamEvent(event.String(), onDelta); err != nil {
				return err
			}
			event.Reset()
			continue
		}
		event.WriteString(line)
		event.WriteByte('\n')
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read model stream: %w", err)
	}
	if strings.TrimSpace(event.String()) != "" {
		if err := handleStreamEvent(event.String(), onDelta); err != nil {
			return err
		}
	}
	return nil
}

type chatCompletionRequest struct {
	Model          string              `json:"model"`
	Messages       []llm.Message       `json:"messages"`
	Temperature    *float64            `json:"temperature,omitempty"`
	TopP           *float64            `json:"top_p,omitempty"`
	MaxTokens      *int                `json:"max_tokens,omitempty"`
	ResponseFormat *llm.ResponseFormat `json:"response_format,omitempty"`
	Stream         bool                `json:"stream"`
}

type chatCompletionResponse struct {
	Choices []struct {
		Message llm.Message `json:"message"`
	} `json:"choices"`
}

type chatCompletionStreamResponse struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
	} `json:"choices"`
}

func handleStreamEvent(event string, onDelta func(string) error) error {
	for _, line := range strings.Split(event, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, ":") || !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" {
			continue
		}
		if data == "[DONE]" {
			return nil
		}
		var parsed chatCompletionStreamResponse
		if err := json.Unmarshal([]byte(data), &parsed); err != nil {
			return fmt.Errorf("decode model stream event: %w", err)
		}
		for _, choice := range parsed.Choices {
			if choice.Delta.Content == "" {
				continue
			}
			if err := onDelta(choice.Delta.Content); err != nil {
				return err
			}
		}
	}
	return nil
}

func firstFloat(values ...*float64) *float64 {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func firstInt(values ...*int) *int {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func chatCompletionsURL(baseURL string) string {
	baseURL = strings.TrimRight(baseURL, "/")
	if strings.HasSuffix(baseURL, "/v1") {
		return baseURL + "/chat/completions"
	}
	return baseURL + "/v1/chat/completions"
}
