package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"mintal-vimo/vimo-go/internal/llm"
	"mintal-vimo/vimo-go/internal/vimotime"
)

type Service struct {
	models          *ModelRegistry
	systemPrompt    string
	fastReplyPrompt string
	now             func() time.Time
}

func NewService(provider llm.Provider, systemPrompt string) *Service {
	return NewServiceWithPrompts(&ModelRegistry{
		activeKey: "default",
		options: []ModelOption{{
			Key:     "default",
			Label:   "Default",
			Default: true,
		}},
		providers: map[string]llm.Provider{"default": provider},
	}, systemPrompt, "")
}

func NewServiceWithModels(models *ModelRegistry, systemPrompt string) *Service {
	return NewServiceWithPrompts(models, systemPrompt, "")
}

func NewServiceWithPrompts(models *ModelRegistry, systemPrompt string, fastReplyPrompt string) *Service {
	return &Service{
		models:          models,
		systemPrompt:    strings.TrimSpace(systemPrompt),
		fastReplyPrompt: strings.TrimSpace(fastReplyPrompt),
		now:             time.Now,
	}
}

func (s *Service) ModelOptions() []ModelOption {
	if s.models == nil {
		return nil
	}
	return s.models.Options()
}

func (s *Service) Analyze(ctx context.Context, req AnalyzeRequest) (*Result, error) {
	promptPayload, promptJSON, err := s.promptPayload(req)
	if err != nil {
		return nil, err
	}

	provider, _, err := s.models.Provider(req.ModelKey)
	if err != nil {
		return nil, err
	}
	resp, err := provider.Chat(ctx, llm.ChatRequest{
		Messages: []llm.Message{
			{Role: "system", Content: s.systemPrompt},
			{Role: "user", Content: string(promptJSON)},
		},
		Stream: false,
	})
	if err != nil {
		return nil, err
	}

	result, err := parseResult(resp.Content)
	if err != nil {
		return nil, fmt.Errorf("模型返回的 JSON 格式无效或没有遵守结构化输出: %w", err)
	}

	pending := pendingContextForResult(result, promptPayload.OpenContexts, req.PendingRecord)
	normalizeResultWithTime(result, promptPayload.Message, pending, promptPayload.Now, promptPayload.Timezone)
	if strings.TrimSpace(result.Reply) == "" {
		return nil, fmt.Errorf("agent reply is empty")
	}
	return result, nil
}

