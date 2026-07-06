package agent

import (
	"context"
	"strings"
	"testing"

	"mintal-vimo/vimo-go/internal/llm"
)

func TestNormalizeResultMergesPendingOnlyForModelContinuationIntent(t *testing.T) {
	datetimeText := "明天"
	result := &Result{
		Type:          "unknown",
		Title:         "补充时间",
		Content:       "用户的补充内容",
		DatetimeText:  stringPtr("下午"),
		NeedReminder:  true,
		Confidence:    0.7,
		Status:        "need_confirmation",
		MissingFields: []string{"type", "title", "content", "datetime"},
		Reply:         "这条我理解是在补充上一条，还差具体时间。",
		Intent:        "update_pending",
	}
	pending := &ContextRecord{
		ID:            "msg_1",
		Type:          "todo",
		Title:         "提醒开会",
		Content:       "明天提醒我开会",
		DatetimeText:  &datetimeText,
		NeedReminder:  true,
		Status:        "need_confirmation",
		MissingFields: []string{"datetime"},
	}

	normalizeResult(result, "用户的补充内容", pending)

	if result.Type != "todo" {
		t.Fatalf("Type = %q, want todo", result.Type)
	}
	if result.Title != "提醒开会" {
		t.Fatalf("Title = %q, want pending title", result.Title)
	}
	if result.Content != "明天提醒我开会" {
		t.Fatalf("Content = %q, want pending content", result.Content)
	}
	if result.DatetimeText == nil || *result.DatetimeText != "下午" {
		t.Fatalf("DatetimeText = %v, want model supplied text", result.DatetimeText)
	}
	if len(result.MissingFields) != 1 || result.MissingFields[0] != "datetime" {
		t.Fatalf("MissingFields = %#v, want [datetime]", result.MissingFields)
	}
}

func TestNormalizeResultDoesNotMergePendingForNewRecordIntent(t *testing.T) {
	result := &Result{
		Type:          "memo",
		Title:         "新内容",
		Content:       "这是一条新备忘",
		Confidence:    0.8,
		Status:        "ready",
		MissingFields: nil,
		Reply:         "这条我作为新备忘处理。",
		Intent:        "new_record",
	}
	pending := &ContextRecord{
		ID:      "msg_1",
		Type:    "todo",
		Title:   "上一条待确认",
		Content: "上一条内容",
		Status:  "need_confirmation",
	}

	normalizeResult(result, "这是一条新备忘", pending)

	if result.Type != "memo" {
		t.Fatalf("Type = %q, want memo", result.Type)
	}
	if result.Title != "新内容" {
		t.Fatalf("Title = %q, want model title", result.Title)
	}
	if result.Content != "这是一条新备忘" {
		t.Fatalf("Content = %q, want model content", result.Content)
	}
	if result.Intent != "new_record" {
		t.Fatalf("Intent = %q, want new_record", result.Intent)
	}
}

func TestNormalizeResultConfirmPendingCanBecomeReady(t *testing.T) {
	result := &Result{
		Type:          "todo",
		Title:         "提醒开会",
		Content:       "明天 15 点提醒我开会",
		DatetimeText:  stringPtr("明天 15 点"),
		DatetimeISO:   stringPtr("2026-07-02 15:00:00"),
		NeedReminder:  true,
		Confidence:    0.86,
		Status:        "need_confirmation",
		MissingFields: []string{},
		Reply:         "我按这个时间保存。",
		Intent:        "confirm_pending",
	}
	pending := &ContextRecord{
		ID:      "msg_1",
		Type:    "todo",
		Title:   "提醒开会",
		Content: "明天提醒我开会",
		Status:  "need_confirmation",
	}

	normalizeResult(result, "确认保存", pending)

	if result.Status != "ready" {
		t.Fatalf("Status = %q, want ready", result.Status)
	}
	if result.ShouldPreview != true {
		t.Fatal("ShouldPreview = false, want true")
	}
}

func TestNormalizeResultPendingTimeKeepsPendingDateWhenUserAddsClock(t *testing.T) {
	pendingDatetimeText := "明天晚上"
	result := &Result{
		Type:          "todo",
		Title:         "打麻将",
		Content:       "打麻将",
		DatetimeText:  stringPtr("晚上九点"),
		DatetimeISO:   stringPtr("2026-07-01 21:00:00"),
		NeedReminder:  true,
		Confidence:    0.9,
		Status:        "ready",
		MissingFields: []string{},
		Reply:         "晚上九点提醒你打麻将。",
		Intent:        "update_pending",
	}
	pending := &ContextRecord{
		ID:           "pending_1",
		Type:         "todo",
		Title:        "打麻将",
		Content:      "打麻将",
		DatetimeText: &pendingDatetimeText,
		NeedReminder: true,
		Status:       "need_confirmation",
	}

	normalizeResultWithTime(result, "晚上九点吧", pending, "2026-07-01 18:03:00", "Asia/Shanghai")

	if result.DatetimeISO == nil || *result.DatetimeISO != "2026-07-02 21:00:00" {
		t.Fatalf("DatetimeISO = %v, want 2026-07-02 21:00:00", result.DatetimeISO)
	}
}

func TestNormalizeResultAnswerQueryDoesNotPreviewWhenModelSaysQuery(t *testing.T) {
	result := &Result{
		Type:          "todo",
		Title:         "查询安排",
		Content:       "用户在询问已有安排",
		Confidence:    0.7,
		Status:        "need_confirmation",
		MissingFields: []string{"type", "title", "content"},
		Reply:         "目前有一条待办需要处理。",
		Intent:        "answer_query",
	}
	pending := &ContextRecord{
		ID:      "msg_1",
		Type:    "todo",
		Title:   "待确认事项",
		Content: "待确认内容",
		Status:  "need_confirmation",
	}

	normalizeResult(result, "用户输入", pending)

	if result.Intent != "answer_query" {
		t.Fatalf("Intent = %q, want answer_query", result.Intent)
	}
	if result.ShouldPreview {
		t.Fatal("ShouldPreview = true, want false")
	}
	if result.Type != "unknown" {
		t.Fatalf("Type = %q, want unknown", result.Type)
	}
	if len(result.MissingFields) != 0 {
		t.Fatalf("MissingFields = %#v, want empty", result.MissingFields)
	}
}

func TestNormalizeResultJokeDoesNotPreviewWhenModelSaysJoke(t *testing.T) {
	result := &Result{
		Type:          "todo",
		Title:         "不可执行内容",
		Content:       "用户说了一句不应创建记录的内容",
		DatetimeText:  stringPtr("今晚"),
		DatetimeISO:   stringPtr("2026-07-01 21:00:00"),
		NeedReminder:  true,
		Confidence:    0.95,
		Status:        "ready",
		MissingFields: nil,
		Reply:         "这句我当成玩笑处理，不建记录。",
		Intent:        "joke_response",
	}

	normalizeResult(result, "用户输入", nil)

	if result.Intent != "joke_response" {
		t.Fatalf("Intent = %q, want joke_response", result.Intent)
	}
	if result.ShouldPreview {
		t.Fatal("ShouldPreview = true, want false")
	}
	if result.Type != "unknown" {
		t.Fatalf("Type = %q, want unknown", result.Type)
	}
	if result.Status != "ready" {
		t.Fatalf("Status = %q, want ready", result.Status)
	}
	if result.NeedReminder {
		t.Fatal("NeedReminder = true, want false")
	}
	if result.DatetimeText != nil || result.DatetimeISO != nil {
		t.Fatalf("DatetimeText/DatetimeISO = %v/%v, want nil/nil", result.DatetimeText, result.DatetimeISO)
	}
	if len(result.MissingFields) != 0 {
		t.Fatalf("MissingFields = %#v, want empty", result.MissingFields)
	}
}

