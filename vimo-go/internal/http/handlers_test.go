package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"mintal-vimo/vimo-go/internal/agent"
	"mintal-vimo/vimo-go/internal/config"
	"mintal-vimo/vimo-go/internal/records"
)

func TestAgentMessageStreamOrdersThinkingBeforeReplies(t *testing.T) {
	modelServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode model request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		if _, ok := request["response_format"]; ok {
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"text\":\"快路回复。\",\"route\":\"continue_slow\"}","reasoning_content":"快路思考。"}}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"type\":\"unknown\",\"title\":\"聊天\",\"content\":\"用户在聊天\",\"datetime_text\":null,\"datetime_iso\":null,\"need_reminder\":false,\"confidence\":0.9,\"status\":\"ready\",\"missing_fields\":[],\"intent\":\"answer_query\",\"record_action\":\"none\",\"should_preview\":false,\"reply\":\"慢路回复。\"}","reasoning_content":"慢路思考。"}}]}`))
	}))
	defer modelServer.Close()

	registry, err := agent.NewModelRegistry(config.ModelConfig{
		ActiveProvider: "model",
		Providers: map[string]config.ProviderConfig{
			"model": {
				Type:             "openai_compatible",
				BaseURL:          modelServer.URL,
				ChatModel:        "mock",
				SupportsThinking: true,
			},
		},
	})
	if err != nil {
		t.Fatalf("NewModelRegistry() error = %v", err)
	}
	service := agent.NewServiceWithPrompts(registry, "system", "fast")
	handler := NewHandler(service, records.NewService(records.NewMemoryRepository()))
	body := bytes.NewBufferString(`{"message":"你好","timezone":"Asia/Shanghai","thinking":{"enabled":true}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/agent/messages/stream", body)
	rec := httptest.NewRecorder()

	handler.AgentMessageStream(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	payload := rec.Body.String()
	assertEventOrder(t, payload, []string{"fast_thinking", "fast_delta", "slow_thinking", "final", "done"})
}

func assertEventOrder(t *testing.T, payload string, events []string) {
	t.Helper()
	last := -1
	for _, event := range events {
		index := strings.Index(payload, "event: "+event+"\n")
		if index < 0 {
			t.Fatalf("event %q not found in payload:\n%s", event, payload)
		}
		if index <= last {
			t.Fatalf("event %q appears out of order in payload:\n%s", event, payload)
		}
		last = index
	}
}