func (s *Service) StreamFastReply(ctx context.Context, req AnalyzeRequest, onDelta func(string) error) (*FastReplyResult, error) {
	if strings.TrimSpace(s.fastReplyPrompt) == "" {
		return nil, fmt.Errorf("fast reply prompt is not configured")
	}
	_, promptJSON, err := s.promptPayload(req)
	if err != nil {
		return nil, err
	}
	maxTokens := 320
	candidates := s.fastReplyProviderCandidates(req.ModelKey)
	if len(candidates) == 0 {
		return nil, fmt.Errorf("models are not configured")
	}
	var lastErr error
	for _, provider := range candidates {
		result, err := s.sendFastReplyWithProvider(ctx, provider, promptJSON, maxTokens, onDelta)
		if err != nil {
			lastErr = err
			continue
		}
		return result, nil
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("fast reply is empty")
}

func (s *Service) fastReplyProviderCandidates(requestedKey string) []llm.Provider {
	if s.models == nil {
		return nil
	}
	var providers []llm.Provider
	seen := map[string]bool{}
	add := func(key string) {
		key = strings.TrimSpace(key)
		if key == "" || seen[key] {
			return
		}
		provider, _, err := s.models.Provider(key)
		if err != nil {
			return
		}
		seen[key] = true
		providers = append(providers, provider)
	}
	add(requestedKey)
	add(s.models.activeKey)
	for _, option := range s.models.Options() {
		add(option.Key)
	}
	return providers
}

func (s *Service) sendFastReplyWithProvider(ctx context.Context, provider llm.Provider, promptJSON []byte, maxTokens int, onDelta func(string) error) (*FastReplyResult, error) {
	temp := 0.1
	resp, err := provider.Chat(ctx, llm.ChatRequest{
		Messages: []llm.Message{
			{Role: "system", Content: s.fastReplyPrompt},
			{Role: "user", Content: string(promptJSON)},
		},
		Temperature:    &temp,
		MaxTokens:      &maxTokens,
		ResponseFormat: &llm.ResponseFormat{Type: "json_object"},
		Stream:         false,
	})
	if err != nil {
		return nil, err
	}
	result, err := parseFastReplyResult(resp.Content)
	if err != nil {
		return nil, err
	}
	if result.Text == "" {
		return nil, fmt.Errorf("fast reply is empty")
	}
	if err := onDelta(result.Text); err != nil {
		return nil, err
	}
	return result, nil
}

func parseFastReplyResult(raw string) (*FastReplyResult, error) {
	text := strings.TrimSpace(raw)
	if text == "" {
		return nil, fmt.Errorf("fast reply is empty")
	}
	var result FastReplyResult
	if err := json.Unmarshal([]byte(text), &result); err != nil {
		return nil, fmt.Errorf("fast reply JSON is invalid: %w", err)
	}
	result.Text = strings.TrimSpace(result.Text)
	result.Route = normalizeFastReplyRoute(result.Route)
	if nested, ok, err := parseNestedFastReplyResult(result.Text); err != nil {
		return nil, err
	} else if ok {
		result = *nested
	}
	if result.Text == "" {
		return nil, fmt.Errorf("fast reply text is empty")
	}
	return &result, nil
}

func parseNestedFastReplyResult(text string) (*FastReplyResult, bool, error) {
	text = strings.TrimSpace(text)
	if text == "" || !strings.HasPrefix(text, "{") {
		return nil, false, nil
	}
	var nested FastReplyResult
	if err := json.Unmarshal([]byte(text), &nested); err != nil {
		return nil, true, fmt.Errorf("fast reply text contains invalid protocol JSON: %w", err)
	}
	nested.Text = strings.TrimSpace(nested.Text)
	nested.Route = normalizeFastReplyRoute(nested.Route)
	if nested.Text == "" {
		return nil, true, fmt.Errorf("fast reply nested text is empty")
	}
	if strings.HasPrefix(nested.Text, "{") {
		return parseNestedFastReplyResult(nested.Text)
	}
	return &nested, true, nil
}

func normalizeFastReplyRoute(route FastReplyRoute) FastReplyRoute {
	switch route {
	case FastReplyRouteChatOnly:
		return FastReplyRouteChatOnly
	default:
		return FastReplyRouteContinueSlow
	}
}

func isCompleteFastReply(text string) bool {
	text = strings.TrimSpace(text)
	runes := []rune(text)
	if len(runes) < 8 {
		return false
	}
	last := runes[len(runes)-1]
	switch last {
	case '。', '！', '？', '～', '~', '.', '!', '?':
		return true
	default:
		return false
	}
}

type promptPayload struct {
	TurnID           string            `json:"turn_id,omitempty"`
	Message          string            `json:"message"`
	Timezone         string            `json:"timezone"`
	Now              string            `json:"now"`
	ModelKey         string            `json:"model_key,omitempty"`
	ModelOptions     []ModelOption     `json:"model_options,omitempty"`
	PendingRecord    *ContextRecord    `json:"pending_record,omitempty"`
	RecentRecords    []ContextRecord   `json:"recent_records,omitempty"`
	OpenContexts     []ContextRecord   `json:"open_contexts,omitempty"`
	ClosedContexts   []ContextRecord   `json:"closed_contexts,omitempty"`
	RecentMessages   []ConversationMessage `json:"recent_messages,omitempty"`
	ReplyProfile     ReplyProfile      `json:"reply_profile,omitempty"`
	FastReplyContext *FastReplyContext `json:"fast_reply_context,omitempty"`
}

func (s *Service) promptPayload(req AnalyzeRequest) (promptPayload, []byte, error) {
	message := strings.TrimSpace(req.Message)
	if message == "" {
		return promptPayload{}, nil, fmt.Errorf("message is required")
	}

	timezone := strings.TrimSpace(req.Timezone)
	if timezone == "" {
		timezone = "Asia/Shanghai"
	}

	nowText := strings.TrimSpace(req.Now)
	if nowText == "" {
		nowText = vimotime.Format(s.now().In(loadLocation(timezone)))
	}

	payload := promptPayload{
		TurnID:           strings.TrimSpace(req.TurnID),
		Message:          message,
		Timezone:         timezone,
		Now:              nowText,
		ModelKey:         strings.TrimSpace(req.ModelKey),
		ModelOptions:     s.ModelOptions(),
		PendingRecord:    req.PendingRecord,
		RecentRecords:    req.RecentRecords,
		OpenContexts:     openContextsFromRequest(req),
		ClosedContexts:   closedContextsFromRequest(req),
		RecentMessages:   normalizeRecentMessages(req.RecentMessages),
		ReplyProfile:     req.ReplyProfile,
		FastReplyContext: normalizeFastReplyContext(req.FastReplyContext),
	}
	promptJSON, err := json.Marshal(payload)
	if err != nil {
		return promptPayload{}, nil, err
	}
	return payload, promptJSON, nil
}

func normalizeRecentMessages(messages []ConversationMessage) []ConversationMessage {
	if len(messages) == 0 {
		return nil
	}
	start := 0
	if len(messages) > 8 {
		start = len(messages) - 8
	}
	result := make([]ConversationMessage, 0, len(messages)-start)
	for _, message := range messages[start:] {
		role := strings.TrimSpace(strings.ToLower(message.Role))
		if role != "user" && role != "assistant" {
			continue
		}
		content := strings.TrimSpace(message.Content)
		if content == "" {
			continue
		}
		result = append(result, ConversationMessage{
			Role:      role,
			Content:   content,
			CreatedAt: strings.TrimSpace(message.CreatedAt),
		})
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func normalizeFastReplyContext(context *FastReplyContext) *FastReplyContext {
	if context == nil {
		return nil
	}
	turnID := strings.TrimSpace(context.TurnID)
	content := strings.TrimSpace(context.Content)
	state := strings.TrimSpace(context.State)
	if content == "" && state == "" && turnID == "" {
		return nil
	}
	return &FastReplyContext{
		TurnID:  turnID,
		State:   state,
		Content: content,
	}
}

func openContextsFromRequest(req AnalyzeRequest) []ContextRecord {
	if len(req.OpenContexts) > 0 {
		return normalizeContextLayer(req.OpenContexts, "open")
	}
	if req.PendingRecord == nil {
		return nil
	}
	pending := *req.PendingRecord
	pending.Layer = "open"
	if pending.ContextKind == "" {
		pending.ContextKind = "record"
	}
	return []ContextRecord{pending}
}

func closedContextsFromRequest(req AnalyzeRequest) []ContextRecord {
	if len(req.ClosedContexts) > 0 {
		return normalizeContextLayer(req.ClosedContexts, "closed")
	}
	return normalizeContextLayer(req.RecentRecords, "closed")
}

func normalizeContextLayer(contexts []ContextRecord, layer string) []ContextRecord {
	if len(contexts) == 0 {
		return nil
	}
	result := make([]ContextRecord, 0, len(contexts))
	for _, context := range contexts {
		context.Layer = layer
		if strings.TrimSpace(context.ContextKind) == "" {
			context.ContextKind = "record"
		}
		context.Intent = normalizeIntent(context.Intent)
		context.RecordAction = normalizeRecordAction(context.RecordAction)
		context.TargetID = normalizeOptionalID(context.TargetID)
		context.RelatedIDs = normalizeRelatedIDs(context.RelatedIDs)
		normalizeFieldConfidence(context.FieldConfidence)
		normalizeFieldRisk(context.FieldRisk)
		context.PendingState = normalizePendingState(context.PendingState)
		context.ContextState = normalizePendingState(context.ContextState)
		context.MissingFields = normalizeMissing(context.MissingFields)
		result = append(result, context)
	}
	return result
}

func pendingContextForResult(result *Result, openContexts []ContextRecord, fallback *ContextRecord) *ContextRecord {
	if result != nil && result.ContextTargetID != nil {
		target := strings.TrimSpace(*result.ContextTargetID)
		for _, context := range openContexts {
			if strings.TrimSpace(context.ID) == target {
				contextCopy := context
				return &contextCopy
			}
		}
	}
	if result != nil && result.TargetID != nil {
		target := strings.TrimSpace(*result.TargetID)
		for _, context := range openContexts {
			if strings.TrimSpace(context.ID) == target {
				contextCopy := context
				return &contextCopy
			}
		}
	}
	if len(openContexts) > 0 {
		contextCopy := openContexts[0]
		return &contextCopy
	}
	return fallback
}

func parseResult(content string) (*Result, error) {
	content = strings.TrimSpace(content)
	if strings.HasPrefix(content, "```") {
		content = strings.TrimPrefix(content, "```json")
		content = strings.TrimPrefix(content, "```")
		content = strings.TrimSuffix(content, "```")
		content = strings.TrimSpace(content)
	}

	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start >= 0 && end > start {
		content = content[start : end+1]
	}

	var result Result
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return nil, fmt.Errorf("parse agent json: %w", err)
	}
	return &result, nil
}

func normalizeResult(result *Result, original string, pending *ContextRecord) {
	normalizeResultWithTime(result, original, pending, "", "")
}

func normalizeResultWithTime(result *Result, original string, pending *ContextRecord, nowText string, timezone string) {
	seedLegacyFieldsFromStack(result)
	result.Type = normalizeType(result.Type)
	result.Status = normalizeStatus(result.Status)
	if strings.TrimSpace(result.Content) == "" {
		result.Content = original
	}
	result.Title = strings.TrimSpace(result.Title)
	if result.Title == "" {
		result.Title = fallbackTitle(original)
	}
	if result.Confidence < 0 {
		result.Confidence = 0
	}
	if result.Confidence > 1 {
		result.Confidence = 1
	}
	normalizeFieldConfidence(result.FieldConfidence)
	normalizeFieldRisk(result.FieldRisk)
	result.MissingFields = normalizeMissing(result.MissingFields)
	result.Intent = normalizeIntent(result.Intent)
	result.RecordAction = normalizeRecordAction(result.RecordAction)
	result.TargetID = normalizeOptionalID(result.TargetID)
	result.RelatedIDs = normalizeRelatedIDs(result.RelatedIDs)
	result.ContextAction = normalizeContextAction(result.ContextAction)
	result.ContextTargetID = normalizeOptionalID(result.ContextTargetID)
	result.PendingState = normalizePendingState(result.PendingState)
	result.ContextState = normalizePendingState(result.ContextState)
	applyStructuredNoOpOverride(result)
	normalizeContextTargetForIntent(result)
	applyNonRecordIntent(result, original)
	normalizeRecordActionForIntent(result, pending)
	applyReviewIntent(result)
	mergePendingRecord(result, pending, original)
	applyPendingDateContext(result, pending, nowText, timezone)
	applyContentQuality(result, original)
	result.ShouldPreview = shouldPreviewResult(result)
	if result.Type == "unknown" && result.Status == "ready" && result.ShouldPreview {
		result.Status = "need_confirmation"
	}
	if len(result.MissingFields) > 0 && result.Status == "ready" && result.ShouldPreview {
		result.Status = "need_confirmation"
	}
	if result.Status == "need_confirmation" && result.Confidence == 0 {
		result.Confidence = 0.5
	}
	result.Reply = strings.TrimSpace(result.Reply)
	if result.DatetimeISO != nil && strings.TrimSpace(*result.DatetimeISO) == "" {
		result.DatetimeISO = nil
	}
	if result.DatetimeISO != nil {
		result.DatetimeISO = vimotime.NormalizeOptional(result.DatetimeISO)
	}
	if result.DatetimeText != nil && strings.TrimSpace(*result.DatetimeText) == "" {
		result.DatetimeText = nil
	}
	normalizeIntentStack(result)
	applyHardStopGate(result, pending)
	normalizeIntentTrace(result, pending)
}

func applyPendingDateContext(result *Result, pending *ContextRecord, nowText string, timezone string) {
	if pending == nil || !isPendingContinuation(result.Intent) || result.DatetimeISO == nil {
		return
	}
	if result.DatetimeText != nil && hasDateAnchor(*result.DatetimeText) {
		return
	}

	pendingDate, ok := pendingDateContext(pending, nowText, timezone)
	if !ok {
		return
	}
	resultTime, ok := parseDisplayTime(*result.DatetimeISO, timezone)
	if !ok || sameDate(resultTime, pendingDate) {
		return
	}

	merged := time.Date(
		pendingDate.Year(),
		pendingDate.Month(),
		pendingDate.Day(),
		resultTime.Hour(),
		resultTime.Minute(),
		resultTime.Second(),
		0,
		resultTime.Location(),
	)
	text := vimotime.Format(merged)
	result.DatetimeISO = &text
}

func isPendingContinuation(intent string) bool {
	return intent == "update_pending" || intent == "confirm_pending"
}

func pendingDateContext(pending *ContextRecord, nowText string, timezone string) (time.Time, bool) {
	if pending.DatetimeISO != nil {
		return parseDisplayTime(*pending.DatetimeISO, timezone)
	}
	if pending.DatetimeText == nil || strings.TrimSpace(nowText) == "" {
		return time.Time{}, false
	}
	now, ok := parseDisplayTime(nowText, timezone)
	if !ok {
		return time.Time{}, false
	}

	text := strings.TrimSpace(*pending.DatetimeText)
	switch {
	case strings.Contains(text, "后天"):
		return now.AddDate(0, 0, 2), true
	case strings.Contains(text, "明天") || strings.Contains(text, "明晚") || strings.Contains(text, "明早"):
		return now.AddDate(0, 0, 1), true
	case strings.Contains(text, "今天") || strings.Contains(text, "今晚") || strings.Contains(text, "今早"):
		return now, true
	default:
		return time.Time{}, false
	}
}

func hasDateAnchor(value string) bool {
	text := strings.TrimSpace(value)
	return strings.Contains(text, "今天") ||
		strings.Contains(text, "今晚") ||
		strings.Contains(text, "今早") ||
		strings.Contains(text, "明天") ||
		strings.Contains(text, "明晚") ||
		strings.Contains(text, "明早") ||
		strings.Contains(text, "后天")
}

func parseDisplayTime(value string, timezone string) (time.Time, bool) {
	text := strings.TrimSpace(value)
	if text == "" {
		return time.Time{}, false
	}
	loc := loadLocation(timezone)
	layouts := []string{
		vimotime.DisplayLayout,
		"2006-01-02 15:04",
		"2006-01-02T15:04:05",
		"2006-01-02T15:04",
		time.RFC3339,
	}
	for _, layout := range layouts {
		var (
			parsed time.Time
			err    error
		)
		if layout == time.RFC3339 {
			parsed, err = time.Parse(layout, text)
			if err == nil {
				return parsed.In(loc), true
			}
			continue
		}
		parsed, err = time.ParseInLocation(layout, text, loc)
		if err == nil {
			return parsed, true
		}
	}
	return time.Time{}, false
}

func sameDate(left time.Time, right time.Time) bool {
	right = right.In(left.Location())
	return left.Year() == right.Year() && left.Month() == right.Month() && left.Day() == right.Day()
}

func mergePendingRecord(result *Result, pending *ContextRecord, original string) {
	if pending == nil {
		return
	}
	if result.Intent == "answer_query" || result.Intent == "joke_response" {
		return
	}

	isContinuation := result.Intent == "update_pending" ||
		result.Intent == "confirm_pending"
	if !isContinuation {
		return
	}

	pendingType := normalizeType(pending.Type)
	if pendingType != "unknown" {
		result.Type = pendingType
		result.MissingFields = removeMissing(result.MissingFields, "type")
	}
	if strings.TrimSpace(pending.Title) != "" && (result.Title == "" || result.Title == fallbackTitle(original) || hasAnyMissing(result.MissingFields, "title")) {
		result.Title = strings.TrimSpace(pending.Title)
		result.MissingFields = removeMissing(result.MissingFields, "title")
	}
	if strings.TrimSpace(pending.Content) != "" && (strings.TrimSpace(result.Content) == strings.TrimSpace(original) || hasAnyMissing(result.MissingFields, "content")) {
		result.Content = strings.TrimSpace(pending.Content)
		result.MissingFields = removeMissing(result.MissingFields, "content")
	}
	if result.DatetimeText == nil && result.DatetimeISO == nil && !hasAnyMissing(result.MissingFields, "datetime") && pending.DatetimeText != nil {
		result.DatetimeText = pending.DatetimeText
	}
	if result.DatetimeText == nil && result.DatetimeISO == nil && !hasAnyMissing(result.MissingFields, "datetime") && pending.DatetimeISO != nil {
		result.DatetimeISO = pending.DatetimeISO
	}
	if result.Intent == "confirm_pending" && result.Status == "need_confirmation" && len(result.MissingFields) == 0 {
		result.Status = "ready"
	}
}

func normalizeType(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "todo", "journal", "memo", "idea":
		return strings.TrimSpace(strings.ToLower(value))
	default:
		return "unknown"
	}
}

func normalizeStatus(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "ready", "saved", "discarded", "completed":
		return strings.TrimSpace(strings.ToLower(value))
	default:
		return "need_confirmation"
	}
}