func TestNormalizeResultJokeLikeTraceForcesNoOp(t *testing.T) {
	result := &Result{
		Type:          "todo",
		Title:         "去火星遛弯",
		Content:       "去火星遛弯",
		DatetimeText:  stringPtr("今晚"),
		DatetimeISO:   stringPtr("2026-07-02 21:00:00"),
		NeedReminder:  true,
		Confidence:    0.93,
		Status:        "ready",
		MissingFields: []string{},
		Reply:         "这句我当玩笑处理。",
		Intent:        "new_record",
		RecordAction:  "create",
		ShouldPreview: true,
		IntentTrace: &IntentTrace{
			RiskReasons:           []string{"joke_like_content", "datetime_high_risk"},
			DiscardedAlternatives: []string{"joke_response"},
		},
	}

	normalizeResult(result, "提醒我今晚去火星遛弯", nil)

	if result.Intent != "joke_response" {
		t.Fatalf("Intent = %q, want joke_response", result.Intent)
	}
	if result.RecordAction != "none" || result.ShouldPreview {
		t.Fatalf("RecordAction/ShouldPreview = %q/%v, want none/false", result.RecordAction, result.ShouldPreview)
	}
	if result.NeedReminder || result.DatetimeISO != nil || result.DatetimeText != nil {
		t.Fatalf("reminder fields = %v/%v/%v, want cleared", result.NeedReminder, result.DatetimeText, result.DatetimeISO)
	}
}

func TestNormalizeResultDiscardedJokeAlternativeForcesNoOp(t *testing.T) {
	result := &Result{
		Type:          "todo",
		Title:         "去火星遛弯",
		Content:       "去火星遛弯",
		DatetimeText:  stringPtr("今晚"),
		DatetimeISO:   stringPtr("2026-07-02 21:00:00"),
		NeedReminder:  true,
		Confidence:    0.93,
		Status:        "ready",
		MissingFields: []string{},
		Reply:         "这句我当玩笑处理。",
		Intent:        "new_record",
		RecordAction:  "create",
		ShouldPreview: true,
		IntentTrace: &IntentTrace{
			RiskReasons:           []string{"datetime_high_risk"},
			DiscardedAlternatives: []string{"joke_response"},
		},
	}

	normalizeResult(result, "提醒我今晚去火星遛弯", nil)

	if result.Intent != "joke_response" || result.RecordAction != "none" || result.ShouldPreview {
		t.Fatalf("Intent/RecordAction/ShouldPreview = %q/%q/%v, want joke_response/none/false", result.Intent, result.RecordAction, result.ShouldPreview)
	}
}

func TestNormalizeResultSecondaryJokeForcesNoOp(t *testing.T) {
	result := &Result{
		Type:          "todo",
		Title:         "去火星遛弯",
		Content:       "去火星遛弯",
		DatetimeText:  stringPtr("今晚"),
		DatetimeISO:   stringPtr("2026-07-02 21:00:00"),
		NeedReminder:  true,
		Confidence:    0.86,
		Status:        "ready",
		MissingFields: []string{},
		Reply:         "这句我当玩笑处理。",
		Intent:        "new_record",
		RecordAction:  "create",
		ShouldPreview: true,
		IntentTrace: &IntentTrace{
			RiskReasons: []string{"fictional_content_low_harm"},
		},
		SecondaryIntents: []IntentItem{{
			ID:         "intent_secondary_1",
			Intent:     "joke_response",
			Category:   "other",
			Action:     "none",
			RecordType: "unknown",
			Confidence: 0.76,
		}},
	}

	normalizeResult(result, "提醒我今晚去火星遛弯", nil)

	if result.Intent != "joke_response" || result.RecordAction != "none" || result.ShouldPreview {
		t.Fatalf("Intent/RecordAction/ShouldPreview = %q/%q/%v, want joke_response/none/false", result.Intent, result.RecordAction, result.ShouldPreview)
	}
	if len(result.RecordCandidates) != 0 || len(result.ExecutionPlan) != 1 || result.ExecutionPlan[0].Decision != "no_op" {
		t.Fatalf("RecordCandidates/ExecutionPlan = %#v/%#v, want no-op stack", result.RecordCandidates, result.ExecutionPlan)
	}
}

func TestNormalizeResultReviewIntentRequiresConfirmation(t *testing.T) {
	result := &Result{
		Type:          "todo",
		Title:         "相近事项",
		Content:       "这条可能和已有记录相近",
		Confidence:    0.82,
		Status:        "ready",
		MissingFields: []string{},
		Reply:         "这条和已有记录有点像，我先让你确认一下。",
		Intent:        "similar_check",
		RelatedIDs:    []string{"record_1"},
	}

	normalizeResult(result, "用户输入", nil)

	if result.Status != "need_confirmation" {
		t.Fatalf("Status = %q, want need_confirmation", result.Status)
	}
	if !result.ShouldPreview {
		t.Fatal("ShouldPreview = false, want true")
	}
}

func TestNormalizeResultPendingDatetimeStillAmbiguousRequiresConfirmation(t *testing.T) {
	result := &Result{
		Type:            "todo",
		Title:           "给张三打电话",
		Content:         "给张三打电话",
		DatetimeText:    stringPtr("明天上午"),
		DatetimeISO:     stringPtr("2026-07-03 09:00:00"),
		NeedReminder:    true,
		Confidence:      0.95,
		Status:          "ready",
		MissingFields:   []string{},
		Reply:           "我先按明天上午处理。",
		Intent:          "update_pending",
		RecordAction:    "update",
		TargetID:        stringPtr("ctx_call"),
		ContextTargetID: stringPtr("ctx_call"),
		FieldConfidence: &FieldScores{
			Datetime:     floatPtr(0.9),
			NeedReminder: floatPtr(0.99),
			Target:       floatPtr(0.96),
		},
		FieldRisk: &FieldRisks{
			Datetime:     "high",
			NeedReminder: "high",
			Target:       "high",
		},
	}
	pendingDatetimeText := "明天上午"
	pending := &ContextRecord{
		ID:            "ctx_call",
		Type:          "todo",
		Title:         "提醒打电话",
		Content:       "打电话",
		DatetimeText:  &pendingDatetimeText,
		NeedReminder:  true,
		Status:        "need_confirmation",
		PendingState:  "waiting_field",
		MissingFields: []string{"datetime"},
	}

	normalizeResultWithTime(result, "改成提醒我给张三打电话", pending, "2026-07-02 12:00:00", "Asia/Shanghai")

	if result.Status != "need_confirmation" {
		t.Fatalf("Status = %q, want need_confirmation", result.Status)
	}
	if result.IntentTrace == nil || !hasString(result.IntentTrace.GateReasons, "hard_stop_ambiguous_reminder_time") {
		t.Fatalf("GateReasons = %#v, want hard_stop_ambiguous_reminder_time", result.IntentTrace)
	}
	if len(result.RecordCandidates) == 0 || result.RecordCandidates[0].ExecutionDecision == "auto_execute" {
		t.Fatalf("RecordCandidates = %#v, want non-auto primary", result.RecordCandidates)
	}
}

func TestNormalizeResultRequiresConfirmationWhenContentCopiesOriginal(t *testing.T) {
	result := &Result{
		Type:          "todo",
		Title:         "今晚晒衣服",
		Content:       "今晚晒衣服",
		Confidence:    0.95,
		Status:        "ready",
		MissingFields: []string{},
		Reply:         "我记录下来了。",
		Intent:        "new_record",
		RecordAction:  "create",
	}

	normalizeResult(result, "今晚晒衣服", nil)

	if result.Status != "need_confirmation" {
		t.Fatalf("Status = %q, want need_confirmation", result.Status)
	}
	if len(result.MissingFields) != 1 || result.MissingFields[0] != "content" {
		t.Fatalf("MissingFields = %#v, want [content]", result.MissingFields)
	}
	if !result.ShouldPreview {
		t.Fatal("ShouldPreview = false, want true")
	}
}

func TestNormalizeResultUpdateRecordUsesRelatedIDAsTarget(t *testing.T) {
	result := &Result{
		Type:          "todo",
		Title:         "提醒晒衣服",
		Content:       "晚九点提醒我晒衣服",
		Confidence:    0.92,
		Status:        "ready",
		MissingFields: []string{},
		Reply:         "我把那条晒衣服的提醒改到九点。",
		Intent:        "update_record",
		RelatedIDs:    []string{"record_1"},
	}

	normalizeResult(result, "九点吧", nil)

	if result.RecordAction != "update" {
		t.Fatalf("RecordAction = %q, want update", result.RecordAction)
	}
	if result.TargetID == nil || *result.TargetID != "record_1" {
		t.Fatalf("TargetID = %v, want record_1", result.TargetID)
	}
	if result.Status != "ready" {
		t.Fatalf("Status = %q, want ready", result.Status)
	}
	if !result.ShouldPreview {
		t.Fatal("ShouldPreview = false, want true")
	}
}

