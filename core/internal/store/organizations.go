package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/honeybee-enhanced/shared/models"
)

// ErrNotFound is returned when a lookup yields zero rows.
var ErrNotFound = errors.New("store: not found")

// CreateOrganization inserts a new organization.
func (s *Store) CreateOrganization(ctx context.Context, name, slug string) (int64, error) {
	res, err := s.DB.ExecContext(ctx,
		`INSERT INTO organizations(name, slug) VALUES (?, ?)`, name, slug)
	if err != nil {
		return 0, fmt.Errorf("insert organization: %w", err)
	}
	return res.LastInsertId()
}

// GetOrganization fetches by ID.
func (s *Store) GetOrganization(ctx context.Context, id int64) (*models.Organization, error) {
	var org models.Organization
	err := s.DB.GetContext(ctx, &org,
		`SELECT id, name, slug, created_at, updated_at FROM organizations WHERE id = ?`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &org, nil
}

// CountOrganizations returns the total count (used for first-run seeding).
func (s *Store) CountOrganizations(ctx context.Context) (int64, error) {
	var n int64
	if err := s.DB.GetContext(ctx, &n, `SELECT COUNT(*) FROM organizations`); err != nil {
		return 0, err
	}
	return n, nil
}