func normalizeMissing(values []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(strings.ToLower(value))
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func normalizeFieldConfidence(scores *FieldScores) {
	if scores == nil {
		return
	}
	clampOptionalScore(&scores.Type)
	clampOptionalScore(&scores.Title)
	clampOptionalScore(&scores.Content)
	clampOptionalScore(&scores.Datetime)
	clampOptionalScore(&scores.NeedReminder)
	clampOptionalScore(&scores.Target)
}

func clampOptionalScore(value **float64) {
	if value == nil || *value == nil {
		return
	}
	clamped := clamp01(**value)
	*value = &clamped
}

func clamp01(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}

func normalizeFieldRisk(risks *FieldRisks) {
	if risks == nil {
		return
	}
	risks.Type = normalizeRisk(risks.Type)
	risks.Title = normalizeRisk(risks.Title)
	risks.Content = normalizeRisk(risks.Content)
	risks.Datetime = normalizeRisk(risks.Datetime)
	risks.NeedReminder = normalizeRisk(risks.NeedReminder)
	risks.Target = normalizeRisk(risks.Target)
}

func normalizeRisk(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "low", "high":
		return strings.TrimSpace(strings.ToLower(value))
	default:
		return ""
	}
}

func normalizeIntentStack(result *Result) {
	if result.PrimaryIntent == nil {
		result.PrimaryIntent = &IntentItem{
			ID:         "intent_primary",
			Intent:     result.Intent,
			Category:   result.Intent,
			Action:     actionForRecordAction(result.RecordAction),
			RecordType: result.Type,
			Confidence: result.Confidence,
			Risk:       riskForResult(result),
			TargetID:   result.TargetID,
		}
	} else {
		normalizeIntentItem(result.PrimaryIntent, "intent_primary")
	}
	for index := range result.SecondaryIntents {
		normalizeIntentItem(&result.SecondaryIntents[index], fmt.Sprintf("intent_secondary_%d", index+1))
	}
	normalizeRecordCandidates(result)
	normalizeExecutionPlan(result)
	if result.ReplyStrategy == nil {
		result.ReplyStrategy = &ReplyStrategy{
			FocusIntentID: result.PrimaryIntent.ID,
			Tone:          "concise",
			Summary:       result.Reply,
		}
	}
	if strings.TrimSpace(result.ReplyStrategy.FocusIntentID) == "" {
		result.ReplyStrategy.FocusIntentID = result.PrimaryIntent.ID
	}
	if result.PendingState == "" {
		result.PendingState = pendingStateForResult(result)
	}
	if result.ContextState == "" {
		result.ContextState = result.PendingState
	}
}

