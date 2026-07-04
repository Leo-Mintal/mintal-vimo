package vimotime

import "testing"

func TestNormalizeText(t *testing.T) {
	tests := map[string]string{
		"2026-07-01T15:00:00+08:00": "2026-07-01 15:00:00",
		"2026-07-01T15:00:00":       "2026-07-01 15:00:00",
		"2026-07-01 15:00":          "2026-07-01 15:00:00",
		"2026-07-01 15:00:00":       "2026-07-01 15:00:00",
		"明天下午三点":                    "明天下午三点",
	}

	for input, want := range tests {
		if got := NormalizeText(input); got != want {
			t.Fatalf("NormalizeText(%q) = %q, want %q", input, got, want)
		}
	}
}
