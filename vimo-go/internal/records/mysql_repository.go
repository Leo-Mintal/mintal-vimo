package records

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	_ "github.com/go-sql-driver/mysql"
)

type MySQLRepository struct {
	db *sql.DB
}

func NewMySQLRepository(ctx context.Context, dsn string) (*MySQLRepository, error) {
	if strings.TrimSpace(dsn) == "" {
		return nil, fmt.Errorf("mysql dsn is required")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	repo := &MySQLRepository{db: db}
	if err := repo.init(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return repo, nil
}

func (r *MySQLRepository) Close() error {
	return r.db.Close()
}

func (r *MySQLRepository) init(ctx context.Context) error {
	_, err := r.db.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS vimo_records (
  id VARCHAR(80) PRIMARY KEY,
  type VARCHAR(32) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  datetime_text VARCHAR(255) NULL,
  datetime_iso VARCHAR(32) NULL,
  need_reminder BOOLEAN NOT NULL DEFAULT FALSE,
  confidence DOUBLE NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL,
  missing_fields JSON NULL,
  deleted_at VARCHAR(32) NULL,
  previous_status VARCHAR(32) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  INDEX idx_vimo_records_type (type),
  INDEX idx_vimo_records_status (status),
  INDEX idx_vimo_records_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
	return err
}

func (r *MySQLRepository) Create(ctx context.Context, record Record) (*Record, error) {
	missingFields, err := marshalMissingFields(record.MissingFields)
	if err != nil {
		return nil, err
	}
	_, err = r.db.ExecContext(ctx, `
INSERT INTO vimo_records (
  id, type, title, content, datetime_text, datetime_iso, need_reminder, confidence,
  status, missing_fields, deleted_at, previous_status, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		record.ID,
		record.Type,
		record.Title,
		record.Content,
		nullableString(record.DatetimeText),
		nullableString(record.DatetimeISO),
		record.NeedReminder,
		record.Confidence,
		record.Status,
		missingFields,
		nullableString(record.DeletedAt),
		nullableString(record.PreviousStatus),
		record.CreatedAt,
		record.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return cloneRecord(record), nil
}

func (r *MySQLRepository) List(ctx context.Context, filter ListFilter) ([]Record, error) {
	args := []any{}
	where := []string{}
	if filter.Type != "" {
		where = append(where, "type = ?")
		args = append(args, filter.Type)
	}
	if filter.Status != "" {
		where = append(where, "status = ?")
		args = append(args, filter.Status)
	}
	query := `
SELECT id, type, title, content, datetime_text, datetime_iso, need_reminder, confidence,
  status, missing_fields, deleted_at, previous_status, created_at, updated_at
FROM vimo_records`
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += " ORDER BY created_at DESC"

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records := []Record{}
	for rows.Next() {
		record, err := scanRecord(rows)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return records, nil
}

func (r *MySQLRepository) Get(ctx context.Context, id string) (*Record, error) {
	row := r.db.QueryRowContext(ctx, `
SELECT id, type, title, content, datetime_text, datetime_iso, need_reminder, confidence,
  status, missing_fields, deleted_at, previous_status, created_at, updated_at
FROM vimo_records
WHERE id = ?`, id)
	record, err := scanRecord(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("record not found")
		}
		return nil, err
	}
	return &record, nil
}

func (r *MySQLRepository) Update(ctx context.Context, record Record) (*Record, error) {
	missingFields, err := marshalMissingFields(record.MissingFields)
	if err != nil {
		return nil, err
	}
	result, err := r.db.ExecContext(ctx, `
UPDATE vimo_records
SET type = ?, title = ?, content = ?, datetime_text = ?, datetime_iso = ?,
  need_reminder = ?, confidence = ?, status = ?, missing_fields = ?,
  deleted_at = ?, previous_status = ?, updated_at = ?
WHERE id = ?`,
		record.Type,
		record.Title,
		record.Content,
		nullableString(record.DatetimeText),
		nullableString(record.DatetimeISO),
		record.NeedReminder,
		record.Confidence,
		record.Status,
		missingFields,
		nullableString(record.DeletedAt),
		nullableString(record.PreviousStatus),
		record.UpdatedAt,
		record.ID,
	)
	if err != nil {
		return nil, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected == 0 {
		return nil, fmt.Errorf("record not found")
	}
	return cloneRecord(record), nil
}

func (r *MySQLRepository) Delete(ctx context.Context, id string) error {
	result, err := r.db.ExecContext(ctx, "DELETE FROM vimo_records WHERE id = ?", id)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return fmt.Errorf("record not found")
	}
	return nil
}

type recordScanner interface {
	Scan(dest ...any) error
}

func scanRecord(scanner recordScanner) (Record, error) {
	var (
		record         Record
		datetimeText   sql.NullString
		datetimeISO    sql.NullString
		missingFields  sql.NullString
		deletedAt      sql.NullString
		previousStatus sql.NullString
	)
	err := scanner.Scan(
		&record.ID,
		&record.Type,
		&record.Title,
		&record.Content,
		&datetimeText,
		&datetimeISO,
		&record.NeedReminder,
		&record.Confidence,
		&record.Status,
		&missingFields,
		&deletedAt,
		&previousStatus,
		&record.CreatedAt,
		&record.UpdatedAt,
	)
	if err != nil {
		return Record{}, err
	}
	record.DatetimeText = stringFromNull(datetimeText)
	record.DatetimeISO = stringFromNull(datetimeISO)
	record.MissingFields = unmarshalMissingFields(missingFields.String)
	record.DeletedAt = stringFromNull(deletedAt)
	record.PreviousStatus = stringFromNull(previousStatus)
	return record, nil
}

func marshalMissingFields(values []string) (string, error) {
	if values == nil {
		values = []string{}
	}
	encoded, err := json.Marshal(values)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func unmarshalMissingFields(value string) []string {
	if strings.TrimSpace(value) == "" {
		return []string{}
	}
	var result []string
	if err := json.Unmarshal([]byte(value), &result); err != nil {
		return []string{}
	}
	return result
}

func nullableString(value *string) sql.NullString {
	if value == nil || strings.TrimSpace(*value) == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: strings.TrimSpace(*value), Valid: true}
}

func stringFromNull(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	text := strings.TrimSpace(value.String)
	if text == "" {
		return nil
	}
	return &text
}

var _ Repository = (*MySQLRepository)(nil)