func normalizeIntentTrace(result *Result, pending *ContextRecord) {
	if result.IntentTrace == nil {
		result.IntentTrace = &IntentTrace{}
	}
	result.IntentTrace.MatchedContextID = normalizeOptionalID(result.IntentTrace.MatchedContextID)
	if result.IntentTrace.MatchedContextID == nil {
		if result.ContextTargetID != nil {
			result.IntentTrace.MatchedContextID = result.ContextTargetID
		} else if result.TargetID != nil && isPendingContinuation(result.Intent) {
			result.IntentTrace.MatchedContextID = result.TargetID
		} else if pending != nil && isPendingContinuation(result.Intent) {
			result.IntentTrace.MatchedContextID = normalizeOptionalID(&pending.ID)
		}
	}
	result.IntentTrace.ContinuationReason = normalizeTraceToken(result.IntentTrace.ContinuationReason)
	result.IntentTrace.RiskReasons = normalizeTraceTokens(result.IntentTrace.RiskReasons)
	result.IntentTrace.DiscardedAlternatives = normalizeTraceTokens(result.IntentTrace.DiscardedAlternatives)
	result.IntentTrace.GateReasons = normalizeTraceTokens(result.IntentTrace.GateReasons)
	result.IntentTrace.StateTransition = normalizeTraceToken(result.IntentTrace.StateTransition)
	if result.IntentTrace.StateTransition == "" {
		result.IntentTrace.StateTransition = stateTransitionForResult(result)
	}
	if result.IntentTrace.ContinuationReason == "" && isPendingContinuation(result.Intent) {
		result.IntentTrace.ContinuationReason = "pending_continuation"
	}
	if len(result.IntentTrace.RiskReasons) == 0 {
		result.IntentTrace.RiskReasons = riskReasonsForResult(result)
	}
	if len(result.IntentTrace.GateReasons) == 0 {
		result.IntentTrace.GateReasons = gateReasonsForResult(result)
	}
}

func normalizeIntentItem(item *IntentItem, fallbackID string) {
	item.ID = fallbackString(item.ID, fallbackID)
	item.Intent = normalizeIntent(item.Intent)
	item.Category = fallbackString(item.Category, item.Intent)
	item.Action = normalizeIntentAction(item.Action)
	item.RecordType = normalizeType(item.RecordType)
	item.Confidence = clamp01(item.Confidence)
	item.Risk = normalizeRisk(item.Risk)
	item.TargetID = normalizeOptionalID(item.TargetID)
	item.Evidence = normalizeStringList(item.Evidence)
}

