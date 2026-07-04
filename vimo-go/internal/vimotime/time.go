package vimotime

import (
	"strings"
	"time"
)

const DisplayLayout = "2006-01-02 15:04:05"

var parseLayouts = []string{
	DisplayLayout,
	"2006-01-02 15:04",
	time.RFC3339,
	"2006-01-02T15:04:05",
	"2006-01-02T15:04",
}

func Format(value time.Time) string {
	return value.Format(DisplayLayout)
}

func NormalizeText(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	for _, layout := range parseLayouts {
		parsed, err := time.Parse(layout, trimmed)
		if err == nil {
			return Format(parsed)
		}
	}
	return trimmed
}

func NormalizeOptional(value *string) *string {
	if value == nil {
		return nil
	}
	normalized := NormalizeText(*value)
	if normalized == "" {
		return nil
	}
	return &normalized
}
