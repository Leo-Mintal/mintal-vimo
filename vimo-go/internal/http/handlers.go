package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

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
		"thinking":       thinkingPayload("", result.Reasoning),
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

	result, err := h.agent.StreamFastReply(r.Context(), req, func(string) error {
		return nil
	})
	if err != nil {
		log.Printf("agent fast reply failed: %v", err)
		_ = writeSSE(w, flusher, "fast_error", map[string]string{"message": publicErrorMessage(http.StatusBadGateway)})
	}
	route := agent.FastReplyRouteContinueSlow
	if result != nil {
		route = result.Route
		if strings.TrimSpace(result.Reasoning) != "" {
			_ = writeSSE(w, flusher, "fast_thinking", map[string]string{"content": result.Reasoning})
		}
		_ = writeSSE(w, flusher, "fast_delta", map[string]string{"delta": result.Text})
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

	turnID := strings.TrimSpace(req.TurnID)
	if turnID == "" {
		turnID = fmt.Sprintf("turn-%d", time.Now().UnixNano())
		req.TurnID = turnID
	}
	var writeMu sync.Mutex
	writeEvent := func(event string, value any) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return writeSSE(w, flusher, event, value)
	}
	seq := 0
	writeProgressAt := func(eventType string, title string, status agent.ProgressStatus, detail string, payload any, createdAt time.Time) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		seq++
		return writeSSE(w, flusher, "progress", agent.NewProgressEvent(turnID, seq, eventType, title, status, detail, payload, createdAt))
	}
	writeProgress := func(eventType string, title string, status agent.ProgressStatus, detail string, payload any) error {
		return writeProgressAt(eventType, title, status, detail, payload, time.Now())
	}

	if err := writeProgress("run.started", "已接住输入", agent.ProgressStatusCompleted, "", nil); err != nil {
		return
	}

	if err := writeProgress("fast_reply.started", "快路开始生成", agent.ProgressStatusRunning, "", nil); err != nil {
		return
	}

	fastResult, err := h.agent.StreamFastReply(r.Context(), req, func(string) error {
		return nil
	})
	if err != nil {
		log.Printf("agent fast reply failed: %v", err)
		_ = writeProgress("run.failed", "生成失败", agent.ProgressStatusFailed, publicErrorMessage(http.StatusBadGateway), nil)
		_ = writeEvent("error", map[string]string{"message": publicErrorMessage(http.StatusBadGateway)})
		return
	}
	fastRoute := agent.FastReplyRouteContinueSlow
	if fastResult != nil {
		fastRoute = fastResult.Route
		if strings.TrimSpace(fastResult.Reasoning) != "" {
			if err := writeEvent("fast_thinking", map[string]string{"content": fastResult.Reasoning}); err != nil {
				return
			}
		}
		if err := writeEvent("fast_delta", map[string]string{"delta": fastResult.Text}); err != nil {
			return
		}
	}
	if err := writeEvent("fast_done", map[string]any{"ok": true, "route": fastRoute}); err != nil {
		return
	}
	if err := writeProgress("fast_reply.completed", "快路已完成", agent.ProgressStatusCompleted, "", map[string]any{"route": fastRoute}); err != nil {
		return
	}
	if fastRoute == agent.FastReplyRouteChatOnly {
		_ = writeProgress("run.completed", "本轮已完成", agent.ProgressStatusCompleted, "", map[string]any{"route": fastRoute})
		_ = writeEvent("done", map[string]bool{"ok": true})
		return
	}

	slowReq := req
	if fastResult != nil {
		slowReq.FastReplyContext = &agent.FastReplyContext{
			TurnID:  turnID,
			State:   "done",
			Content: strings.TrimSpace(fastResult.Text),
		}
	}
	slowResult, err := h.agent.AnalyzeWithHooks(r.Context(), slowReq, agent.AnalyzeHooks{
		OnAnalyzeStarted: func() {
			_ = writeProgress("analyze.started", "正在分析意图", agent.ProgressStatusRunning, "", nil)
		},
		OnModelRequested: func() {
			_ = writeProgress("model.requested", "慢路模型请求已发出", agent.ProgressStatusRunning, "", nil)
		},
		OnModelCompleted: func() {
			_ = writeProgress("model.completed", "慢路模型已返回", agent.ProgressStatusCompleted, "", nil)
		},
		OnPreviewCreated: func(result *agent.Result) {
			_ = writeProgress("preview.created", previewProgressTitle(result), agent.ProgressStatusCompleted, "", previewProgressPayload(result))
		},
	})
	if err != nil {
		log.Printf("agent analyze failed: %v", err)
		_ = writeProgress("run.failed", "生成失败", agent.ProgressStatusFailed, publicErrorMessage(http.StatusBadGateway), nil)
		_ = writeEvent("error", map[string]string{"message": publicErrorMessage(http.StatusBadGateway)})
		return
	}
	if strings.TrimSpace(slowResult.Reasoning) != "" {
		if err := writeEvent("slow_thinking", map[string]string{"content": slowResult.Reasoning}); err != nil {
			return
		}
	}
	actionTitle, actionStatus := actionProgressSummary(slowResult)
	if err := writeProgress("action.planned", actionTitle, actionStatus, "", actionProgressPayload(slowResult)); err != nil {
		return
	}
	execution, executionErr := h.executeRecordAction(r.Context(), slowResult)
	if executionErr != nil {
		log.Printf("agent record execution failed: %v", executionErr)
		_ = writeProgress(recordExecutionEventType(slowResult, "failed"), "记录执行失败", agent.ProgressStatusFailed, publicErrorMessage(http.StatusInternalServerError), actionProgressPayload(slowResult))
		_ = writeEvent("record_execution", agent.RecordExecutionEvent{
			Action: slowResult.RecordAction,
			Status: "failed",
			Error:  publicErrorMessage(http.StatusInternalServerError),
		})
		_ = writeEvent("error", map[string]string{"message": publicErrorMessage(http.StatusInternalServerError)})
		return
	}
	if execution != nil {
		if err := writeProgress(recordExecutionEventType(slowResult, "completed"), recordExecutionTitle(execution.Action), agent.ProgressStatusCompleted, "", map[string]any{"record_id": execution.Record.ID}); err != nil {
			return
		}
		if err := writeEvent("record_execution", agent.RecordExecutionEvent{
			Action: execution.Action,
			Status: "completed",
			Record: execution.Record,
		}); err != nil {
			return
		}
	}

	if err := writeEvent("final", map[string]any{
		"message": map[string]string{
			"role":    "assistant",
			"content": slowResult.Reply,
		},
		"record_preview": slowResult,
		"thinking":       thinkingPayload("", slowResult.Reasoning),
	}); err != nil {
		return
	}
	_ = writeProgress("run.completed", "本轮已完成", agent.ProgressStatusCompleted, "", map[string]any{"route": fastRoute})
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