func normalizeRecordCandidates(result *Result) {
	if len(result.RecordCandidates) == 0 && result.ShouldPreview {
		result.RecordCandidates = []RecordCandidate{candidateFromResult(result, true)}
	}
	for index := range result.RecordCandidates {
		candidate := &result.RecordCandidates[index]
		candidate.ID = fallbackString(candidate.ID, fmt.Sprintf("candidate_%d", index+1))
		if strings.TrimSpace(candidate.IntentID) == "" {
			if index == 0 && result.PrimaryIntent != nil {
				candidate.IntentID = result.PrimaryIntent.ID
			} else if secondaryIndex := index - 1; secondaryIndex >= 0 && secondaryIndex < len(result.SecondaryIntents) {
				candidate.IntentID = result.SecondaryIntents[secondaryIndex].ID
			}
		}
		candidate.Type = normalizeType(candidate.Type)
		candidate.Title = strings.TrimSpace(candidate.Title)
		if candidate.Title == "" {
			candidate.Title = fallbackTitle(candidate.Content)
		}
		candidate.Content = strings.TrimSpace(candidate.Content)
		candidate.Confidence = clamp01(candidate.Confidence)
		normalizeFieldConfidence(candidate.FieldConfidence)
		normalizeFieldRisk(candidate.FieldRisk)
		candidate.Status = normalizeStatus(candidate.Status)
		candidate.MissingFields = normalizeMissing(candidate.MissingFields)
		candidate.RecordAction = normalizeRecordAction(candidate.RecordAction)
		candidate.TargetID = normalizeOptionalID(candidate.TargetID)
		candidate.RelatedIDs = normalizeRelatedIDs(candidate.RelatedIDs)
		candidate.ExecutionDecision = normalizeExecutionDecision(candidate.ExecutionDecision)
		if candidate.ExecutionDecision == "" {
			candidate.ExecutionDecision = decisionForCandidate(candidate, index == 0)
		}
		if index > 0 && candidate.ExecutionDecision == "auto_execute" && !secondaryCandidateCanAutoExecute(*candidate) {
			candidate.ExecutionDecision = "preview"
		}
		candidate.ShouldPreview = candidate.ExecutionDecision != "no_op"
		if candidate.DatetimeISO != nil {
			candidate.DatetimeISO = vimotime.NormalizeOptional(candidate.DatetimeISO)
		}
		if candidate.DatetimeText != nil && strings.TrimSpace(*candidate.DatetimeText) == "" {
			candidate.DatetimeText = nil
		}
		if index == 0 {
			candidate.Primary = true
		}
	}
}

func secondaryCandidateCanAutoExecute(candidate RecordCandidate) bool {
	if candidate.RecordAction != "create" {
		return false
	}
	if candidate.Status != "ready" || len(candidate.MissingFields) > 0 {
		return false
	}
	return candidate.Type == "todo" || candidate.Type == "memo" || candidate.Type == "idea"
}

func normalizeExecutionPlan(result *Result) {
	if len(result.ExecutionPlan) == 0 {
		for index, candidate := range result.RecordCandidates {
			result.ExecutionPlan = append(result.ExecutionPlan, ExecutionItem{
				ID:          fmt.Sprintf("exec_%d", index+1),
				IntentID:    candidate.IntentID,
				CandidateID: candidate.ID,
				Decision:    candidate.ExecutionDecision,
				Action:      candidate.RecordAction,
				Risk:        riskForCandidate(candidate),
				TargetID:    candidate.TargetID,
			})
		}
		if len(result.ExecutionPlan) == 0 && result.RecordAction == "none" {
			result.ExecutionPlan = []ExecutionItem{{
				ID:       "exec_1",
				IntentID: result.PrimaryIntent.ID,
				Decision: "no_op",
				Action:   "none",
				Risk:     "low",
			}}
		}
	}
	for index := range result.ExecutionPlan {
		item := &result.ExecutionPlan[index]
		item.ID = fallbackString(item.ID, fmt.Sprintf("exec_%d", index+1))
		item.Decision = normalizeExecutionDecision(item.Decision)
		if item.Decision == "" {
			item.Decision = "preview"
		}
		item.Action = normalizeRecordAction(item.Action)
		if item.Action == "" {
			item.Action = "none"
		}
		item.Risk = normalizeRisk(item.Risk)
		item.TargetID = normalizeOptionalID(item.TargetID)
		if item.Decision == "auto_execute" && !executionItemTargetsPrimary(result, item) && !executionItemCanAutoExecuteSecondary(result, item) {
			item.Decision = "preview"
		}
	}
}

func executionItemCanAutoExecuteSecondary(result *Result, item *ExecutionItem) bool {
	if item.Action != "create" {
		return false
	}
	for _, candidate := range result.RecordCandidates {
		if candidate.ID == item.CandidateID {
			return secondaryCandidateCanAutoExecute(candidate)
		}
	}
	return false
}

func seedLegacyFieldsFromStack(result *Result) {
	if result.PrimaryIntent != nil {
		if strings.TrimSpace(result.Intent) == "" {
			result.Intent = result.PrimaryIntent.Intent
		}
		if strings.TrimSpace(result.Type) == "" || strings.TrimSpace(result.Type) == "unknown" {
			result.Type = result.PrimaryIntent.RecordType
		}
		if result.Confidence == 0 {
			result.Confidence = result.PrimaryIntent.Confidence
		}
		if result.TargetID == nil {
			result.TargetID = result.PrimaryIntent.TargetID
		}
	}
	if len(result.RecordCandidates) == 0 {
		return
	}
	primary := result.RecordCandidates[0]
	for _, candidate := range result.RecordCandidates {
		if candidate.Primary {
			primary = candidate
			break
		}
	}
	if strings.TrimSpace(result.Type) == "" || strings.TrimSpace(result.Type) == "unknown" {
		result.Type = primary.Type
	}
	if strings.TrimSpace(result.Title) == "" {
		result.Title = primary.Title
	}
	if strings.TrimSpace(result.Content) == "" {
		result.Content = primary.Content
	}
	if result.DatetimeText == nil {
		result.DatetimeText = primary.DatetimeText
	}
	if result.DatetimeISO == nil {
		result.DatetimeISO = primary.DatetimeISO
	}
	result.NeedReminder = result.NeedReminder || primary.NeedReminder
	if result.Confidence == 0 {
		result.Confidence = primary.Confidence
	}
	if result.FieldConfidence == nil {
		result.FieldConfidence = primary.FieldConfidence
	}
	if result.FieldRisk == nil {
		result.FieldRisk = primary.FieldRisk
	}
	if strings.TrimSpace(result.Status) == "" {
		result.Status = primary.Status
	}
	if len(result.MissingFields) == 0 {
		result.MissingFields = primary.MissingFields
	}
	if strings.TrimSpace(result.RecordAction) == "" {
		result.RecordAction = primary.RecordAction
	}
	if result.TargetID == nil {
		result.TargetID = primary.TargetID
	}
	if len(result.RelatedIDs) == 0 {
		result.RelatedIDs = primary.RelatedIDs
	}
	if !result.ShouldPreview {
		result.ShouldPreview = primary.ShouldPreview
	}
}

