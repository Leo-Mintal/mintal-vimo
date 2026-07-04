package agent

import (
	"strings"
	"testing"
)

func TestLoadSystemPrompt(t *testing.T) {
	prompt, err := LoadSystemPrompt("../..")
	if err != nil {
		t.Fatalf("LoadSystemPrompt() error = %v", err)
	}

	expected := []string{
		"# Role",
		"# Runtime Skill: 说人话",
		"只约束自然语言输出",
		"record_candidates[].title/content",
		"Stored Content Rules",
		"不改变 JSON schema",
		"# Intention Engine",
		"Vimo 意图落地规则",
		"update_pending",
		"# Output Schema",
		"# Context Rules",
		"Global Semantic Rule",
		"Content Refinement",
		"title/content` 是给用户长期沉淀查看的自然语言字段",
		"不得与输入 JSON 的 `message` 完全相同",
		"Conversation Continuity",
		"recent_messages",
		"主意图应为 `answer_query`",
		"这已经聊过",
		"我刚才说过",
		"MBTI-style",
		"`INTJ`",
		"`ENFJ`",
		"`ISTP`",
		"`ENFP`",
		"open_contexts",
		"closed_contexts",
		"joke_response",
		"# Classification Rules",
		"# Risk Decision Matrix",
		"field_confidence",
		"field_risk",
		"primary_intent",
		"secondary_intents",
		"record_candidates",
		"execution_plan",
		"reply_strategy",
		"intent_trace",
		"pending_state",
		"多个明确任务/提醒",
		"字段答案属于主意图",
		"不要把字段答案和情绪片段拼成新的日记",
		"Hard Stop Gate",
		"目标唯一",
		"hard_stop_target_not_unique",
		"hard_stop_ambiguous_reminder_time",
		"hard_stop_need_reminder_change",
		"hard_stop_sensitive_memory",
		"Reply Composition",
		"兼顾情绪、副意图和主任务结果",
		"# Time Rules",
		"# Confirmation Rules",
	}
	for _, fragment := range expected {
		if !strings.Contains(prompt, fragment) {
			t.Fatalf("prompt missing %q", fragment)
		}
	}
	if strings.Contains(prompt, "# Agent Analyze Prompt") {
		t.Fatal("README content should not be included in system prompt")
	}
	if strings.Contains(prompt, "# Runtime Skills") {
		t.Fatal("skills README content should not be included in system prompt")
	}
	if strings.Contains(prompt, "# 说人话 Skill") {
		t.Fatal("skills library content should not be included in system prompt")
	}
	if strings.Contains(prompt, "# Natural Language Rewrite Reference") {
		t.Fatal("skills library references should not be included in system prompt")
	}
	if strings.Contains(prompt, "# Vimo 思考协议") {
		t.Fatal("old thinking protocol should not be included in system prompt")
	}
	if strings.Contains(prompt, "playful_boundary") {
		t.Fatal("prompt should not include local intent flags")
	}

	roleIndex := strings.Index(prompt, "# Role")
	skillIndex := strings.Index(prompt, "# Runtime Skill: 说人话")
	intentionIndex := strings.Index(prompt, "# Intention Engine")
	schemaIndex := strings.Index(prompt, "# Output Schema")
	if roleIndex < 0 || skillIndex < 0 || intentionIndex < 0 || schemaIndex < 0 || !(roleIndex < skillIndex && skillIndex < intentionIndex && intentionIndex < schemaIndex) {
		t.Fatalf("prompt sections are not loaded in filename order")
	}
}

func TestLoadFastReplyPromptIncludesAlwaysSkills(t *testing.T) {
	prompt, err := LoadFastReplyPrompt("../..")
	if err != nil {
		t.Fatalf("LoadFastReplyPrompt() error = %v", err)
	}

	expected := []string{
		"# Fast Reply Role",
		"# Runtime Skill: 说人话",
		"chat_only` 直接作为最终回复",
		"route=chat_only` 时，不要说",
		"Stored Content Rules",
		"# Fast Reply Context Rules",
		"MBTI-style",
		"`INTJ`",
		"same or near-same casual question",
		"我刚才说过",
	}
	for _, fragment := range expected {
		if !strings.Contains(prompt, fragment) {
			t.Fatalf("fast reply prompt missing %q", fragment)
		}
	}

	roleIndex := strings.Index(prompt, "# Fast Reply Role")
	skillIndex := strings.Index(prompt, "# Runtime Skill: 说人话")
	contextIndex := strings.Index(prompt, "# Fast Reply Context Rules")
	if roleIndex < 0 || skillIndex < 0 || contextIndex < 0 || !(roleIndex < skillIndex && skillIndex < contextIndex) {
		t.Fatalf("fast reply prompt sections are not loaded in expected order")
	}
}
