package agent

import (
	"fmt"
	"time"
)

type ProgressStatus string

const (
	ProgressStatusRunning   ProgressStatus = "running"
	ProgressStatusCompleted ProgressStatus = "completed"
	ProgressStatusWarning   ProgressStatus = "warning"
	ProgressStatusFailed    ProgressStatus = "failed"
)

type ProgressEvent struct {
	ID        string         `json:"id"`
	TurnID    string         `json:"turn_id"`
	Seq       int            `json:"seq"`
	Type      string         `json:"type"`
	Title     string         `json:"title"`
	Detail    string         `json:"detail,omitempty"`
	Status    ProgressStatus `json:"status"`
	Payload   any            `json:"payload,omitempty"`
	CreatedAt string         `json:"created_at"`
}

func NewProgressEvent(turnID string, seq int, eventType string, title string, status ProgressStatus, detail string, payload any, now time.Time) ProgressEvent {
	return ProgressEvent{
		ID:        eventID(turnID, seq),
		TurnID:    turnID,
		Seq:       seq,
		Type:      eventType,
		Title:     title,
		Detail:    detail,
		Status:    status,
		Payload:   payload,
		CreatedAt: now.UTC().Format(time.RFC3339Nano),
	}
}

type RecordExecutionEvent struct {
	Action string `json:"action"`
	Status string `json:"status"`
	Record any    `json:"record,omitempty"`
	Error  string `json:"error,omitempty"`
}

func eventID(turnID string, seq int) string {
	if turnID == "" {
		return ""
	}
	return fmt.Sprintf("%s-%04d", turnID, seq)
}