func executionItemTargetsPrimary(result *Result, item *ExecutionItem) bool {
	if result.PrimaryIntent != nil && item.IntentID == result.PrimaryIntent.ID {
		return true
	}
	if len(result.RecordCandidates) > 0 {
		primaryID := result.RecordCandidates[0].ID
		for _, candidate := range result.RecordCandidates {
			if candidate.Primary {
				primaryID = candidate.ID
				break
			}
		}
		return item.CandidateID == primaryID
	}
	return false
}

func candidateFromResult(result *Result, primary bool) RecordCandidate {
	intentID := ""
	if result.PrimaryIntent != nil {
		intentID = result.PrimaryIntent.ID
	}
	return RecordCandidate{
		ID:                "candidate_1",
		IntentID:          intentID,
		Type:              result.Type,
		Title:             result.Title,
		Content:           result.Content,
		DatetimeText:      result.DatetimeText,
		DatetimeISO:       result.DatetimeISO,
		NeedReminder:      result.NeedReminder,
		Confidence:        result.Confidence,
		FieldConfidence:   result.FieldConfidence,
		FieldRisk:         result.FieldRisk,
		Status:            result.Status,
		MissingFields:     result.MissingFields,
		RecordAction:      result.RecordAction,
		TargetID:          result.TargetID,
		RelatedIDs:        result.RelatedIDs,
		ExecutionDecision: decisionForLegacyResult(result),
		ShouldPreview:     result.ShouldPreview,
		Primary:           primary,
	}
}

func decisionForLegacyResult(result *Result) string {
	if result.RecordAction == "none" || !result.ShouldPreview {
		return "no_op"
	}
	if result.Status == "ready" && len(result.MissingFields) == 0 {
		return "auto_execute"
	}
	return "pending"
}

func decisionForCandidate(candidate *RecordCandidate, primary bool) string {
	if candidate.RecordAction == "none" {
		return "no_op"
	}
	if !primary {
		return "preview"
	}
	if candidate.Status == "ready" && len(candidate.MissingFields) == 0 {
		return "auto_execute"
	}
	return "pending"
}

func actionForRecordAction(action string) string {
	switch action {
	case "create":
		return "create_record"
	case "update":
		return "update_record"
	case "delete":
		return "delete_record"
	default:
		return "none"
	}
}

func normalizeIntentAction(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "create_record", "update_record", "delete_record", "answer_query", "config_update", "clarify", "none":
		return strings.TrimSpace(strings.ToLower(value))
	default:
		return strings.TrimSpace(strings.ToLower(value))
	}
}

func normalizeExecutionDecision(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "auto_execute", "preview", "pending", "ask_clarify", "no_op":
		return strings.TrimSpace(strings.ToLower(value))
	default:
		return ""
	}
}

func normalizePendingState(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "open", "waiting_field", "ready_to_execute", "executed", "dismissed", "none":
		return strings.TrimSpace(strings.ToLower(value))
	default:
		return ""
	}
}

func pendingStateForResult(result *Result) string {
	if !result.ShouldPreview || result.RecordAction == "none" {
		return "none"
	}
	if result.ContextAction == "close" || (result.Status == "ready" && len(result.MissingFields) == 0) {
		return "ready_to_execute"
	}
	if len(result.MissingFields) > 0 {
		return "waiting_field"
	}
	return "open"
}

func stateTransitionForResult(result *Result) string {
	next := pendingStateForResult(result)
	if isPendingContinuation(result.Intent) {
		return "open->" + next
	}
	if result.ContextAction == "open" {
		return "none->" + next
	}
	if result.ContextAction == "close" {
		return "open->ready_to_execute"
	}
	return next
}

func normalizeTraceToken(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		return ""
	}
	value = strings.ReplaceAll(value, " ", "_")
	return value
}

func normalizeTraceTokens(values []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		token := normalizeTraceToken(value)
		if token == "" || seen[token] {
			continue
		}
		seen[token] = true
		result = append(result, token)
	}
	return result
}

func riskReasonsForResult(result *Result) []string {
	reasons := []string{}
	if result.FieldRisk != nil {
		if result.FieldRisk.Datetime == "high" {
			reasons = append(reasons, "datetime_high_risk")
		}
		if result.FieldRisk.NeedReminder == "high" {
			reasons = append(reasons, "need_reminder_high_risk")
		}
		if result.FieldRisk.Target == "high" {
			reasons = append(reasons, "target_high_risk")
		}
	}
	if (result.RecordAction == "update" || result.RecordAction == "delete") && result.TargetID == nil {
		reasons = append(reasons, "target_missing")
	}
	if len(reasons) == 0 && riskForResult(result) == "high" {
		reasons = append(reasons, "high_risk_action")
	}
	return normalizeTraceTokens(reasons)
}

func gateReasonsForResult(result *Result) []string {
	reasons := []string{}
	if result.Status == "need_confirmation" {
		reasons = append(reasons, "need_confirmation")
	}
	for _, field := range result.MissingFields {
		reasons = append(reasons, "missing_"+field)
	}
	if result.Intent == "delete_record" || result.Intent == "update_record" {
		if result.TargetID == nil || len(result.RelatedIDs) > 1 {
			reasons = append(reasons, "target_not_unique")
		}
	}
	if result.NeedReminder && result.DatetimeISO == nil {
		reasons = append(reasons, "reminder_time_not_executable")
	}
	reasons = append(reasons, hardStopReasonsForResult(result, nil)...)
	return normalizeTraceTokens(reasons)
}

func riskForResult(result *Result) string {
	if result.FieldRisk != nil {
		if result.FieldRisk.Datetime == "high" || result.FieldRisk.NeedReminder == "high" || result.FieldRisk.Target == "high" {
			return "high"
		}
	}
	if result.RecordAction == "update" || result.RecordAction == "delete" || result.NeedReminder {
		return "high"
	}
	return "low"
}

func riskForCandidate(candidate RecordCandidate) string {
	if candidate.FieldRisk != nil {
		if candidate.FieldRisk.Datetime == "high" || candidate.FieldRisk.NeedReminder == "high" || candidate.FieldRisk.Target == "high" {
			return "high"
		}
	}
	if candidate.RecordAction == "update" || candidate.RecordAction == "delete" || candidate.NeedReminder {
		return "high"
	}
	return "low"
}

