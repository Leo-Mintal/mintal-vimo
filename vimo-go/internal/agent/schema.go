package agent

type AnalyzeRequest struct {
	TurnID           string            `json:"turn_id,omitempty"`
	Message          string            `json:"message"`
	Timezone         string            `json:"timezone"`
	Now              string            `json:"now,omitempty"`
	ModelKey         string            `json:"model_key,omitempty"`
	PendingRecord    *ContextRecord    `json:"pending_record,omitempty"`
	RecentRecords    []ContextRecord   `json:"recent_records,omitempty"`
	OpenContexts     []ContextRecord   `json:"open_contexts,omitempty"`
	ClosedContexts   []ContextRecord   `json:"closed_contexts,omitempty"`
	RecentMessages   []ConversationMessage `json:"recent_messages,omitempty"`
	ReplyProfile     ReplyProfile      `json:"reply_profile,omitempty"`
	FastReplyContext *FastReplyContext `json:"fast_reply_context,omitempty"`
}

type Result struct {
	Type             string            `json:"type"`
	Title            string            `json:"title"`
	Content          string            `json:"content"`
	DatetimeText     *string           `json:"datetime_text"`
	DatetimeISO      *string           `json:"datetime_iso"`
	NeedReminder     bool              `json:"need_reminder"`
	Confidence       float64           `json:"confidence"`
	FieldConfidence  *FieldScores      `json:"field_confidence,omitempty"`
	FieldRisk        *FieldRisks       `json:"field_risk,omitempty"`
	Status           string            `json:"status"`
	MissingFields    []string          `json:"missing_fields"`
	Reply            string            `json:"reply"`
	Intent           string            `json:"intent,omitempty"`
	RecordAction     string            `json:"record_action,omitempty"`
	TargetID         *string           `json:"target_id,omitempty"`
	RelatedIDs       []string          `json:"related_ids,omitempty"`
	ContextAction    string            `json:"context_action,omitempty"`
	ContextTargetID  *string           `json:"context_target_id,omitempty"`
	PendingState     string            `json:"pending_state,omitempty"`
	ContextState     string            `json:"context_state,omitempty"`
	ShouldPreview    bool              `json:"should_preview"`
	SettingsPatch    *SettingsPatch    `json:"settings_patch,omitempty"`
	PrimaryIntent    *IntentItem       `json:"primary_intent,omitempty"`
	SecondaryIntents []IntentItem      `json:"secondary_intents,omitempty"`
	RecordCandidates []RecordCandidate `json:"record_candidates,omitempty"`
	ExecutionPlan    []ExecutionItem   `json:"execution_plan,omitempty"`
	ReplyStrategy    *ReplyStrategy    `json:"reply_strategy,omitempty"`
	IntentTrace      *IntentTrace      `json:"intent_trace,omitempty"`
}

type IntentItem struct {
	ID         string   `json:"id,omitempty"`
	Intent     string   `json:"intent,omitempty"`
	Category   string   `json:"category,omitempty"`
	Action     string   `json:"action,omitempty"`
	RecordType string   `json:"record_type,omitempty"`
	Confidence float64  `json:"confidence,omitempty"`
	Risk       string   `json:"risk,omitempty"`
	Evidence   []string `json:"evidence,omitempty"`
	TargetID   *string  `json:"target_id,omitempty"`
}

type RecordCandidate struct {
	ID                string       `json:"id,omitempty"`
	IntentID          string       `json:"intent_id,omitempty"`
	Type              string       `json:"type"`
	Title             string       `json:"title"`
	Content           string       `json:"content"`
	DatetimeText      *string      `json:"datetime_text"`
	DatetimeISO       *string      `json:"datetime_iso"`
	NeedReminder      bool         `json:"need_reminder"`
	Confidence        float64      `json:"confidence"`
	FieldConfidence   *FieldScores `json:"field_confidence,omitempty"`
	FieldRisk         *FieldRisks  `json:"field_risk,omitempty"`
	Status            string       `json:"status"`
	MissingFields     []string     `json:"missing_fields"`
	RecordAction      string       `json:"record_action,omitempty"`
	TargetID          *string      `json:"target_id,omitempty"`
	RelatedIDs        []string     `json:"related_ids,omitempty"`
	ExecutionDecision string       `json:"execution_decision,omitempty"`
	ShouldPreview     bool         `json:"should_preview"`
	Primary           bool         `json:"primary,omitempty"`
}

