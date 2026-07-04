package records

import "time"

type Record struct {
	ID             string    `json:"id"`
	Type           string    `json:"type"`
	Title          string    `json:"title"`
	Content        string    `json:"content"`
	DatetimeText   *string   `json:"datetime_text"`
	DatetimeISO    *string   `json:"datetime_iso"`
	NeedReminder   bool      `json:"need_reminder"`
	Confidence     float64   `json:"confidence"`
	Status         string    `json:"status"`
	MissingFields  []string  `json:"missing_fields"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
	DeletedAt      *string   `json:"deleted_at,omitempty"`
	PreviousStatus *string   `json:"previous_status,omitempty"`
}

type CreateInput struct {
	ID             string   `json:"id"`
	Type           string   `json:"type"`
	Title          string   `json:"title"`
	Content        string   `json:"content"`
	DatetimeText   *string  `json:"datetime_text"`
	DatetimeISO    *string  `json:"datetime_iso"`
	NeedReminder   bool     `json:"need_reminder"`
	Confidence     float64  `json:"confidence"`
	Status         string   `json:"status"`
	MissingFields  []string `json:"missing_fields"`
	DeletedAt      *string  `json:"deleted_at"`
	PreviousStatus *string  `json:"previous_status"`
}

type UpdateInput struct {
	Type           *string  `json:"type"`
	Title          *string  `json:"title"`
	Content        *string  `json:"content"`
	DatetimeText   *string  `json:"datetime_text"`
	DatetimeISO    *string  `json:"datetime_iso"`
	NeedReminder   *bool    `json:"need_reminder"`
	Confidence     *float64 `json:"confidence"`
	Status         *string  `json:"status"`
	MissingFields  []string `json:"missing_fields"`
	DeletedAt      *string  `json:"deleted_at"`
	PreviousStatus *string  `json:"previous_status"`
}
