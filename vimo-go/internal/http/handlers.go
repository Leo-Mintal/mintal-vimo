package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"

	"mintal-vimo/vimo-go/internal/agent"
	"mintal-vimo/vimo-go/internal/records"
)

type Handler struct {
	agent   *agent.Service
	records *records.Service
}

func NewHandler(agentService *agent.Service, recordsService *records.Service) *Handler {
	return &Handler{agent: agentService, records: recordsService}
}

func (h *Handler) Health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) AgentModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": h.agent.ModelOptions()})
}

func (h *Handler) AgentMessage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req agent.AnalyzeRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := h.agent.Analyze(r.Context(), req)
	if err != nil {
		writeLoggedError(w, http.StatusBadGateway, "agent analyze failed", err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"message": map[string]string{
			"role":    "assistant",
			"content": result.Reply,
		},
		"record_preview": result,
	})
}

func (h *Handler) AgentFastReplyStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req agent.AnalyzeRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming is not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	result, err := h.agent.StreamFastReply(r.Context(), req, func(delta string) error {
		return writeSSE(w, flusher, "fast_delta", map[string]string{"delta": delta})
	})
	if err != nil {
		log.Printf("agent fast reply failed: %v", err)
		_ = writeSSE(w, flusher, "fast_error", map[string]string{"message": publicErrorMessage(http.StatusBadGateway)})
	}
	route := agent.FastReplyRouteContinueSlow
	if result != nil {
		route = result.Route
	}
	_ = writeSSE(w, flusher, "fast_done", map[string]any{"ok": true, "route": route})
}

func (h *Handler) AgentMessageStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req agent.AnalyzeRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming is not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	type analyzeResult struct {
		result *agent.Result
		err    error
	}
	slowDone := make(chan analyzeResult, 1)
	go func() {
		result, err := h.agent.Analyze(r.Context(), req)
		slowDone <- analyzeResult{result: result, err: err}
	}()

	var writeMu sync.Mutex
	writeEvent := func(event string, value any) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return writeSSE(w, flusher, event, value)
	}

	fastResult, err := h.agent.StreamFastReply(r.Context(), req, func(delta string) error {
		return writeEvent("fast_delta", map[string]string{"delta": delta})
	})
	if err != nil {
		log.Printf("agent fast reply failed: %v", err)
		_ = writeEvent("error", map[string]string{"message": publicErrorMessage(http.StatusBadGateway)})
		return
	}
	fastRoute := agent.FastReplyRouteContinueSlow
	if fastResult != nil {
		fastRoute = fastResult.Route
	}
	if err := writeEvent("fast_done", map[string]any{"ok": true, "route": fastRoute}); err != nil {
		return
	}
	if fastRoute == agent.FastReplyRouteChatOnly {
		_ = writeEvent("done", map[string]bool{"ok": true})
		return
	}

	slow := <-slowDone
	if slow.err != nil {
		log.Printf("agent analyze failed: %v", slow.err)
		_ = writeEvent("error", map[string]string{"message": publicErrorMessage(http.StatusBadGateway)})
		return
	}

	if err := writeEvent("final", map[string]any{
		"message": map[string]string{
			"role":    "assistant",
			"content": slow.result.Reply,
		},
		"record_preview": slow.result,
	}); err != nil {
		return
	}
	_ = writeEvent("done", map[string]bool{"ok": true})
}

func (h *Handler) Records(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.listRecords(w, r)
	case http.MethodPost:
		h.createRecord(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *Handler) RecordByID(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/records/")
	id = strings.TrimSpace(id)
	if id == "" {
		writeError(w, http.StatusNotFound, "record not found")
		return
	}

	switch r.Method {
	case http.MethodPatch:
		h.updateRecord(w, r, id)
	case http.MethodDelete:
		if err := h.records.Delete(r.Context(), id); err != nil {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *Handler) listRecords(w http.ResponseWriter, r *http.Request) {
	list, err := h.records.List(r.Context(), records.ListFilter{
		Type:   r.URL.Query().Get("type"),
		Status: r.URL.Query().Get("status"),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"records": list})
}

func (h *Handler) createRecord(w http.ResponseWriter, r *http.Request) {
	var req records.CreateInput
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	record, err := h.records.Create(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"record": record})
}

func (h *Handler) updateRecord(w http.ResponseWriter, r *http.Request, id string) {
	var req records.UpdateInput
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	record, err := h.records.Update(r.Context(), id, req)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"record": record})
}

func readJSON(r *http.Request, target any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			return errors.New("request body is too large")
		}
		return err
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return errors.New("request body must contain one JSON object")
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	if status >= http.StatusInternalServerError {
		message = publicErrorMessage(status)
	}
	writeJSON(w, status, map[string]any{
		"error": map[string]string{
			"message": message,
		},
	})
}

func writeLoggedError(w http.ResponseWriter, status int, context string, err error) {
	if err != nil {
		log.Printf("%s: %v", context, err)
	}
	writeError(w, status, publicErrorMessage(status))
}

func publicErrorMessage(status int) string {
	switch status {
	case http.StatusBadGateway:
		return "model service request failed"
	case http.StatusInternalServerError:
		return "internal server error"
	default:
		return http.StatusText(status)
	}
}

func writeSSE(w io.Writer, flusher http.Flusher, event string, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "event: %s\n", event); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "data: %s\n\n", payload); err != nil {
		return err
	}
	flusher.Flush()
	return nil
}
