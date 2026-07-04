package records

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"mintal-vimo/vimo-go/internal/vimotime"
)

type Service struct {
	repo Repository
	seq  atomic.Uint64
	now  func() time.Time
}

func NewService(repo Repository) *Service {
	return &Service{
		repo: repo,
		now:  time.Now,
	}
}

func (s *Service) Create(ctx context.Context, input CreateInput) (*Record, error) {
	now := s.now().UTC()
	id := strings.TrimSpace(input.ID)
	if id == "" {
		id = s.nextID(now)
	}
	record := Record{
		ID:             id,
		Type:           normalizeType(input.Type),
		Title:          strings.TrimSpace(input.Title),
		Content:        strings.TrimSpace(input.Content),
		DatetimeText:   normalizeOptional(input.DatetimeText),
		DatetimeISO:    vimotime.NormalizeOptional(input.DatetimeISO),
		NeedReminder:   input.NeedReminder,
		Confidence:     clamp(input.Confidence),
		Status:         normalizeStatus(input.Status),
		MissingFields:  normalizeMissing(input.MissingFields),
		CreatedAt:      now,
		UpdatedAt:      now,
		DeletedAt:      vimotime.NormalizeOptional(input.DeletedAt),
		PreviousStatus: normalizePreviousStatus(input.PreviousStatus),
	}
	normalizeTrashState(&record, now)
	if record.Title == "" {
		record.Title = fallbackTitle(record.Content)
	}
	if record.Content == "" {
		return nil, fmt.Errorf("content is required")
	}
	return s.repo.Create(ctx, record)
}

func (s *Service) List(ctx context.Context, filter ListFilter) ([]Record, error) {
	filter.Type = strings.TrimSpace(filter.Type)
	filter.Status = strings.TrimSpace(filter.Status)
	return s.repo.List(ctx, filter)
}

func (s *Service) Update(ctx context.Context, id string, input UpdateInput) (*Record, error) {
	record, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}

	if input.Type != nil {
		record.Type = normalizeType(*input.Type)
	}
	if input.Title != nil {
		record.Title = strings.TrimSpace(*input.Title)
	}
	if input.Content != nil {
		record.Content = strings.TrimSpace(*input.Content)
	}
	if input.DatetimeText != nil {
		record.DatetimeText = normalizeOptional(input.DatetimeText)
	}
	if input.DatetimeISO != nil {
		record.DatetimeISO = vimotime.NormalizeOptional(input.DatetimeISO)
	}
	if input.NeedReminder != nil {
		record.NeedReminder = *input.NeedReminder
	}
	if input.Confidence != nil {
		record.Confidence = clamp(*input.Confidence)
	}
	if input.Status != nil {
		record.Status = normalizeStatus(*input.Status)
	}
	if input.MissingFields != nil {
		record.MissingFields = normalizeMissing(input.MissingFields)
	}
	if input.DeletedAt != nil {
		record.DeletedAt = vimotime.NormalizeOptional(input.DeletedAt)
	}
	if input.PreviousStatus != nil {
		record.PreviousStatus = normalizePreviousStatus(input.PreviousStatus)
	}
	if record.Title == "" {
		record.Title = fallbackTitle(record.Content)
	}
	if record.Content == "" {
		return nil, fmt.Errorf("content is required")
	}
	now := s.now().UTC()
	record.UpdatedAt = now
	normalizeTrashState(record, now)
	return s.repo.Update(ctx, *record)
}

func (s *Service) Delete(ctx context.Context, id string) error {
	return s.repo.Delete(ctx, id)
}

func (s *Service) nextID(now time.Time) string {
	return "rec_" + now.Format("20060102150405") + "_" + strconv.FormatUint(s.seq.Add(1), 36)
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
	case "ready", "saved", "discarded", "completed", "need_confirmation":
		return strings.TrimSpace(strings.ToLower(value))
	default:
		return "ready"
	}
}

func normalizePreviousStatus(value *string) *string {
	if value == nil {
		return nil
	}
	if strings.TrimSpace(*value) == "" {
		return nil
	}
	normalized := normalizeStatus(*value)
	if normalized == "discarded" {
		return nil
	}
	return &normalized
}

func normalizeTrashState(record *Record, now time.Time) {
	if record.Status != "discarded" {
		record.DeletedAt = nil
		record.PreviousStatus = nil
		return
	}
	if record.DeletedAt == nil {
		deletedAt := vimotime.Format(now)
		record.DeletedAt = &deletedAt
	}
	if record.PreviousStatus == nil {
		previous := "saved"
		record.PreviousStatus = &previous
	}
}

func normalizeOptional(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
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

func clamp(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}

func fallbackTitle(value string) string {
	value = strings.TrimSpace(value)
	if len([]rune(value)) <= 24 {
		return value
	}
	return string([]rune(value)[:24])
}