func TestNormalizeResultDeleteRecordUsesRelatedIDAsTarget(t *testing.T) {
	result := &Result{
		Type:          "todo",
		Title:         "取消晒衣服",
		Content:       "不再需要晒衣服提醒",
		Confidence:    0.9,
		Status:        "ready",
		MissingFields: []string{},
		Reply:         "我会删掉那条晒衣服提醒。",
		Intent:        "delete_record",
		RelatedIDs:    []string{"record_1"},
	}

	normalizeResult(result, "我不想晒了", nil)

	if result.RecordAction != "delete" {
		t.Fatalf("RecordAction = %q, want delete", result.RecordAction)
	}
	if result.TargetID == nil || *result.TargetID != "record_1" {
		t.Fatalf("TargetID = %v, want record_1", result.TargetID)
	}
	if result.Status != "ready" {
		t.Fatalf("Status = %q, want ready", result.Status)
	}
	if !result.ShouldPreview {
		t.Fatal("ShouldPreview = false, want true")
	}
	if result.PendingState != "ready_to_execute" {
		t.Fatalf("PendingState = %q, want ready_to_execute", result.PendingState)
	}
	if result.IntentTrace != nil && hasString(result.IntentTrace.GateReasons, "hard_stop_delete") {
		t.Fatalf("GateReasons = %#v, did not expect hard_stop_delete", result.IntentTrace)
	}
}

func TestNormalizeResultRecordActionWithoutTargetRequiresConfirmation(t *testing.T) {
	result := &Result{
		Type:          "todo",
		Title:         "修改提醒",
		Content:       "修改一条提醒",
		Confidence:    0.9,
		Status:        "ready",
		MissingFields: []string{},
		Reply:         "我需要先确认要改哪一条。",
		Intent:        "update_record",
	}

	normalizeResult(result, "改一下提醒", nil)

	if result.RecordAction != "update" {
		t.Fatalf("RecordAction = %q, want update", result.RecordAction)
	}
	if result.TargetID != nil {
		t.Fatalf("TargetID = %v, want nil", result.TargetID)
	}
	if result.Status != "need_confirmation" {
		t.Fatalf("Status = %q, want need_confirmation", result.Status)
	}
	if !result.ShouldPreview {
		t.Fatal("ShouldPreview = false, want true")
	}
}

func TestNormalizeResultUpdateRecordWithMultipleRelatedIDsDoesNotPickFirstTarget(t *testing.T) {
	result := &Result{
		Type:          "todo",
		Title:         "修改提醒",
		Content:       "修改一条提醒",
		Confidence:    0.9,
		Status:        "ready",
		MissingFields: []string{},
		Reply:         "我需要先确认要改哪一条。",
		Intent:        "update_record",
		RelatedIDs:    []string{"record_1", "record_2"},
	}

	normalizeResult(result, "改一下提醒", nil)

	if result.TargetID != nil {
		t.Fatalf("TargetID = %v, want nil for non-unique target", result.TargetID)
	}
	if result.Status != "need_confirmation" {
		t.Fatalf("Status = %q, want need_confirmation", result.Status)
	}
	if result.IntentTrace == nil || !hasString(result.IntentTrace.GateReasons, "hard_stop_target_not_unique") {
		t.Fatalf("GateReasons = %#v, want hard_stop_target_not_unique", result.IntentTrace)
	}
}

func TestNormalizeResultUpdateRecordWithLowTargetConfidenceRequiresConfirmation(t *testing.T) {
	result := &Result{
		Type:          "todo",
		Title:         "交周报",
		Content:       "交周报",
		Confidence:    0.93,
		Status:        "ready",
		MissingFields: []string{},
		Reply:         "我需要先确认要改哪一条。",
		Intent:        "update_record",
		RecordAction:  "update",
		TargetID:      stringPtr("record_1"),
		FieldConfidence: &FieldScores{
			Target: floatPtr(0.22),
		},
	}

	normalizeResult(result, "把明天那个提醒改到晚上", nil)

	if result.TargetID == nil || *result.TargetID != "record_1" {
		t.Fatalf("TargetID = %v, want preserved model target for review", result.TargetID)
	}
	if result.Status != "need_confirmation" {
		t.Fatalf("Status = %q, want need_confirmation", result.Status)
	}
	if result.IntentTrace == nil || !hasString(result.IntentTrace.GateReasons, "hard_stop_target_not_unique") {
		t.Fatalf("GateReasons = %#v, want hard_stop_target_not_unique", result.IntentTrace)
	}
}

func TestNormalizeResultNeedReminderChangeRequiresConfirmation(t *testing.T) {
	result := &Result{
		Type:          "todo",
		Title:         "交周报",
		Content:       "交周报",
		DatetimeText:  stringPtr("明天下午三点"),
		DatetimeISO:   stringPtr("2026-07-03 15:00:00"),
		NeedReminder:  false,
		Confidence:    0.98,
		Status:        "ready",
		MissingFields: []string{},
		Reply:         "我先确认是否取消提醒。",
		Intent:        "update_record",
		RecordAction:  "update",
		TargetID:      stringPtr("rec_report"),
		FieldRisk: &FieldRisks{
			NeedReminder: "high",
			Target:       "high",
		},
	}

	normalizeResult(result, "把交周报的提醒删掉", nil)

	if result.Status != "need_confirmation" {
		t.Fatalf("Status = %q, want need_confirmation", result.Status)
	}
	if result.IntentTrace == nil || !hasString(result.IntentTrace.GateReasons, "hard_stop_need_reminder_change") {
		t.Fatalf("GateReasons = %#v, want hard_stop_need_reminder_change", result.IntentTrace)
	}
	if len(result.ExecutionPlan) == 0 || result.ExecutionPlan[0].Decision == "auto_execute" {
		t.Fatalf("ExecutionPlan = %#v, want non-auto", result.ExecutionPlan)
	}
}

func TestNormalizeResultJournalCreateRequiresConfirmation(t *testing.T) {
	result := &Result{
		Type:          "journal",
		Title:         "今天状态",
		Content:       "我今天有点难过。",
		Confidence:    0.9,
		Status:        "ready",
		MissingFields: []string{},
		Reply:         "我先整理成日记草稿，等你确认。",
		Intent:        "new_record",
		RecordAction:  "create",
		ShouldPreview: true,
		PrimaryIntent: &IntentItem{
			ID:         "intent_journal",
			Intent:     "new_record",
			Category:   "journal_candidate",
			Action:     "create_record",
			RecordType: "journal",
			Confidence: 0.9,
			Risk:       "high",
		},
	}

	normalizeResult(result, "今天有点难过", nil)

	if result.Status != "need_confirmation" {
		t.Fatalf("Status = %q, want need_confirmation", result.Status)
	}
	if result.IntentTrace == nil || !hasString(result.IntentTrace.GateReasons, "hard_stop_sensitive_memory") {
		t.Fatalf("GateReasons = %#v, want hard_stop_sensitive_memory", result.IntentTrace)
	}
}

func TestNormalizeResultNormalizesFieldRiskMetadata(t *testing.T) {
	result := &Result{
		Type:       "todo",
		Title:      "提醒开会",
		Content:    "开会",
		Confidence: 0.9,
		Status:     "ready",
		Reply:      "我记录下来了。",
		Intent:     "new_record",
		FieldConfidence: &FieldScores{
			Type:         floatPtr(1.2),
			Datetime:     floatPtr(-0.3),
			NeedReminder: floatPtr(0.7),
		},
		FieldRisk: &FieldRisks{
			Type:         "LOW",
			Datetime:     "HIGH",
			NeedReminder: "unknown",
		},
	}

	normalizeResult(result, "明天提醒我开会", nil)

	if result.FieldConfidence == nil {
		t.Fatal("FieldConfidence = nil, want normalized scores")
	}
	if result.FieldConfidence.Type == nil || *result.FieldConfidence.Type != 1 {
		t.Fatalf("FieldConfidence.Type = %v, want 1", result.FieldConfidence.Type)
	}
	if result.FieldConfidence.Datetime == nil || *result.FieldConfidence.Datetime != 0 {
		t.Fatalf("FieldConfidence.Datetime = %v, want 0", result.FieldConfidence.Datetime)
	}
	if result.FieldRisk == nil {
		t.Fatal("FieldRisk = nil, want normalized risks")
	}
	if result.FieldRisk.Type != "low" {
		t.Fatalf("FieldRisk.Type = %q, want low", result.FieldRisk.Type)
	}
	if result.FieldRisk.Datetime != "high" {
		t.Fatalf("FieldRisk.Datetime = %q, want high", result.FieldRisk.Datetime)
	}
	if result.FieldRisk.NeedReminder != "" {
		t.Fatalf("FieldRisk.NeedReminder = %q, want empty invalid risk", result.FieldRisk.NeedReminder)
	}
}