type recordExecution struct {
	Action string
	Record *records.Record
}

func (h *Handler) executeRecordAction(ctx context.Context, result *agent.Result) (*recordExecution, error) {
	if result == nil || !shouldAutoExecuteResult(ctx, h.records, result) {
		return nil, nil
	}
	switch result.RecordAction {
	case "create":
		record, err := h.records.Create(ctx, createInputFromResult(result, ""))
		if err != nil {
			return nil, err
		}
		return &recordExecution{Action: "created", Record: record}, nil
	case "update":
		targetID := strings.TrimSpace(valueString(result.TargetID))
		if targetID == "" {
			return nil, nil
		}
		previous, err := h.records.Get(ctx, targetID)
		if err != nil {
			return nil, err
		}
		record, err := h.records.Update(ctx, targetID, updateInputFromResult(result, previous))
		if err != nil {
			return nil, err
		}
		action := "updated"
		if previous.Status == "discarded" {
			action = "restored"
		}
		return &recordExecution{Action: action, Record: record}, nil
	case "delete":
		targetID := deleteTargetID(result)
		if targetID == "" {
			return nil, nil
		}
		previous, err := h.records.Get(ctx, targetID)
		if err != nil {
			return nil, err
		}
		deletedStatus := "discarded"
		previousStatus := previous.Status
		if previousStatus == "discarded" || strings.TrimSpace(previousStatus) == "" {
			previousStatus = "saved"
		}
		deletedAt := time.Now().UTC().Format("2006-01-02 15:04:05")
		record, err := h.records.Update(ctx, targetID, records.UpdateInput{
			Status:         &deletedStatus,
			DeletedAt:      &deletedAt,
			PreviousStatus: &previousStatus,
		})
		if err != nil {
			return nil, err
		}
		return &recordExecution{Action: "deleted", Record: record}, nil
	default:
		return nil, nil
	}
}

