package httpapi

import (
	"bytes"
	"context"
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
		if isFastModelRequest(request) {
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
	assertProgressTypes(t, payload, []string{
		"run.started",
		"fast_reply.started",
		"fast_reply.completed",
		"analyze.started",
		"model.requested",
		"model.completed",
		"preview.created",
		"action.planned",
		"run.completed",
	})
}

func TestAgentMessageStreamChatOnlyCompletesAfterFastRoute(t *testing.T) {
	modelServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"text\":\"当然冷，你都在冻人了。\",\"route\":\"chat_only\"}","reasoning_content":"快路思考。"}}]}`))
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
	handler := NewHandler(agent.NewServiceWithPrompts(registry, "system", "fast"), records.NewService(records.NewMemoryRepository()))
	body := bytes.NewBufferString(`{"message":"你怎么这么冷漠","timezone":"Asia/Shanghai","thinking":{"enabled":true}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/agent/messages/stream", body)
	rec := httptest.NewRecorder()

	handler.AgentMessageStream(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	payload := rec.Body.String()
	assertEventOrder(t, payload, []string{"fast_thinking", "fast_delta", "fast_done", "done"})
	assertProgressTypes(t, payload, []string{
		"run.started",
		"fast_reply.started",
		"fast_reply.completed",
		"run.completed",
	})
	assertProgressTypeOrder(t, payload, []string{"run.started", "fast_reply.started", "fast_reply.completed", "run.completed"})
	if strings.Contains(payload, "event: final\n") {
		t.Fatalf("chat_only should not emit slow final event:\n%s", payload)
	}
}

func TestAgentMessageStreamExecutesReadyCreateRecord(t *testing.T) {
	modelServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode model request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		if isFastModelRequest(request) {
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"text\":\"我记一下。\",\"route\":\"continue_slow\"}"}}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"type\":\"todo\",\"title\":\"开会\",\"content\":\"开会\",\"datetime_text\":\"明天 09:00\",\"datetime_iso\":\"2026-07-07 09:00:00\",\"need_reminder\":true,\"confidence\":0.96,\"field_confidence\":{\"type\":0.96,\"content\":0.96,\"datetime\":0.96,\"need_reminder\":0.96},\"field_risk\":{\"datetime\":\"high\",\"need_reminder\":\"high\"},\"status\":\"ready\",\"missing_fields\":[],\"intent\":\"new_record\",\"record_action\":\"create\",\"should_preview\":true,\"reply\":\"已为你整理好。\"}"}}]}`))
	}))
	defer modelServer.Close()

	registry, err := agent.NewModelRegistry(config.ModelConfig{
		ActiveProvider: "model",
		Providers: map[string]config.ProviderConfig{
			"model": {
				Type:      "openai_compatible",
				BaseURL:   modelServer.URL,
				ChatModel: "mock",
			},
		},
	})
	if err != nil {
		t.Fatalf("NewModelRegistry() error = %v", err)
	}
	recordService := records.NewService(records.NewMemoryRepository())
	handler := NewHandler(agent.NewServiceWithPrompts(registry, "system", "fast"), recordService)
	body := bytes.NewBufferString(`{"message":"明天九点提醒我开会","timezone":"Asia/Shanghai"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/agent/messages/stream", body)
	rec := httptest.NewRecorder()

	handler.AgentMessageStream(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	payload := rec.Body.String()
	assertEventOrder(t, payload, []string{"record_execution", "final", "done"})
	assertProgressTypes(t, payload, []string{"record.create.completed"})
	recordsList, err := recordService.List(req.Context(), records.ListFilter{})
	if err != nil {
		t.Fatalf("list records: %v", err)
	}
	if len(recordsList) != 1 {
		t.Fatalf("records len = %d, want 1; payload:\n%s", len(recordsList), payload)
	}
	if recordsList[0].Status != "saved" || recordsList[0].Title != "开会" {
		t.Fatalf("record = %#v", recordsList[0])
	}
}

func TestAgentMessageStreamKeepsPendingDeleteFromBecomingCreate(t *testing.T) {
	modelServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode model request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		if isFastModelRequest(request) {
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"text\":\"我来处理这次删除。\",\"route\":\"continue_slow\"}"}}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"type\":\"todo\",\"title\":\"删除剩余的早餐记录\",\"content\":\"删除剩余的早餐记录\",\"datetime_text\":null,\"datetime_iso\":null,\"need_reminder\":false,\"confidence\":0.95,\"field_confidence\":{\"type\":0.95,\"content\":0.95,\"target\":0.95},\"field_risk\":{\"target\":\"high\"},\"status\":\"ready\",\"missing_fields\":[],\"intent\":\"confirm_pending\",\"record_action\":\"create\",\"context_target_id\":\"pending_delete_breakfast\",\"should_preview\":true,\"reply\":\"我会删除这两条早餐记录。\"}"}}]}`))
	}))
	defer modelServer.Close()

	registry, err := agent.NewModelRegistry(config.ModelConfig{
		ActiveProvider: "model",
		Providers: map[string]config.ProviderConfig{
			"model": {
				Type:      "openai_compatible",
				BaseURL:   modelServer.URL,
				ChatModel: "mock",
			},
		},
	})
	if err != nil {
		t.Fatalf("NewModelRegistry() error = %v", err)
	}
	recordService := records.NewService(records.NewMemoryRepository())
	for _, id := range []string{"rec_breakfast_today", "rec_breakfast_yesterday"} {
		if _, err := recordService.Create(context.Background(), records.CreateInput{
			ID:           id,
			Type:         "todo",
			Title:        "吃早餐",
			Content:      "吃早餐",
			NeedReminder: false,
			Confidence:   0.95,
			Status:       "saved",
		}); err != nil {
			t.Fatalf("create record %s: %v", id, err)
		}
	}
	handler := NewHandler(agent.NewServiceWithPrompts(registry, "system", "fast"), recordService)
	body := bytes.NewBufferString(`{
		"message":"确认删除",
		"timezone":"Asia/Shanghai",
		"open_contexts":[{
			"id":"pending_delete_breakfast",
			"layer":"open",
			"context_kind":"pending_delete",
			"type":"todo",
			"title":"删除剩余的早餐记录",
			"content":"删除剩余的早餐记录",
			"need_reminder":false,
			"status":"need_confirmation",
			"intent":"delete_record",
			"record_action":"delete",
			"target_id":null,
			"related_ids":["rec_breakfast_today","rec_breakfast_yesterday"],
			"missing_fields":["target"],
			"pending_state":"waiting_field"
		}]
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/agent/messages/stream", body)
	rec := httptest.NewRecorder()

	handler.AgentMessageStream(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	payload := rec.Body.String()
	if strings.Contains(payload, "event: record_execution\n") || strings.Contains(payload, "record.create.completed") {
		t.Fatalf("pending multi-delete should not create or auto-execute:\n%s", payload)
	}
	if !strings.Contains(payload, `"record_action":"delete"`) {
		t.Fatalf("payload = %s, want final preview delete action", payload)
	}
	if !strings.Contains(payload, `"related_ids":["rec_breakfast_today","rec_breakfast_yesterday"]`) {
		t.Fatalf("payload = %s, want pending delete targets preserved", payload)
	}
	recordsList, err := recordService.List(req.Context(), records.ListFilter{})
	if err != nil {
		t.Fatalf("list records: %v", err)
	}
	if len(recordsList) != 2 {
		t.Fatalf("records len = %d, want original 2; payload:\n%s", len(recordsList), payload)
	}
	for _, record := range recordsList {
		if record.Status != "saved" {
			t.Fatalf("record %s status = %q, want saved", record.ID, record.Status)
		}
	}
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

func isFastModelRequest(request map[string]any) bool {
	messages, ok := request["messages"].([]any)
	if !ok || len(messages) == 0 {
		return false
	}
	first, ok := messages[0].(map[string]any)
	if !ok {
		return false
	}
	content, _ := first["content"].(string)
	return strings.TrimSpace(content) == "fast"
}

func assertProgressTypes(t *testing.T, payload string, expected []string) {
	t.Helper()
	events := parseSSEPayload(t, payload)
	var got []string
	for _, event := range events {
		if event.Name != "progress" {
			continue
		}
		var progress struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal([]byte(event.Data), &progress); err != nil {
			t.Fatalf("decode progress event: %v\n%s", err, event.Data)
		}
		got = append(got, progress.Type)
	}
	for _, eventType := range expected {
		found := false
		for _, item := range got {
			if item == eventType {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("progress type %q not found; got %#v\npayload:\n%s", eventType, got, payload)
		}
	}
}

func assertProgressTypeOrder(t *testing.T, payload string, expected []string) {
	t.Helper()
	events := parseSSEPayload(t, payload)
	progressIndex := 0
	for _, event := range events {
		if event.Name != "progress" {
			continue
		}
		var progress struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal([]byte(event.Data), &progress); err != nil {
			t.Fatalf("decode progress event: %v\n%s", err, event.Data)
		}
		if progressIndex < len(expected) && progress.Type == expected[progressIndex] {
			progressIndex++
		}
	}
	if progressIndex != len(expected) {
		t.Fatalf("progress order %v not found in payload:\n%s", expected, payload)
	}
}

type parsedSSEEvent struct {
	Name string
	Data string
}

func parseSSEPayload(t *testing.T, payload string) []parsedSSEEvent {
	t.Helper()
	var events []parsedSSEEvent
	for _, chunk := range strings.Split(strings.TrimSpace(payload), "\n\n") {
		if strings.TrimSpace(chunk) == "" {
			continue
		}
		event := parsedSSEEvent{Name: "message"}
		var data []string
		for _, line := range strings.Split(chunk, "\n") {
			if strings.HasPrefix(line, "event: ") {
				event.Name = strings.TrimSpace(strings.TrimPrefix(line, "event: "))
				continue
			}
			if strings.HasPrefix(line, "data: ") {
				data = append(data, strings.TrimPrefix(line, "data: "))
			}
		}
		event.Data = strings.Join(data, "\n")
		events = append(events, event)
	}
	return events
}