func TestNormalizeResultSeedsLegacyFieldsFromIntentStack(t *testing.T) {
	result := &Result{
		Reply: "已为你记录交周报，另有一个日记草稿可确认。",
		PrimaryIntent: &IntentItem{
			ID:         "intent_todo",
			Intent:     "new_record",
			Category:   "todo_candidate",
			Action:     "create_record",
			RecordType: "todo",
			Confidence: 0.96,
			Risk:       "high",
			Evidence:   []string{"明天下午三点提醒我交周报"},
		},
		SecondaryIntents: []IntentItem{{
			ID:         "intent_emotion",
			Intent:     "new_record",
			Category:   "emotion_signal",
			Action:     "create_record",
			RecordType: "journal",
			Confidence: 0.84,
			Risk:       "high",
			Evidence:   []string{"最近这个项目真的让我很焦虑"},
		}},
		RecordCandidates: []RecordCandidate{
			{
				ID:                "todo_candidate",
				IntentID:          "intent_todo",
				Type:              "todo",
				Title:             "交周报",
				Content:           "交周报",
				DatetimeText:      stringPtr("明天下午三点"),
				DatetimeISO:       stringPtr("2026-07-03 15:00:00"),
				NeedReminder:      true,
				Confidence:        0.96,
				Status:            "ready",
				RecordAction:      "create",
				ExecutionDecision: "auto_execute",
				Primary:           true,
			},
			{
				ID:                "journal_candidate",
				IntentID:          "intent_emotion",
				Type:              "journal",
				Title:             "项目焦虑",
				Content:           "最近这个项目让我感到焦虑。",
				Confidence:        0.84,
				Status:            "ready",
				RecordAction:      "create",
				ExecutionDecision: "auto_execute",
			},
		},
	}

	normalizeResultWithTime(result, "明天下午三点提醒我交周报，最近这个项目真的让我很焦虑", nil, "2026-07-02 12:00:00", "Asia/Shanghai")

	if result.Intent != "new_record" {
		t.Fatalf("Intent = %q, want new_record", result.Intent)
	}
	if result.Type != "todo" {
		t.Fatalf("Type = %q, want todo", result.Type)
	}
	if result.Title != "交周报" {
		t.Fatalf("Title = %q, want primary candidate title", result.Title)
	}
	if len(result.RecordCandidates) != 2 {
		t.Fatalf("RecordCandidates len = %d, want 2", len(result.RecordCandidates))
	}
	if result.RecordCandidates[1].ExecutionDecision == "auto_execute" {
		t.Fatal("journal secondary candidate should not auto_execute")
	}
	if len(result.ExecutionPlan) != 2 {
		t.Fatalf("ExecutionPlan len = %d, want 2", len(result.ExecutionPlan))
	}
	if result.ExecutionPlan[1].Decision == "auto_execute" {
		t.Fatal("journal secondary execution item should not auto_execute")
	}
}

func TestNormalizeResultAllowsHighConfidenceTodoSecondaryAutoExecute(t *testing.T) {
	result := &Result{
		Type:         "todo",
		Title:        "去健身",
		Content:      "去健身",
		Confidence:   0.93,
		Status:       "ready",
		Intent:       "update_record",
		RecordAction: "update",
		TargetID:     stringPtr("rec_gym"),
		RecordCandidates: []RecordCandidate{
			{
				ID:                "candidate_gym",
				IntentID:          "intent_gym",
				Type:              "todo",
				Title:             "去健身",
				Content:           "去健身",
				DatetimeText:      stringPtr("17:00"),
				DatetimeISO:       stringPtr("2026-07-03 17:00:00"),
				NeedReminder:      true,
				Confidence:        0.93,
				Status:            "ready",
				RecordAction:      "update",
				TargetID:          stringPtr("rec_gym"),
				ExecutionDecision: "auto_execute",
				Primary:           true,
			},
			{
				ID:                "candidate_sleep",
				IntentID:          "intent_sleep",
				Type:              "todo",
				Title:             "睡觉提醒",
				Content:           "晚上十一点提醒睡觉",
				DatetimeText:      stringPtr("晚上十一点"),
				DatetimeISO:       stringPtr("2026-07-03 23:00:00"),
				NeedReminder:      true,
				Confidence:        0.94,
				Status:            "ready",
				RecordAction:      "create",
				ExecutionDecision: "auto_execute",
			},
		},
	}

	normalizeResultWithTime(result, "健身改到5点吧，同时十一点提醒睡觉", nil, "2026-07-03 13:52:00", "Asia/Shanghai")

	if result.RecordCandidates[1].ExecutionDecision != "auto_execute" {
		t.Fatalf("secondary todo candidate decision = %q, want auto_execute", result.RecordCandidates[1].ExecutionDecision)
	}
	if len(result.ExecutionPlan) != 2 || result.ExecutionPlan[1].Decision != "auto_execute" {
		t.Fatalf("ExecutionPlan = %#v, want secondary todo auto_execute", result.ExecutionPlan)
	}
}