func shouldAutoExecuteResult(ctx context.Context, recordsService *records.Service, result *agent.Result) bool {
	if result == nil || !result.ShouldPreview || result.RecordAction == "none" {
		return false
	}
	if result.Status != "ready" || len(result.MissingFields) > 0 {
		return false
	}
	if hasBlockingHardStopGate(result) {
		return false
	}
	if result.NeedReminder && result.DatetimeISO == nil {
		return false
	}
	if !passesDefaultRiskMatrix(result) {
		return false
	}
	switch result.RecordAction {
	case "create":
		return true
	case "update":
		targetID := strings.TrimSpace(valueString(result.TargetID))
		if targetID == "" {
			return false
		}
		_, err := recordsService.Get(ctx, targetID)
		return err == nil
	case "delete":
		targetID := deleteTargetID(result)
		if targetID == "" || len(result.RelatedIDs) > 1 {
			return false
		}
		record, err := recordsService.Get(ctx, targetID)
		return err == nil && record.Status != "discarded"
	default:
		return false
	}
}

func hasBlockingHardStopGate(result *agent.Result) bool {
	if result.IntentTrace == nil {
		return false
	}
	for _, reason := range result.IntentTrace.GateReasons {
		switch reason {
		case "hard_stop_target_not_unique":
			if result.RecordAction == "update" || result.RecordAction == "delete" {
				return true
			}
		case "hard_stop_need_reminder_change":
			continue
		case "hard_stop_ambiguous_reminder_time":
			if result.NeedReminder && result.DatetimeISO == nil {
				return true
			}
		case "hard_stop_sensitive_memory":
			if result.Type == "journal" || result.Type == "unknown" {
				return true
			}
		case "hard_stop_delete":
			if result.RecordAction == "delete" {
				return true
			}
		default:
			if strings.HasPrefix(reason, "hard_stop_") {
				return true
			}
		}
	}
	return false
}

func passesDefaultRiskMatrix(result *agent.Result) bool {
	fallback := result.Confidence
	if fallback < 0.65 {
		return false
	}
	if fieldConfidence(result, "type", fallback) < 0.45 {
		return false
	}
	for _, field := range []string{"datetime", "need_reminder", "target", "content"} {
		if !fieldApplies(result, field) {
			continue
		}
		threshold := 0.65
		if fieldRisk(result, field) == "high" {
			threshold = 0.85
		}
		if fieldConfidence(result, field, fallback) < threshold {
			return false
		}
	}
	return true
}

func fieldConfidence(result *agent.Result, field string, fallback float64) float64 {
	if result.FieldConfidence == nil {
		return fallback
	}
	var value *float64
	switch field {
	case "type":
		value = result.FieldConfidence.Type
	case "content":
		value = result.FieldConfidence.Content
	case "datetime":
		value = result.FieldConfidence.Datetime
	case "need_reminder":
		value = result.FieldConfidence.NeedReminder
	case "target":
		value = result.FieldConfidence.Target
	}
	if value == nil {
		return fallback
	}
	if *value < 0 {
		return 0
	}
	if *value > 1 {
		return 1
	}
	return *value
}

func fieldRisk(result *agent.Result, field string) string {
	if result.FieldRisk != nil {
		switch field {
		case "type":
			if result.FieldRisk.Type == "low" || result.FieldRisk.Type == "high" {
				return result.FieldRisk.Type
			}
		case "content":
			if result.FieldRisk.Content == "low" || result.FieldRisk.Content == "high" {
				return result.FieldRisk.Content
			}
		case "datetime":
			if result.FieldRisk.Datetime == "low" || result.FieldRisk.Datetime == "high" {
				return result.FieldRisk.Datetime
			}
		case "need_reminder":
			if result.FieldRisk.NeedReminder == "low" || result.FieldRisk.NeedReminder == "high" {
				return result.FieldRisk.NeedReminder
			}
		case "target":
			if result.FieldRisk.Target == "low" || result.FieldRisk.Target == "high" {
				return result.FieldRisk.Target
			}
		}
	}
	if field == "datetime" || field == "need_reminder" || field == "target" {
		return "high"
	}
	return "low"
}

func fieldApplies(result *agent.Result, field string) bool {
	switch field {
	case "datetime":
		return result.NeedReminder || result.DatetimeISO != nil || result.DatetimeText != nil || containsString(result.MissingFields, "datetime")
	case "need_reminder":
		return result.Type == "todo" || result.NeedReminder
	case "target":
		return result.RecordAction == "update" || result.RecordAction == "delete"
	case "content":
		return strings.TrimSpace(result.Content) != ""
	default:
		return false
	}
}

func createInputFromResult(result *agent.Result, id string) records.CreateInput {
	return records.CreateInput{
		ID:            strings.TrimSpace(id),
		Type:          result.Type,
		Title:         result.Title,
		Content:       result.Content,
		DatetimeText:  result.DatetimeText,
		DatetimeISO:   result.DatetimeISO,
		NeedReminder:  result.NeedReminder,
		Confidence:    result.Confidence,
		Status:        "saved",
		MissingFields: nil,
	}
}

