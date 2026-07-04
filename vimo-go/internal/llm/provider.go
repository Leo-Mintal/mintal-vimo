package llm

import "context"

type Provider interface {
	Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error)
}

type StreamProvider interface {
	StreamChat(ctx context.Context, req ChatRequest, onDelta func(string) error) error
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatRequest struct {
	Messages       []Message       `json:"messages"`
	Temperature    *float64        `json:"temperature,omitempty"`
	TopP           *float64        `json:"top_p,omitempty"`
	MaxTokens      *int            `json:"max_tokens,omitempty"`
	ResponseFormat *ResponseFormat `json:"response_format,omitempty"`
	Stream         bool            `json:"stream"`
}

type ChatResponse struct {
	Content string
	Raw     []byte
}

type ResponseFormat struct {
	Type string `json:"type"`
}