func TestNormalizeResultPendingTimeAnswerKeepsEmotionSecondary(t *testing.T) {
	pendingDatetimeText := "今晚"
	result := &Result{
		Reply: "收到，先把洗澡提醒补到今晚八点。你说难受我也看到了，我可以把这段心情先整理成日记草稿。",
		PrimaryIntent: &IntentItem{
			ID:         "intent_pending_time",
			Intent:     "update_pending",
			Category:   "context_update",
			Action:     "update_record",
			RecordType: "todo",
			Confidence: 0.92,
			Risk:       "high",
			Evidence:   []string{"八点吧"},
			TargetID:   stringPtr("ctx_shower"),
		},
		SecondaryIntents: []IntentItem{{
			ID:         "intent_emotion",
			Intent:     "new_record",
			Category:   "emotion_signal",
			Action:     "create_record",
			RecordType: "journal",
			Confidence: 0.78,
			Risk:       "high",
			Evidence:   []string{"难受"},
		}},
		RecordCandidates: []RecordCandidate{
			{
				ID:                "candidate_shower",
				IntentID:          "intent_pending_time",
				Type:              "todo",
				Title:             "提醒洗澡",
				Content:           "洗澡",
				DatetimeText:      stringPtr("八点"),
				DatetimeISO:       stringPtr("2026-07-02 20:00:00"),
				NeedReminder:      true,
				Confidence:        0.92,
				Status:            "ready",
				RecordAction:      "update",
				TargetID:          stringPtr("ctx_shower"),
				ExecutionDecision: "auto_execute",
				Primary:           true,
			},
			{
				ID:                "candidate_emotion",
				IntentID:          "intent_emotion",
				Type:              "journal",
				Title:             "难受",
				Content:           "我感到难受。",
				Confidence:        0.78,
				Status:            "ready",
				RecordAction:      "create",
				ExecutionDecision: "auto_execute",
			},
		},
		ExecutionPlan: []ExecutionItem{
			{
				ID:          "exec_update_time",
				IntentID:    "intent_pending_time",
				CandidateID: "candidate_shower",
				Decision:    "auto_execute",
				Action:      "update",
				Risk:        "high",
				TargetID:    stringPtr("ctx_shower"),
			},
			{
				ID:          "exec_emotion",
				IntentID:    "intent_emotion",
				CandidateID: "candidate_emotion",
				Decision:    "auto_execute",
				Action:      "create",
				Risk:        "high",
			},
		},
		ReplyStrategy: &ReplyStrategy{
			FocusIntentID:    "intent_pending_time",
			Tone:             "warm",
			Summary:          "先更新洗澡提醒，再轻量回应情绪。",
			MentionIntentIDs: []string{"intent_emotion"},
		},
		IntentTrace: &IntentTrace{
			MatchedContextID:      stringPtr("ctx_shower"),
			ContinuationReason:    "answering_missing_datetime",
			RiskReasons:           []string{"datetime high risk", "need_reminder_high_risk"},
			DiscardedAlternatives: []string{"journal_as_primary"},
			StateTransition:       "open->ready_to_execute",
		},
	}
	pending := &ContextRecord{
		ID:            "ctx_shower",
		Type:          "todo",
		Title:         "提醒洗澡",
		Content:       "洗澡",
		DatetimeText:  &pendingDatetimeText,
		NeedReminder:  true,
		Status:        "need_confirmation",
		MissingFields: []string{"datetime"},
	}

	normalizeResultWithTime(result, "八点吧，难受", pending, "2026-07-02 16:36:18", "Asia/Shanghai")

	if result.Intent != "update_pending" {
		t.Fatalf("Intent = %q, want update_pending", result.Intent)
	}
	if result.Type != "todo" || result.Title != "提醒洗澡" || result.Content != "洗澡" {
		t.Fatalf("primary legacy fields = %q/%q/%q, want todo/提醒洗澡/洗澡", result.Type, result.Title, result.Content)
	}
	if result.TargetID == nil || *result.TargetID != "ctx_shower" {
		t.Fatalf("TargetID = %v, want ctx_shower", result.TargetID)
	}
	if result.ContextTargetID == nil || *result.ContextTargetID != "ctx_shower" {
		t.Fatalf("ContextTargetID = %v, want ctx_shower", result.ContextTargetID)
	}
	if result.DatetimeISO == nil || *result.DatetimeISO != "2026-07-02 20:00:00" {
		t.Fatalf("DatetimeISO = %v, want 2026-07-02 20:00:00", result.DatetimeISO)
	}
	if len(result.SecondaryIntents) != 1 || result.SecondaryIntents[0].Category != "emotion_signal" {
		t.Fatalf("SecondaryIntents = %#v, want emotion_signal", result.SecondaryIntents)
	}
	if len(result.RecordCandidates) != 2 {
		t.Fatalf("RecordCandidates len = %d, want 2", len(result.RecordCandidates))
	}
	if result.RecordCandidates[0].Content != "洗澡" {
		t.Fatalf("primary candidate content = %q, want pending content", result.RecordCandidates[0].Content)
	}
	if result.RecordCandidates[1].ExecutionDecision == "auto_execute" {
		t.Fatal("emotion secondary candidate should not auto_execute")
	}
	if result.RecordCandidates[0].ExecutionDecision != "auto_execute" {
		t.Fatalf("primary candidate decision = %q, want auto_execute", result.RecordCandidates[0].ExecutionDecision)
	}
	if len(result.ExecutionPlan) != 2 || result.ExecutionPlan[1].Decision == "auto_execute" {
		t.Fatalf("ExecutionPlan = %#v, secondary should not auto_execute", result.ExecutionPlan)
	}
	if result.ExecutionPlan[0].Decision != "auto_execute" {
		t.Fatalf("primary execution decision = %q, want auto_execute", result.ExecutionPlan[0].Decision)
	}
	if result.ReplyStrategy == nil || result.ReplyStrategy.FocusIntentID != "intent_pending_time" || len(result.ReplyStrategy.MentionIntentIDs) != 1 {
		t.Fatalf("ReplyStrategy = %#v, want focus primary and mention emotion", result.ReplyStrategy)
	}
	if result.PendingState != "ready_to_execute" || result.ContextState != "ready_to_execute" {
		t.Fatalf("PendingState/ContextState = %q/%q, want ready_to_execute/ready_to_execute", result.PendingState, result.ContextState)
	}
	if result.IntentTrace == nil || result.IntentTrace.MatchedContextID == nil || *result.IntentTrace.MatchedContextID != "ctx_shower" {
		t.Fatalf("IntentTrace = %#v, want matched context", result.IntentTrace)
	}
	if result.IntentTrace.ContinuationReason != "answering_missing_datetime" {
		t.Fatalf("ContinuationReason = %q, want answering_missing_datetime", result.IntentTrace.ContinuationReason)
	}
	if len(result.IntentTrace.RiskReasons) != 2 || result.IntentTrace.RiskReasons[0] != "datetime_high_risk" {
		t.Fatalf("RiskReasons = %#v, want normalized risk reasons", result.IntentTrace.RiskReasons)
	}
}

func TestAnalyzePayloadHasNoLocalIntentFlags(t *testing.T) {
	provider := &stubProvider{responses: []string{`{
		"type":"unknown",
		"title":"聊天",
		"content":"用户输入",
		"datetime_text":null,
		"datetime_iso":null,
		"need_reminder":false,
		"confidence":0.8,
		"status":"ready",
		"missing_fields":[],
		"reply":"我在。",
		"intent":"answer_query",
		"record_action":"none",
		"target_id":null,
		"related_ids":[],
		"should_preview":false
	}`}}
	service := NewService(provider, "system prompt")

	_, err := service.Analyze(context.Background(), AnalyzeRequest{
		Message:  "用户输入",
		Timezone: "Asia/Shanghai",
		Now:      "2026-07-01 13:00:00",
	})

	if err != nil {
		t.Fatalf("Analyze() error = %v", err)
	}
	if provider.calls != 1 {
		t.Fatalf("provider calls = %d, want 1", provider.calls)
	}
	payload := provider.requests[0].Messages[1].Content
	if strings.Contains(payload, "playful_boundary") {
		t.Fatalf("prompt payload = %s, should not include local intent flags", payload)
	}
}

func TestAnalyzePayloadUsesLayeredContexts(t *testing.T) {
	provider := &stubProvider{responses: []string{`{
		"type":"todo",
		"title":"提醒吃饭",
		"content":"吃饭",
		"datetime_text":"饭点",
		"datetime_iso":null,
		"need_reminder":true,
		"confidence":0.7,
		"status":"need_confirmation",
		"missing_fields":["datetime"],
		"reply":"我继续按这条提醒补信息。",
		"intent":"update_pending",
		"record_action":"update",
		"target_id":"ctx_1",
		"context_action":"update",
		"context_target_id":"ctx_1",
		"related_ids":[],
		"should_preview":true
	}`}}
	service := NewService(provider, "system prompt")

	_, err := service.Analyze(context.Background(), AnalyzeRequest{
		Message:  "饭点提醒我就行",
		Timezone: "Asia/Shanghai",
		Now:      "2026-07-02 10:17:00",
		OpenContexts: []ContextRecord{{
			ID:            "ctx_1",
			ContextKind:   "record",
			PendingState:  "waiting_field",
			Type:          "todo",
			Title:         "提醒吃饭",
			Content:       "吃饭",
			NeedReminder:  true,
			Status:        "need_confirmation",
			Intent:        "delete_record",
			RecordAction:  "delete",
			TargetID:      stringPtr("rec_1"),
			RelatedIDs:    []string{"rec_1", "rec_2"},
			MissingFields: []string{"datetime"},
		}},
		ClosedContexts: []ContextRecord{{
			ID:      "rec_1",
			Type:    "memo",
			Title:   "历史记录",
			Content: "历史内容",
			Status:  "saved",
		}},
	})

	if err != nil {
		t.Fatalf("Analyze() error = %v", err)
	}
	payload := provider.requests[0].Messages[1].Content
	if !strings.Contains(payload, `"open_contexts"`) {
		t.Fatalf("payload = %s, want open_contexts", payload)
	}
	if !strings.Contains(payload, `"closed_contexts"`) {
		t.Fatalf("payload = %s, want closed_contexts", payload)
	}
	if !strings.Contains(payload, `"layer":"open"`) {
		t.Fatalf("payload = %s, want open layer", payload)
	}
	if !strings.Contains(payload, `"layer":"closed"`) {
		t.Fatalf("payload = %s, want closed layer", payload)
	}
	if !strings.Contains(payload, `"pending_state":"waiting_field"`) {
		t.Fatalf("payload = %s, want pending state", payload)
	}
	if !strings.Contains(payload, `"record_action":"delete"`) || !strings.Contains(payload, `"target_id":"rec_1"`) || !strings.Contains(payload, `"related_ids":["rec_1","rec_2"]`) {
		t.Fatalf("payload = %s, want pending action target context", payload)
	}
}