type ExecutionItem struct {
	ID          string  `json:"id,omitempty"`
	IntentID    string  `json:"intent_id,omitempty"`
	CandidateID string  `json:"candidate_id,omitempty"`
	Decision    string  `json:"decision,omitempty"`
	Action      string  `json:"action,omitempty"`
	Risk        string  `json:"risk,omitempty"`
	Reason      string  `json:"reason,omitempty"`
	TargetID    *string `json:"target_id,omitempty"`
}

type ReplyStrategy struct {
	FocusIntentID    string   `json:"focus_intent_id,omitempty"`
	Tone             string   `json:"tone,omitempty"`
	Summary          string   `json:"summary,omitempty"`
	MentionIntentIDs []string `json:"mention_intent_ids,omitempty"`
}

type IntentTrace struct {
	MatchedContextID      *string  `json:"matched_context_id,omitempty"`
	ContinuationReason    string   `json:"continuation_reason,omitempty"`
	RiskReasons           []string `json:"risk_reasons,omitempty"`
	DiscardedAlternatives []string `json:"discarded_alternatives,omitempty"`
	GateReasons           []string `json:"gate_reasons,omitempty"`
	StateTransition       string   `json:"state_transition,omitempty"`
}

type FieldScores struct {
	Type         *float64 `json:"type,omitempty"`
	Title        *float64 `json:"title,omitempty"`
	Content      *float64 `json:"content,omitempty"`
	Datetime     *float64 `json:"datetime,omitempty"`
	NeedReminder *float64 `json:"need_reminder,omitempty"`
	Target       *float64 `json:"target,omitempty"`
}

type FieldRisks struct {
	Type         string `json:"type,omitempty"`
	Title        string `json:"title,omitempty"`
	Content      string `json:"content,omitempty"`
	Datetime     string `json:"datetime,omitempty"`
	NeedReminder string `json:"need_reminder,omitempty"`
	Target       string `json:"target,omitempty"`
}

type SettingsPatch struct {
	Preset      *string `json:"preset,omitempty"`
	CustomStyle *string `json:"custom_style,omitempty"`
	Nickname    *string `json:"nickname,omitempty"`
	ModelKey    *string `json:"model_key,omitempty"`
}

type ModelOption struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Model       string `json:"model"`
	Default     bool   `json:"default"`
}

type ContextRecord struct {
	ID                 string            `json:"id,omitempty"`
	Layer              string            `json:"layer,omitempty"`
	ContextKind        string            `json:"context_kind,omitempty"`
	Type               string            `json:"type"`
	Title              string            `json:"title"`
	Content            string            `json:"content"`
	DatetimeText       *string           `json:"datetime_text,omitempty"`
	DatetimeISO        *string           `json:"datetime_iso,omitempty"`
	NeedReminder       bool              `json:"need_reminder"`
	Status             string            `json:"status"`
	Intent             string            `json:"intent,omitempty"`
	RecordAction       string            `json:"record_action,omitempty"`
	TargetID           *string           `json:"target_id,omitempty"`
	RelatedIDs         []string          `json:"related_ids,omitempty"`
	FieldConfidence    *FieldScores      `json:"field_confidence,omitempty"`
	FieldRisk          *FieldRisks       `json:"field_risk,omitempty"`
	RecordCandidates   []RecordCandidate `json:"record_candidates,omitempty"`
	ExecutionPlan      []ExecutionItem   `json:"execution_plan,omitempty"`
	PendingState       string            `json:"pending_state,omitempty"`
	ContextState       string            `json:"context_state,omitempty"`
	MissingFields      []string          `json:"missing_fields,omitempty"`
	DeletedAt          *string           `json:"deleted_at,omitempty"`
	CreatedAt          *string           `json:"created_at,omitempty"`
	UpdatedAt          *string           `json:"updated_at,omitempty"`
	LastUserMessage    *string           `json:"last_user_message,omitempty"`
	LastAssistantReply *string           `json:"last_assistant_reply,omitempty"`
}

type ReplyProfile struct {
	Preset      string `json:"preset,omitempty"`
	CustomStyle string `json:"custom_style,omitempty"`
	Nickname    string `json:"nickname,omitempty"`
}

type FastReplyContext struct {
	TurnID  string `json:"turn_id,omitempty"`
	State   string `json:"state,omitempty"`
	Content string `json:"content,omitempty"`
}

type ConversationMessage struct {
	Role      string `json:"role"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at,omitempty"`
}

type FastReplyRoute string

const (
	FastReplyRouteContinueSlow FastReplyRoute = "continue_slow"
	FastReplyRouteChatOnly     FastReplyRoute = "chat_only"
)

type FastReplyResult struct {
	Text  string         `json:"text"`
	Route FastReplyRoute `json:"route"`
}
