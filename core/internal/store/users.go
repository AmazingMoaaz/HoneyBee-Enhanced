package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/honeybee-enhanced/shared/models"
)

// CreateUser inserts a new user.
func (s *Store) CreateUser(ctx context.Context, orgID int64, email, passwordHash, name string, role models.Role) (int64, error) {
	res, err := s.DB.ExecContext(ctx,
		`INSERT INTO users(org_id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)`,
		orgID, email, passwordHash, name, string(role))
	if err != nil {
		return 0, fmt.Errorf("insert user: %w", err)
	}
	return res.LastInsertId()
}

// GetUserByEmail returns the (single) user matching email.
func (s *Store) GetUserByEmail(ctx context.Context, email string) (*models.User, error) {
	var u models.User
	err := s.DB.GetContext(ctx, &u,
		`SELECT id, org_id, email, password_hash, name, role, created_at, updated_at
		 FROM users WHERE email = ? LIMIT 1`, email)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// GetUser fetches by ID.
func (s *Store) GetUser(ctx context.Context, id int64) (*models.User, error) {
	var u models.User
	err := s.DB.GetContext(ctx, &u,
		`SELECT id, org_id, email, password_hash, name, role, created_at, updated_at
		 FROM users WHERE id = ?`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &u, err
}

// ListUsers lists all users in an organization.
func (s *Store) ListUsers(ctx context.Context, orgID int64) ([]models.User, error) {
	var out []models.User
	err := s.DB.SelectContext(ctx, &out,
		`SELECT id, org_id, email, password_hash, name, role, created_at, updated_at
		 FROM users WHERE org_id = ? ORDER BY created_at DESC`, orgID)
	return out, err
}

// UpdateUser updates name/role.
func (s *Store) UpdateUser(ctx context.Context, orgID, id int64, name string, role models.Role) error {
	_, err := s.DB.ExecContext(ctx,
		`UPDATE users SET name = ?, role = ? WHERE id = ? AND org_id = ?`,
		name, string(role), id, orgID)
	return err
}

// DeleteUser hard-deletes.
func (s *Store) DeleteUser(ctx context.Context, orgID, id int64) error {
	_, err := s.DB.ExecContext(ctx,
		`DELETE FROM users WHERE id = ? AND org_id = ?`, id, orgID)
	return err
}