func TestAnalyzePayloadIncludesFastReplyContext(t *testing.T) {
	provider := &stubProvider{responses: []string{`{
		"type":"todo",
		"title":"提醒洗衣服",
		"content":"洗衣服",
		"datetime_text":"晚上八点",
		"datetime_iso":"2026-07-03 20:00:00",
		"need_reminder":true,
		"confidence":0.9,
		"status":"ready",
		"missing_fields":[],
		"reply":"晚上八点的提醒已进入待办。",
		"intent":"new_record",
		"record_action":"create",
		"target_id":null,
		"related_ids":[],
		"should_preview":true
	}`}}
	service := NewService(provider, "system prompt")

	_, err := service.Analyze(context.Background(), AnalyzeRequest{
		TurnID:   "turn_123",
		Message:  "我今天有点难过，晚上八点提醒我洗衣服",
		Timezone: "Asia/Shanghai",
		Now:      "2026-07-03 13:00:00",
		FastReplyContext: &FastReplyContext{
			TurnID:  "turn_123",
			State:   "done",
			Content: "老板别难过啦，我来帮你设置晚上八点的提醒",
		},
	})

	if err != nil {
		t.Fatalf("Analyze() error = %v", err)
	}
	payload := provider.requests[0].Messages[1].Content
	if !strings.Contains(payload, `"turn_id":"turn_123"`) {
		t.Fatalf("payload = %s, want turn id", payload)
	}
	if !strings.Contains(payload, `"fast_reply_context"`) {
		t.Fatalf("payload = %s, want fast reply context", payload)
	}
	if !strings.Contains(payload, `"content":"老板别难过啦，我来帮你设置晚上八点的提醒"`) {
		t.Fatalf("payload = %s, want fast reply content", payload)
	}
	if !strings.Contains(payload, `"state":"done"`) {
		t.Fatalf("payload = %s, want fast reply state", payload)
	}
}

func TestAnalyzePayloadIncludesRecentMessages(t *testing.T) {
	provider := &stubProvider{responses: []string{`{
		"type":"unknown",
		"title":"闲聊",
		"content":"用户在继续闲聊",
		"datetime_text":null,
		"datetime_iso":null,
		"need_reminder":false,
		"confidence":0.9,
		"status":"ready",
		"missing_fields":[],
		"reply":"我觉得这种问题更像一种想象和信念，每个人答案都不太一样。",
		"intent":"answer_query",
		"record_action":"none",
		"target_id":null,
		"related_ids":[],
		"context_action":"none",
		"pending_state":"none",
		"context_state":"none",
		"should_preview":false
	}`}}
	service := NewService(provider, "system prompt")

	_, err := service.Analyze(context.Background(), AnalyzeRequest{
		Message:  "你觉得呢？",
		Timezone: "Asia/Shanghai",
		Now:      "2026-07-03 16:30:10",
		RecentMessages: []ConversationMessage{
			{Role: "user", Content: "我突然想到人是不是都有上辈子啊", CreatedAt: "2026-07-03 16:30:00"},
			{Role: "assistant", Content: "这倒是个让人忍不住多想几秒的问题。", CreatedAt: "2026-07-03 16:30:00"},
		},
		OpenContexts: []ContextRecord{{
			ID:            "ctx_journal",
			ContextKind:   "record",
			PendingState:  "waiting_field",
			Type:          "journal",
			Title:         "状态记录",
			Content:       "关于上辈子的想法",
			Status:        "need_confirmation",
			MissingFields: []string{"datetime"},
		}},
	})

	if err != nil {
		t.Fatalf("Analyze() error = %v", err)
	}
	payload := provider.requests[0].Messages[1].Content
	if !strings.Contains(payload, `"recent_messages"`) {
		t.Fatalf("payload = %s, want recent messages", payload)
	}
	if !strings.Contains(payload, `"content":"我突然想到人是不是都有上辈子啊"`) {
		t.Fatalf("payload = %s, want prior user message", payload)
	}
	if !strings.Contains(payload, `"open_contexts"`) {
		t.Fatalf("payload = %s, want open contexts preserved", payload)
	}
}

func TestAnalyzeDoesNotFallbackToFixedReplyWhenModelReturnsInvalidJSON(t *testing.T) {
	provider := &stubProvider{responses: []string{`这不是 JSON`}}
	service := NewService(provider, "system prompt")

	_, err := service.Analyze(context.Background(), AnalyzeRequest{
		Message:  "用户输入",
		Timezone: "Asia/Shanghai",
		Now:      "2026-07-01 13:00:00",
	})

	if err == nil {
		t.Fatal("Analyze() error = nil, want parse error")
	}
}

func TestAnalyzeRequiresModelGeneratedReply(t *testing.T) {
	provider := &stubProvider{responses: []string{`{
		"type":"unknown",
		"title":"聊天",
		"content":"用户输入",
		"datetime_text":null,
		"datetime_iso":null,
		"need_reminder":false,
		"confidence":0.8,
		"status":"ready",
		"missing_fields":[],
		"reply":"",
		"intent":"answer_query",
		"record_action":"none",
		"target_id":null,
		"related_ids":[],
		"should_preview":false
	}`}}
	service := NewService(provider, "system prompt")

	_, err := service.Analyze(context.Background(), AnalyzeRequest{
		Message:  "用户输入",
		Timezone: "Asia/Shanghai",
		Now:      "2026-07-01 13:00:00",
	})

	if err == nil {
		t.Fatal("Analyze() error = nil, want empty reply error")
	}
}

func stringPtr(value string) *string {
	return &value
}

func floatPtr(value float64) *float64 {
	return &value
}

func hasString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

type stubProvider struct {
	name       string
	responses  []string
	reasonings []string
	requests   []llm.ChatRequest
	calls      int
}

func (p *stubProvider) Chat(ctx context.Context, req llm.ChatRequest) (*llm.ChatResponse, error) {
	p.requests = append(p.requests, req)
	response := ""
	if p.calls < len(p.responses) {
		response = p.responses[p.calls]
	}
	reasoning := ""
	if p.calls < len(p.reasonings) {
		reasoning = p.reasonings[p.calls]
	}
	p.calls++
	return &llm.ChatResponse{Content: response, Reasoning: reasoning}, nil
}

type stubStreamProvider struct {
	stubProvider
	streamDeltas   []string
	streamRequests []llm.ChatRequest
	streamCalls    int
}

func (p *stubStreamProvider) StreamChat(ctx context.Context, req llm.ChatRequest, onDelta func(string) error) error {
	p.streamRequests = append(p.streamRequests, req)
	p.streamCalls++
	for _, delta := range p.streamDeltas {
		if err := onDelta(delta); err != nil {
			return err
		}
	}
	return nil
}