func applyHardStopGate(result *Result, pending *ContextRecord) {
	reasons := hardStopReasonsForResult(result, pending)
	if len(reasons) == 0 {
		return
	}
	normalizedReasons := normalizeTraceTokens(reasons)
	result.Status = "need_confirmation"
	result.PendingState = "waiting_field"
	result.ContextState = "waiting_field"
	if result.ContextAction == "" || result.ContextAction == "none" {
		result.ContextAction = "open"
	}
	for _, reason := range normalizedReasons {
		result.MissingFields = appendMissing(result.MissingFields, missingFieldForHardStop(reason))
	}
	for index := range result.RecordCandidates {
		candidate := &result.RecordCandidates[index]
		if !candidateNeedsHardStop(*candidate, result) {
			continue
		}
		candidate.Status = "need_confirmation"
		candidate.ExecutionDecision = executionDecisionForHardStop(candidate.ExecutionDecision)
		candidate.ShouldPreview = candidate.ExecutionDecision != "no_op"
		for _, reason := range normalizedReasons {
			candidate.MissingFields = appendMissing(candidate.MissingFields, missingFieldForHardStop(reason))
		}
	}
	for index := range result.ExecutionPlan {
		item := &result.ExecutionPlan[index]
		if !executionItemNeedsHardStop(*item, result) {
			continue
		}
		item.Decision = executionDecisionForHardStop(item.Decision)
		if strings.TrimSpace(item.Reason) == "" {
			item.Reason = strings.Join(normalizedReasons, ",")
		}
	}
	if result.IntentTrace == nil {
		result.IntentTrace = &IntentTrace{}
	}
	result.IntentTrace.GateReasons = normalizeTraceTokens(append(result.IntentTrace.GateReasons, normalizedReasons...))
	if len(result.IntentTrace.RiskReasons) == 0 {
		result.IntentTrace.RiskReasons = riskReasonsForResult(result)
	}
}

func hardStopReasonsForResult(result *Result, pending *ContextRecord) []string {
	if result == nil || result.RecordAction == "none" || !result.ShouldPreview {
		return nil
	}
	reasons := []string{}
	if result.RecordAction == "update" && !isPendingContinuation(result.Intent) && result.Type == "todo" && !result.NeedReminder && result.FieldRisk != nil && result.FieldRisk.NeedReminder == "high" {
		reasons = append(reasons, "hard_stop_need_reminder_change")
	}
	if (result.RecordAction == "update" || result.RecordAction == "delete") && !isPendingContinuation(result.Intent) {
		if result.TargetID == nil || len(result.RelatedIDs) > 1 {
			reasons = append(reasons, "hard_stop_target_not_unique")
		}
		if result.FieldConfidence != nil && result.FieldConfidence.Target != nil && *result.FieldConfidence.Target < 0.85 {
			reasons = append(reasons, "hard_stop_target_not_unique")
		}
	}
	if result.NeedReminder && result.DatetimeISO == nil {
		reasons = append(reasons, "hard_stop_ambiguous_reminder_time")
	}
	if pendingDatetimeStillAmbiguous(result, pending) {
		reasons = append(reasons, "hard_stop_ambiguous_reminder_time")
	}
	if hasPrimarySensitiveMemoryIntent(result) {
		reasons = append(reasons, "hard_stop_sensitive_memory")
	}
	return normalizeTraceTokens(reasons)
}

func applyStructuredNoOpOverride(result *Result) {
	if result == nil || result.IntentTrace == nil {
		return
	}
	traceTokens := normalizeTraceTokens(append(append([]string{}, result.IntentTrace.RiskReasons...), result.IntentTrace.DiscardedAlternatives...))
	if !containsTraceTokenPrefix(traceTokens, "joke_like_content") &&
		!containsTraceTokenPrefix(traceTokens, "fictional_content") &&
		!containsTraceToken(traceTokens, "joke_response") &&
		!hasJokeResponseSecondary(result) {
		return
	}
	if result.Intent == "joke_response" {
		return
	}
	result.Intent = "joke_response"
	result.Type = "unknown"
	result.Status = "ready"
	result.MissingFields = nil
	result.RelatedIDs = nil
	result.TargetID = nil
	result.ContextTargetID = nil
	result.ContextAction = "none"
	result.PendingState = "none"
	result.ContextState = "none"
	result.RecordAction = "none"
	result.NeedReminder = false
	result.DatetimeISO = nil
	result.DatetimeText = nil
	result.ShouldPreview = false
	result.PrimaryIntent = &IntentItem{
		ID:         "intent_primary",
		Intent:     "joke_response",
		Category:   "joke_response",
		Action:     "none",
		RecordType: "unknown",
		Confidence: result.Confidence,
		Risk:       "low",
	}
	result.SecondaryIntents = nil
	result.RecordCandidates = nil
	result.ExecutionPlan = nil
	result.ReplyStrategy = &ReplyStrategy{
		FocusIntentID: "intent_primary",
		Tone:          "lively",
		Summary:       "只做轻量玩笑回应，不创建记录。",
	}
}

func hasJokeResponseSecondary(result *Result) bool {
	for _, item := range result.SecondaryIntents {
		if normalizeIntent(item.Intent) == "joke_response" || strings.TrimSpace(strings.ToLower(item.Category)) == "joke_response" {
			return true
		}
	}
	return false
}

func pendingDatetimeStillAmbiguous(result *Result, pending *ContextRecord) bool {
	if pending == nil || !isPendingContinuation(result.Intent) || !result.NeedReminder {
		return false
	}
	if !hasAnyMissing(pending.MissingFields, "datetime") && pending.PendingState != "waiting_field" && pending.ContextState != "waiting_field" {
		return false
	}
	if result.DatetimeText == nil || result.DatetimeISO == nil {
		return false
	}
	return !datetimeTextHasExplicitClock(*result.DatetimeText)
}

func datetimeTextHasExplicitClock(value string) bool {
	text := strings.TrimSpace(value)
	if text == "" {
		return false
	}
	for _, token := range []string{":", "点", "半", "一刻", "三刻"} {
		if strings.Contains(text, token) {
			return true
		}
	}
	return false
}