func updateInputFromResult(result *agent.Result, previous *records.Record) records.UpdateInput {
	status := result.Status
	if status == "ready" {
		status = "saved"
	}
	input := records.UpdateInput{
		Type:          stringPtr(result.Type),
		Title:         stringPtr(result.Title),
		Content:       stringPtr(result.Content),
		DatetimeText:  result.DatetimeText,
		DatetimeISO:   result.DatetimeISO,
		NeedReminder:  &result.NeedReminder,
		Confidence:    &result.Confidence,
		Status:        &status,
		MissingFields: nil,
	}
	if status == "discarded" && previous != nil {
		deletedAt := valueString(previous.DeletedAt)
		if deletedAt == "" {
			deletedAt = time.Now().UTC().Format("2006-01-02 15:04:05")
		}
		previousStatus := valueString(previous.PreviousStatus)
		if previousStatus == "" || previousStatus == "discarded" {
			previousStatus = "saved"
		}
		input.DeletedAt = &deletedAt
		input.PreviousStatus = &previousStatus
	} else {
		empty := ""
		input.DeletedAt = &empty
		input.PreviousStatus = &empty
	}
	return input
}

func deleteTargetID(result *agent.Result) string {
	if result == nil {
		return ""
	}
	if targetID := strings.TrimSpace(valueString(result.TargetID)); targetID != "" {
		return targetID
	}
	if len(result.RelatedIDs) == 1 {
		return strings.TrimSpace(result.RelatedIDs[0])
	}
	return ""
}

func recordExecutionEventType(result *agent.Result, status string) string {
	action := "record"
	if result != nil {
		switch result.RecordAction {
		case "create", "update", "delete":
			action = result.RecordAction
		}
	}
	return fmt.Sprintf("record.%s.%s", action, status)
}

func recordExecutionTitle(action string) string {
	switch action {
	case "created":
		return "已保存记录"
	case "updated":
		return "已更新记录"
	case "deleted":
		return "已移入回收站"
	case "restored":
		return "已恢复记录"
	default:
		return "记录已处理"
	}
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == target {
			return true
		}
	}
	return false
}

func valueString(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func stringPtr(value string) *string {
	return &value
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

func thinkingPayload(fast string, slow string) map[string]string {
	payload := map[string]string{}
	if fast = strings.TrimSpace(fast); fast != "" {
		payload["fast"] = fast
	}
	if slow = strings.TrimSpace(slow); slow != "" {
		payload["slow"] = slow
	}
	if len(payload) == 0 {
		return nil
	}
	return payload
}

func previewProgressTitle(result *agent.Result) string {
	if result == nil {
		return "已生成识别结果"
	}
	if !result.ShouldPreview || result.RecordAction == "none" {
		return "已生成回复"
	}
	switch result.Type {
	case "todo":
		return "已生成待办候选"
	case "journal":
		return "已生成日记候选"
	case "memo":
		return "已生成备忘候选"
	case "idea":
		return "已生成想法候选"
	default:
		return "已生成记录候选"
	}
}

func previewProgressPayload(result *agent.Result) map[string]any {
	if result == nil {
		return nil
	}
	return map[string]any{
		"intent":         result.Intent,
		"type":           result.Type,
		"status":         result.Status,
		"record_action":  result.RecordAction,
		"should_preview": result.ShouldPreview,
		"confidence":     result.Confidence,
	}
}

func actionProgressSummary(result *agent.Result) (string, agent.ProgressStatus) {
	if result == nil {
		return "已生成处理计划", agent.ProgressStatusCompleted
	}
	if result.Status == "need_confirmation" {
		return "需要确认后继续", agent.ProgressStatusWarning
	}
	if !result.ShouldPreview || result.RecordAction == "none" {
		return "本轮仅回复", agent.ProgressStatusCompleted
	}
	switch result.RecordAction {
	case "create":
		return "计划自动保存", agent.ProgressStatusCompleted
	case "update":
		return "计划更新记录", agent.ProgressStatusCompleted
	case "delete":
		return "计划删除记录", agent.ProgressStatusWarning
	default:
		return "已生成处理计划", agent.ProgressStatusCompleted
	}
}

func actionProgressPayload(result *agent.Result) map[string]any {
	if result == nil {
		return nil
	}
	return map[string]any{
		"record_action":  result.RecordAction,
		"status":         result.Status,
		"pending_state":  result.PendingState,
		"context_state":  result.ContextState,
		"should_preview": result.ShouldPreview,
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