func TestStreamFastReplyUsesStructuredJSONRequestAndPayload(t *testing.T) {
	provider := &stubProvider{responses: []string{`{"text":"我会继续处理这条补充。","route":"continue_slow"}`}}
	service := NewServiceWithPrompts(&ModelRegistry{
		activeKey: "fast",
		options: []ModelOption{
			{Key: "fast", Label: "Fast", Default: true},
		},
		providers: map[string]llm.Provider{
			"fast": provider,
		},
	}, "system prompt", "fast reply prompt")

	var chunks []string
	result, err := service.StreamFastReply(context.Background(), AnalyzeRequest{
		TurnID:   "turn_fast_1",
		Message:  "八点吧，难受",
		Timezone: "Asia/Shanghai",
		Now:      "2026-07-03 13:00:00",
		OpenContexts: []ContextRecord{{
			ID:            "ctx_1",
			ContextKind:   "record",
			PendingState:  "waiting_field",
			Type:          "todo",
			Title:         "提醒洗衣服",
			Content:       "洗衣服",
			NeedReminder:  true,
			Status:        "need_confirmation",
			MissingFields: []string{"datetime"},
		}},
		RecentMessages: []ConversationMessage{
			{Role: "user", Content: "明天提醒我洗衣服", CreatedAt: "2026-07-03 12:59:00"},
			{Role: "assistant", Content: "这条还差提醒时间。", CreatedAt: "2026-07-03 12:59:01"},
		},
	}, func(delta string) error {
		chunks = append(chunks, delta)
		return nil
	})

	if err != nil {
		t.Fatalf("StreamFastReply() error = %v", err)
	}
	if got := strings.Join(chunks, ""); got != "我会继续处理这条补充。" {
		t.Fatalf("fast reply = %q", got)
	}
	if result.Route != FastReplyRouteContinueSlow {
		t.Fatalf("route = %q, want %q", result.Route, FastReplyRouteContinueSlow)
	}
	if provider.calls != 1 {
		t.Fatalf("provider calls = %d, want 1", provider.calls)
	}
	request := provider.requests[0]
	if request.Stream {
		t.Fatalf("request Stream = true, want false")
	}
	if request.ResponseFormat == nil || request.ResponseFormat.Type != "json_object" {
		t.Fatalf("response format = %#v, want json_object", request.ResponseFormat)
	}
	if request.Temperature == nil || *request.Temperature != 0.1 {
		t.Fatalf("temperature = %v, want 0.1", request.Temperature)
	}
	if got := request.Messages[0].Content; got != "fast reply prompt" {
		t.Fatalf("system prompt = %q, want fast reply prompt", got)
	}
	payload := request.Messages[1].Content
	if !strings.Contains(payload, `"open_contexts"`) || !strings.Contains(payload, `"pending_state":"waiting_field"`) {
		t.Fatalf("payload = %s, want open context state", payload)
	}
	if !strings.Contains(payload, `"turn_id":"turn_fast_1"`) {
		t.Fatalf("payload = %s, want turn id", payload)
	}
	if !strings.Contains(payload, `"recent_messages"`) || !strings.Contains(payload, `"content":"明天提醒我洗衣服"`) {
		t.Fatalf("payload = %s, want recent messages", payload)
	}
	if strings.Contains(payload, "playful_boundary") {
		t.Fatalf("payload = %s, should not include local intent flags", payload)
	}
}

func TestStreamFastReplyPassesThinkingWhenModelSupportsIt(t *testing.T) {
	provider := &stubProvider{
		responses:  []string{`{"text":"我会继续处理。","route":"continue_slow"}`},
		reasonings: []string{"快路判断需要慢路继续。"},
	}
	service := NewServiceWithPrompts(&ModelRegistry{
		activeKey: "fast",
		options: []ModelOption{
			{Key: "fast", Label: "Fast", Default: true, SupportsThinking: true},
		},
		providers: map[string]llm.Provider{
			"fast": provider,
		},
	}, "system prompt", "fast reply prompt")

	result, err := service.StreamFastReply(context.Background(), AnalyzeRequest{
		Message:  "晚上八点提醒我洗衣服",
		Timezone: "Asia/Shanghai",
		Now:      "2026-07-03 13:00:00",
		Thinking: &ThinkingRequest{Enabled: true},
	}, func(string) error {
		return nil
	})

	if err != nil {
		t.Fatalf("StreamFastReply() error = %v", err)
	}
	if provider.requests[0].Thinking == nil || !provider.requests[0].Thinking.Enabled {
		t.Fatalf("Thinking = %#v, want enabled", provider.requests[0].Thinking)
	}
	if result.Reasoning != "快路判断需要慢路继续。" {
		t.Fatalf("Reasoning = %q, want fast reasoning", result.Reasoning)
	}
}

func TestStreamFastReplyDropsReasoningWhenThinkingDisabled(t *testing.T) {
	provider := &stubProvider{
		responses:  []string{`{"text":"我会继续处理。","route":"continue_slow"}`},
		reasonings: []string{"provider 默认返回的快路思考。"},
	}
	service := NewServiceWithPrompts(&ModelRegistry{
		activeKey: "fast",
		options: []ModelOption{
			{Key: "fast", Label: "Fast", Default: true, SupportsThinking: true},
		},
		providers: map[string]llm.Provider{
			"fast": provider,
		},
	}, "system prompt", "fast reply prompt")

	result, err := service.StreamFastReply(context.Background(), AnalyzeRequest{
		Message:  "晚上八点提醒我洗衣服",
		Timezone: "Asia/Shanghai",
	}, func(string) error {
		return nil
	})

	if err != nil {
		t.Fatalf("StreamFastReply() error = %v", err)
	}
	if provider.requests[0].Thinking != nil {
		t.Fatalf("Thinking = %#v, want nil when disabled", provider.requests[0].Thinking)
	}
	if result.Reasoning != "" {
		t.Fatalf("Reasoning = %q, want empty when thinking disabled", result.Reasoning)
	}
}

func TestAnalyzeSkipsThinkingWhenModelDoesNotSupportIt(t *testing.T) {
	provider := &stubProvider{responses: []string{`{
		"type":"unknown",
		"title":"聊天",
		"content":"用户输入",
		"datetime_text":null,
		"datetime_iso":null,
		"need_reminder":false,
		"confidence":0.8,
		"status":"ready",
		"missing_fields":[],
		"reply":"ok",
		"intent":"answer_query",
		"record_action":"none",
		"target_id":null,
		"related_ids":[],
		"should_preview":false
	}`}}
	service := NewServiceWithModels(&ModelRegistry{
		activeKey: "plain",
		options: []ModelOption{
			{Key: "plain", Label: "Plain", Default: true, SupportsThinking: false},
		},
		providers: map[string]llm.Provider{
			"plain": provider,
		},
	}, "system prompt")

	_, err := service.Analyze(context.Background(), AnalyzeRequest{
		Message:  "用户输入",
		Timezone: "Asia/Shanghai",
		Thinking: &ThinkingRequest{Enabled: true},
	})

	if err != nil {
		t.Fatalf("Analyze() error = %v", err)
	}
	if provider.requests[0].Thinking != nil {
		t.Fatalf("Thinking = %#v, want nil for unsupported model", provider.requests[0].Thinking)
	}
}

func TestAnalyzeDropsReasoningWhenThinkingDisabled(t *testing.T) {
	provider := &stubProvider{
		responses: []string{`{
		"type":"unknown",
		"title":"聊天",
		"content":"用户输入",
		"datetime_text":null,
		"datetime_iso":null,
		"need_reminder":false,
		"confidence":0.8,
		"status":"ready",
		"missing_fields":[],
		"reply":"ok",
		"intent":"answer_query",
		"record_action":"none",
		"target_id":null,
		"related_ids":[],
		"should_preview":false
	}`},
		reasonings: []string{"provider 默认返回的慢路思考。"},
	}
	service := NewServiceWithModels(&ModelRegistry{
		activeKey: "thinker",
		options: []ModelOption{
			{Key: "thinker", Label: "Thinker", Default: true, SupportsThinking: true},
		},
		providers: map[string]llm.Provider{
			"thinker": provider,
		},
	}, "system prompt")

	result, err := service.Analyze(context.Background(), AnalyzeRequest{
		Message:  "用户输入",
		Timezone: "Asia/Shanghai",
	})

	if err != nil {
		t.Fatalf("Analyze() error = %v", err)
	}
	if provider.requests[0].Thinking != nil {
		t.Fatalf("Thinking = %#v, want nil when disabled", provider.requests[0].Thinking)
	}
	if result.Reasoning != "" {
		t.Fatalf("Reasoning = %q, want empty when thinking disabled", result.Reasoning)
	}
}