func containsTraceToken(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func containsTraceTokenPrefix(values []string, prefix string) bool {
	for _, value := range values {
		if strings.HasPrefix(value, prefix) {
			return true
		}
	}
	return false
}

func hasPrimarySensitiveMemoryIntent(result *Result) bool {
	if result.Type == "journal" && result.RecordAction == "create" {
		return true
	}
	if result.PrimaryIntent != nil && intentItemIsSensitiveMemory(*result.PrimaryIntent) {
		return true
	}
	for _, candidate := range result.RecordCandidates {
		if !candidate.Primary {
			continue
		}
		if candidate.Type == "journal" && candidate.RecordAction == "create" {
			return true
		}
	}
	return false
}

func intentItemIsSensitiveMemory(item IntentItem) bool {
	category := strings.TrimSpace(strings.ToLower(item.Category))
	recordType := normalizeType(item.RecordType)
	if recordType == "journal" {
		return true
	}
	return category == "emotion_signal" ||
		category == "journal_candidate" ||
		category == "long_term_memory" ||
		category == "memory_candidate" ||
		category == "proactive_followup" ||
		category == "followup_candidate"
}

func candidateNeedsHardStop(candidate RecordCandidate, result *Result) bool {
	if candidate.RecordAction == "none" {
		return false
	}
	if candidate.Primary {
		return true
	}
	if candidate.RecordAction == "delete" {
		return true
	}
	if (candidate.RecordAction == "update" || candidate.RecordAction == "delete") && candidate.TargetID == nil {
		return true
	}
	if candidate.NeedReminder && candidate.DatetimeISO == nil {
		return true
	}
	if candidate.Type == "journal" && candidate.RecordAction == "create" {
		return true
	}
	return candidate.IntentID != "" && result.PrimaryIntent != nil && candidate.IntentID == result.PrimaryIntent.ID
}

func executionItemNeedsHardStop(item ExecutionItem, result *Result) bool {
	if item.Action == "none" || item.Decision == "no_op" {
		return false
	}
	if result.PrimaryIntent != nil && item.IntentID == result.PrimaryIntent.ID {
		return true
	}
	if item.Action == "delete" {
		return true
	}
	if item.Action == "update" && item.TargetID == nil && !isPendingContinuation(result.Intent) {
		return true
	}
	return false
}

func executionDecisionForHardStop(current string) string {
	if current == "ask_clarify" {
		return "ask_clarify"
	}
	return "pending"
}

func missingFieldForHardStop(reason string) string {
	switch reason {
	case "hard_stop_delete":
		return "delete_confirmation"
	case "hard_stop_target_not_unique":
		return "target"
	case "hard_stop_ambiguous_reminder_time":
		return "datetime"
	case "hard_stop_need_reminder_change":
		return "need_reminder"
	case "hard_stop_sensitive_memory":
		return "user_confirmation"
	default:
		return "confirmation"
	}
}

func fallbackString(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}

func normalizeStringList(values []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func removeMissing(values []string, targets ...string) []string {
	targetSet := map[string]bool{}
	for _, target := range targets {
		targetSet[strings.TrimSpace(strings.ToLower(target))] = true
	}
	result := make([]string, 0, len(values))
	for _, value := range values {
		if !targetSet[value] {
			result = append(result, value)
		}
	}
	return result
}

func hasAnyMissing(values []string, targets ...string) bool {
	targetSet := map[string]bool{}
	for _, target := range targets {
		targetSet[strings.TrimSpace(strings.ToLower(target))] = true
	}
	for _, value := range values {
		if targetSet[value] {
			return true
		}
	}
	return false
}

func normalizeIntent(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "new_record", "update_record", "delete_record", "update_pending", "confirm_pending", "duplicate_check", "similar_check", "clarify", "answer_query", "joke_response", "config_update":
		return strings.TrimSpace(strings.ToLower(value))
	default:
		return "new_record"
	}
}

func normalizeRecordAction(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "create", "update", "delete", "none":
		return strings.TrimSpace(strings.ToLower(value))
	default:
		return ""
	}
}

func normalizeContextAction(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "open", "update", "close", "none":
		return strings.TrimSpace(strings.ToLower(value))
	default:
		return ""
	}
}

func normalizeRecordActionForIntent(result *Result, pending *ContextRecord) {
	switch result.Intent {
	case "answer_query", "joke_response", "config_update":
		result.RecordAction = "none"
	case "update_record", "update_pending", "confirm_pending":
		result.RecordAction = "update"
	case "delete_record":
		result.RecordAction = "delete"
	case "new_record":
		if result.RecordAction == "" {
			result.RecordAction = "create"
		}
	default:
		if result.RecordAction == "" {
			result.RecordAction = "create"
		}
	}
	if result.RecordAction == "update" || result.RecordAction == "delete" {
		if result.TargetID == nil && len(result.RelatedIDs) == 1 {
			result.TargetID = &result.RelatedIDs[0]
		}
		if result.TargetID == nil && result.ContextTargetID != nil && (result.Intent == "update_pending" || result.Intent == "confirm_pending") {
			result.TargetID = result.ContextTargetID
		}
		if result.TargetID == nil && pending != nil && (result.Intent == "update_pending" || result.Intent == "confirm_pending") {
			result.TargetID = normalizeOptionalID(&pending.ID)
		}
		if result.TargetID == nil {
			result.Status = "need_confirmation"
		}
	}
	if result.RecordAction == "none" {
		result.ShouldPreview = false
	}
}

func normalizeContextTargetForIntent(result *Result) {
	if !isPendingContinuation(result.Intent) {
		return
	}
	if result.ContextTargetID != nil {
		return
	}
	if result.TargetID != nil {
		result.ContextTargetID = result.TargetID
		return
	}
	if result.PrimaryIntent != nil && result.PrimaryIntent.TargetID != nil {
		result.ContextTargetID = result.PrimaryIntent.TargetID
	}
}

func applyNonRecordIntent(result *Result, message string) {
	if result.Intent != "joke_response" && result.Intent != "answer_query" && result.Intent != "config_update" {
		return
	}
	result.Type = "unknown"
	result.Status = "ready"
	result.MissingFields = nil
	result.RelatedIDs = nil
	result.TargetID = nil
	result.RecordAction = "none"
	result.NeedReminder = false
	result.DatetimeISO = nil
	result.DatetimeText = nil
	if strings.TrimSpace(result.Content) == "" || strings.TrimSpace(result.Content) == strings.TrimSpace(message) {
		result.Content = strings.TrimSpace(message)
	}
}

func applyReviewIntent(result *Result) {
	switch result.Intent {
	case "duplicate_check", "similar_check", "clarify":
		result.Status = "need_confirmation"
	}
}

func applyContentQuality(result *Result, original string) {
	if result.RecordAction == "none" {
		return
	}
	if strings.TrimSpace(result.Content) == "" {
		return
	}
	if strings.TrimSpace(result.Content) != strings.TrimSpace(original) {
		return
	}
	result.Status = "need_confirmation"
	result.MissingFields = appendMissing(result.MissingFields, "content")
}

func shouldPreviewResult(result *Result) bool {
	if result.RecordAction == "none" {
		return false
	}
	switch result.Intent {
	case "answer_query", "joke_response", "config_update":
		return false
	default:
		return true
	}
}

func normalizeRelatedIDs(values []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func normalizeOptionalID(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func appendMissing(values []string, value string) []string {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		return values
	}
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func fallbackTitle(value string) string {
	value = strings.TrimSpace(value)
	if len([]rune(value)) <= 24 {
		return value
	}
	return string([]rune(value)[:24])
}

func loadLocation(timezone string) *time.Location {
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		return time.FixedZone("Asia/Shanghai", 8*60*60)
	}
	return loc
}
