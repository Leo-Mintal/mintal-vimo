package records

import (
	"context"
	"fmt"
	"sort"
	"sync"
)

type MemoryRepository struct {
	mu      sync.RWMutex
	records map[string]Record
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{records: map[string]Record{}}
}

func (r *MemoryRepository) Create(_ context.Context, record Record) (*Record, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.records[record.ID] = record
	return cloneRecord(record), nil
}

func (r *MemoryRepository) List(_ context.Context, filter ListFilter) ([]Record, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]Record, 0, len(r.records))
	for _, record := range r.records {
		if filter.Type != "" && record.Type != filter.Type {
			continue
		}
		if filter.Status != "" && record.Status != filter.Status {
			continue
		}
		result = append(result, record)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})
	return result, nil
}

func (r *MemoryRepository) Get(_ context.Context, id string) (*Record, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	record, ok := r.records[id]
	if !ok {
		return nil, fmt.Errorf("record not found")
	}
	return cloneRecord(record), nil
}

func (r *MemoryRepository) Update(_ context.Context, record Record) (*Record, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.records[record.ID]; !ok {
		return nil, fmt.Errorf("record not found")
	}
	r.records[record.ID] = record
	return cloneRecord(record), nil
}

func (r *MemoryRepository) Delete(_ context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.records[id]; !ok {
		return fmt.Errorf("record not found")
	}
	delete(r.records, id)
	return nil
}

func cloneRecord(record Record) *Record {
	copied := record
	copied.MissingFields = make([]string, len(record.MissingFields))
	copy(copied.MissingFields, record.MissingFields)
	return &copied
}