func TestAnalyzePassesThinkingAndStoresReasoningWhenModelSupportsIt(t *testing.T) {
	provider := &stubProvider{
		responses: []string{`{
		"type":"unknown",
		"title":"聊天",
		"content":"用户输入",
		"datetime_text":null,
		"datetime_iso":null,
		"need_reminder":false,
		"confidence":0.8,
		"status":"ready",
		"missing_fields":[],
		"reply":"ok",
		"intent":"answer_query",
		"record_action":"none",
		"target_id":null,
		"related_ids":[],
		"should_preview":false
	}`},
		reasonings: []string{"慢路分析用户是在问一个普通问题。"},
	}
	service := NewServiceWithModels(&ModelRegistry{
		activeKey: "thinker",
		options: []ModelOption{
			{Key: "thinker", Label: "Thinker", Default: true, SupportsThinking: true},
		},
		providers: map[string]llm.Provider{
			"thinker": provider,
		},
	}, "system prompt")

	result, err := service.Analyze(context.Background(), AnalyzeRequest{
		Message:  "用户输入",
		Timezone: "Asia/Shanghai",
		Thinking: &ThinkingRequest{Enabled: true},
	})

	if err != nil {
		t.Fatalf("Analyze() error = %v", err)
	}
	if provider.requests[0].Thinking == nil || !provider.requests[0].Thinking.Enabled {
		t.Fatalf("Thinking = %#v, want enabled", provider.requests[0].Thinking)
	}
	if result.Reasoning != "慢路分析用户是在问一个普通问题。" {
		t.Fatalf("Reasoning = %q, want slow reasoning", result.Reasoning)
	}
}

func TestStreamFastReplyDoesNotUseModelStreamForProtocolJSON(t *testing.T) {
	provider := &stubStreamProvider{
		stubProvider: stubProvider{responses: []string{`{"text":"这件事我会继续处理晚上八点的提醒。","route":"continue_slow"}`}},
		streamDeltas: []string{`{"text":"半截`},
	}
	service := NewServiceWithPrompts(&ModelRegistry{
		activeKey: "fast",
		options: []ModelOption{
			{Key: "fast", Label: "Fast", Default: true},
		},
		providers: map[string]llm.Provider{
			"fast": provider,
		},
	}, "system prompt", "fast reply prompt")

	var chunks []string
	result, err := service.StreamFastReply(context.Background(), AnalyzeRequest{
		Message:  "我今天有点难过，晚上八点提醒我洗衣服",
		Timezone: "Asia/Shanghai",
		Now:      "2026-07-03 13:00:00",
	}, func(delta string) error {
		chunks = append(chunks, delta)
		return nil
	})

	if err != nil {
		t.Fatalf("StreamFastReply() error = %v", err)
	}
	if provider.calls != 1 {
		t.Fatalf("Chat calls = %d, want 1", provider.calls)
	}
	if provider.streamCalls != 0 {
		t.Fatalf("stream calls = %d, want 0", provider.streamCalls)
	}
	if got := strings.Join(chunks, ""); got != "这件事我会继续处理晚上八点的提醒。" {
		t.Fatalf("fast reply chunks = %q", got)
	}
	if result.Route != FastReplyRouteContinueSlow {
		t.Fatalf("route = %q, want %q", result.Route, FastReplyRouteContinueSlow)
	}
}

func TestStreamFastReplyReturnsChatOnlyRoute(t *testing.T) {
	provider := &stubProvider{responses: []string{`{"text":"你好，我在。","route":"chat_only"}`}}
	service := NewServiceWithPrompts(&ModelRegistry{
		activeKey: "fast",
		options: []ModelOption{
			{Key: "fast", Label: "Fast", Default: true},
		},
		providers: map[string]llm.Provider{
			"fast": provider,
		},
	}, "system prompt", "fast reply prompt")

	var chunks []string
	result, err := service.StreamFastReply(context.Background(), AnalyzeRequest{
		Message:  "你好",
		Timezone: "Asia/Shanghai",
		Now:      "2026-07-03 13:00:00",
	}, func(delta string) error {
		chunks = append(chunks, delta)
		return nil
	})

	if err != nil {
		t.Fatalf("StreamFastReply() error = %v", err)
	}
	if got := strings.Join(chunks, ""); got != "你好，我在。" {
		t.Fatalf("fast reply chunks = %q", got)
	}
	if result.Route != FastReplyRouteChatOnly {
		t.Fatalf("route = %q, want %q", result.Route, FastReplyRouteChatOnly)
	}
}

func TestStreamFastReplyInvalidJSONDoesNotLeakToUser(t *testing.T) {
	provider := &stubProvider{responses: []string{"我会继续处理这条。"}}
	service := NewServiceWithPrompts(&ModelRegistry{
		activeKey: "fast",
		options: []ModelOption{
			{Key: "fast", Label: "Fast", Default: true},
		},
		providers: map[string]llm.Provider{
			"fast": provider,
		},
	}, "system prompt", "fast reply prompt")

	var chunks []string
	_, err := service.StreamFastReply(context.Background(), AnalyzeRequest{
		Message:  "晚上八点提醒我洗衣服",
		Timezone: "Asia/Shanghai",
		Now:      "2026-07-03 13:00:00",
	}, func(delta string) error {
		chunks = append(chunks, delta)
		return nil
	})

	if err == nil {
		t.Fatal("StreamFastReply() error = nil, want invalid JSON error")
	}
	if len(chunks) != 0 {
		t.Fatalf("fast reply chunks = %#v, want none", chunks)
	}
}

func TestStreamFastReplyUnwrapsNestedProtocolJSONText(t *testing.T) {
	provider := &stubProvider{responses: []string{`{"text":"{\"text\":\"我会继续处理晚上十点的提醒。\",\"route\":\"continue_slow\"}","route":"continue_slow"}`}}
	service := NewServiceWithPrompts(&ModelRegistry{
		activeKey: "fast",
		options: []ModelOption{
			{Key: "fast", Label: "Fast", Default: true},
		},
		providers: map[string]llm.Provider{
			"fast": provider,
		},
	}, "system prompt", "fast reply prompt")

	var chunks []string
	result, err := service.StreamFastReply(context.Background(), AnalyzeRequest{
		Message:  "十点吧",
		Timezone: "Asia/Shanghai",
		Now:      "2026-07-03 13:00:00",
	}, func(delta string) error {
		chunks = append(chunks, delta)
		return nil
	})

	if err != nil {
		t.Fatalf("StreamFastReply() error = %v", err)
	}
	if got := strings.Join(chunks, ""); got != "我会继续处理晚上十点的提醒。" {
		t.Fatalf("fast reply chunks = %q, want unwrapped text", got)
	}
	if result.Route != FastReplyRouteContinueSlow {
		t.Fatalf("route = %q, want %q", result.Route, FastReplyRouteContinueSlow)
	}
}

func TestAnalyzeUsesRequestedModel(t *testing.T) {
	fast := &stubProvider{name: "fast", responses: []string{`{
		"type":"unknown",
		"title":"聊天",
		"content":"用户输入",
		"datetime_text":null,
		"datetime_iso":null,
		"need_reminder":false,
		"confidence":0.8,
		"status":"ready",
		"missing_fields":[],
		"reply":"fast",
		"intent":"answer_query",
		"record_action":"none",
		"target_id":null,
		"related_ids":[],
		"should_preview":false
	}`}}
	strong := &stubProvider{name: "strong", responses: []string{`{
		"type":"unknown",
		"title":"聊天",
		"content":"用户输入",
		"datetime_text":null,
		"datetime_iso":null,
		"need_reminder":false,
		"confidence":0.8,
		"status":"ready",
		"missing_fields":[],
		"reply":"strong",
		"intent":"answer_query",
		"record_action":"none",
		"target_id":null,
		"related_ids":[],
		"should_preview":false
	}`}}
	service := NewServiceWithModels(&ModelRegistry{
		activeKey: "fast",
		options: []ModelOption{
			{Key: "fast", Label: "Fast", Default: true},
			{Key: "strong", Label: "Strong"},
		},
		providers: map[string]llm.Provider{
			"fast":   fast,
			"strong": strong,
		},
	}, "system prompt")

	result, err := service.Analyze(context.Background(), AnalyzeRequest{
		Message:  "用户输入",
		Timezone: "Asia/Shanghai",
		ModelKey: "strong",
	})
	if err != nil {
		t.Fatalf("Analyze() error = %v", err)
	}
	if result.Reply != "strong" {
		t.Fatalf("Reply = %q, want strong", result.Reply)
	}
	if fast.calls != 0 {
		t.Fatalf("fast calls = %d, want 0", fast.calls)
	}
	if strong.calls != 1 {
		t.Fatalf("strong calls = %d, want 1", strong.calls)
	}
}
