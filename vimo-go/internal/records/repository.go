package records

import "context"

type Repository interface {
	Create(ctx context.Context, record Record) (*Record, error)
	List(ctx context.Context, filter ListFilter) ([]Record, error)
	Get(ctx context.Context, id string) (*Record, error)
	Update(ctx context.Context, record Record) (*Record, error)
	Delete(ctx context.Context, id string) error
}

type ListFilter struct {
	Type   string
	Status string
}
