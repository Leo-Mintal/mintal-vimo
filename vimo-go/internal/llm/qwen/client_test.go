package qwen

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"mintal-vimo/vimo-go/internal/config"
	"mintal-vimo/vimo-go/internal/llm"
)

func TestChatCompletionsURL(t *testing.T) {
	tests := []struct {
		name string
		base string
		want string
	}{
		{
			name: "domain base url",
			base: "https://api.example.com",
			want: "https://api.example.com/v1/chat/completions",
		},
		{
			name: "openai compatible v1 base url",
			base: "https://api.example.com/v1",
			want: "https://api.example.com/v1/chat/completions",
		},
		{
			name: "trailing slash",
			base: "https://api.example.com/v1/",
			want: "https://api.example.com/v1/chat/completions",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := chatCompletionsURL(tt.base); got != tt.want {
				t.Fatalf("chatCompletionsURL(%q) = %q, want %q", tt.base, got, tt.want)
			}
		})
	}
}

func TestStreamChatReadsOpenAICompatibleDeltas(t *testing.T) {
	var streamEnabled bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("path = %s, want /v1/chat/completions", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		streamEnabled, _ = body["stream"].(bool)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"我先\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"处理\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	client := NewClient(config.ProviderConfig{
		BaseURL:   server.URL,
		ChatModel: "test-model",
	})
	var chunks []string
	err := client.StreamChat(context.Background(), llm.ChatRequest{
		Messages: []llm.Message{{Role: "user", Content: "hello"}},
	}, func(delta string) error {
		chunks = append(chunks, delta)
		return nil
	})

	if err != nil {
		t.Fatalf("StreamChat() error = %v", err)
	}
	if !streamEnabled {
		t.Fatal("request stream = false, want true")
	}
	if got := strings.Join(chunks, ""); got != "我先处理" {
		t.Fatalf("chunks = %q, want 我先处理", got)
	}
}

func TestChatSendsResponseFormat(t *testing.T) {
	var responseFormat map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("path = %s, want /v1/chat/completions", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		responseFormat, _ = body["response_format"].(map[string]any)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"{\"text\":\"你好\",\"route\":\"chat_only\"}"}}]}`))
	}))
	defer server.Close()

	client := NewClient(config.ProviderConfig{
		BaseURL:   server.URL,
		ChatModel: "test-model",
	})
	_, err := client.Chat(context.Background(), llm.ChatRequest{
		Messages:       []llm.Message{{Role: "user", Content: "hello"}},
		ResponseFormat: &llm.ResponseFormat{Type: "json_object"},
	})

	if err != nil {
		t.Fatalf("Chat() error = %v", err)
	}
	if responseFormat["type"] != "json_object" {
		t.Fatalf("response_format = %#v, want json_object", responseFormat)
	}
}

func TestChatSendsThinkingAndReadsReasoning(t *testing.T) {
	var enableThinking any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("path = %s, want /v1/chat/completions", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		enableThinking = body["enable_thinking"]
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"{\"text\":\"你好\",\"route\":\"chat_only\"}","reasoning_content":"先判断这是闲聊。"}}]}`))
	}))
	defer server.Close()

	client := NewClient(config.ProviderConfig{
		BaseURL:   server.URL,
		ChatModel: "test-model",
	})
	resp, err := client.Chat(context.Background(), llm.ChatRequest{
		Messages: []llm.Message{{Role: "user", Content: "hello"}},
		Thinking: &llm.ThinkingOptions{Enabled: true},
	})

	if err != nil {
		t.Fatalf("Chat() error = %v", err)
	}
	if enableThinking != true {
		t.Fatalf("enable_thinking = %#v, want true", enableThinking)
	}
	if resp.Reasoning != "先判断这是闲聊。" {
		t.Fatalf("Reasoning = %q, want provider reasoning", resp.Reasoning)
	}
}

func TestChatErrorDoesNotExposeResponseBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"upstream private diagnostic"}`))
	}))
	defer server.Close()

	client := NewClient(config.ProviderConfig{
		BaseURL:   server.URL,
		ChatModel: "test-model",
	})
	_, err := client.Chat(context.Background(), llm.ChatRequest{
		Messages: []llm.Message{{Role: "user", Content: "hello"}},
	})

	if err == nil {
		t.Fatal("Chat() error = nil, want error")
	}
	if strings.Contains(err.Error(), "upstream private diagnostic") {
		t.Fatalf("error exposed upstream body: %v", err)
	}
	if !strings.Contains(err.Error(), "status 401") {
		t.Fatalf("error = %v, want status code", err)
	}
}

func TestStreamChatErrorDoesNotExposeResponseBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"upstream private diagnostic"}`))
	}))
	defer server.Close()

	client := NewClient(config.ProviderConfig{
		BaseURL:   server.URL,
		ChatModel: "test-model",
	})
	err := client.StreamChat(context.Background(), llm.ChatRequest{
		Messages: []llm.Message{{Role: "user", Content: "hello"}},
	}, func(string) error {
		return nil
	})

	if err == nil {
		t.Fatal("StreamChat() error = nil, want error")
	}
	if strings.Contains(err.Error(), "upstream private diagnostic") {
		t.Fatalf("error exposed upstream body: %v", err)
	}
	if !strings.Contains(err.Error(), "status 401") {
		t.Fatalf("error = %v, want status code", err)
	}
}
