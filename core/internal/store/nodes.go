package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"github.com/honeybee-enhanced/shared/models"
)

// CreateNode inserts a new node with a random 6-digit ID and returns it.
// Retries up to 10 times on the rare chance of a collision.
func (s *Store) CreateNode(ctx context.Context, orgID int64, name, tokenHash string) (int64, error) {
	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	const maxTries = 10
	for i := 0; i < maxTries; i++ {
		id := int64(r.Intn(900000) + 100000) // 100000–999999
		_, err := s.DB.ExecContext(ctx,
			`INSERT INTO nodes(id, org_id, name, token_hash) VALUES (?, ?, ?, ?)`,
			id, orgID, name, tokenHash)
		if err == nil {
			return id, nil
		}
		// If it's a duplicate-key error, try a new random ID; otherwise surface the error.
		if !isDuplicateKeyError(err) {
			return 0, fmt.Errorf("insert node: %w", err)
		}
	}
	return 0, fmt.Errorf("insert node: could not find a free 6-digit ID after %d attempts", maxTries)
}

// isDuplicateKeyError returns true for MySQL error 1062 (duplicate entry).
func isDuplicateKeyError(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "Duplicate entry") || strings.Contains(err.Error(), "1062")
}

// GetNode fetches by ID, scoped to org.
func (s *Store) GetNode(ctx context.Context, orgID, id int64) (*models.Node, error) {
	var n models.Node
	err := s.DB.GetContext(ctx, &n, `
		SELECT id, org_id, name, token_hash, ip_address, os, arch, hostname, status,
		       last_heartbeat, created_at, updated_at, display_order
		FROM (
		  SELECT id, org_id, name, token_hash, ip_address, os, arch, hostname, status,
		         last_heartbeat, created_at, updated_at,
		         ROW_NUMBER() OVER (PARTITION BY org_id ORDER BY created_at ASC) AS display_order
		  FROM nodes
		  WHERE org_id = ?
		) ranked
		WHERE id = ?`, orgID, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &n, err
}

// GetNodeByID fetches by ID without org scoping (used by node-server during auth).
func (s *Store) GetNodeByID(ctx context.Context, id int64) (*models.Node, error) {
	var n models.Node
	err := s.DB.GetContext(ctx, &n, `
		SELECT id, org_id, name, token_hash, ip_address, os, arch, hostname, status,
		       last_heartbeat, created_at, updated_at, display_order
		FROM (
		  SELECT id, org_id, name, token_hash, ip_address, os, arch, hostname, status,
		         last_heartbeat, created_at, updated_at,
		         ROW_NUMBER() OVER (PARTITION BY org_id ORDER BY created_at ASC) AS display_order
		  FROM nodes
		) ranked
		WHERE id = ?`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &n, err
}

// ListAllNodes returns every node (for token auth scan).
func (s *Store) ListAllNodes(ctx context.Context) ([]models.Node, error) {
	var out []models.Node
	err := s.DB.SelectContext(ctx, &out,
		`SELECT id, org_id, name, token_hash, ip_address, os, arch, hostname, status,
		        last_heartbeat, created_at, updated_at
		 FROM nodes`)
	return out, err
}

// ListNodes lists nodes in an organization.
// display_order is a 1-based sequential rank by created_at so the UI always
// shows #1, #2, #3… with no gaps, regardless of DB id values.
func (s *Store) ListNodes(ctx context.Context, orgID int64) ([]models.Node, error) {
	var out []models.Node
	err := s.DB.SelectContext(ctx, &out, `
		SELECT id, org_id, name, token_hash, ip_address, os, arch, hostname, status,
		       last_heartbeat, created_at, updated_at,
		       ROW_NUMBER() OVER (PARTITION BY org_id ORDER BY created_at ASC) AS display_order
		FROM nodes
		WHERE org_id = ?
		ORDER BY created_at DESC`, orgID)
	return out, err
}

// DeleteNode hard-deletes a node. ON DELETE CASCADE handles all child rows.
func (s *Store) DeleteNode(ctx context.Context, orgID, id int64) error {
	_, err := s.DB.ExecContext(ctx,
		`DELETE FROM nodes WHERE id = ? AND org_id = ?`, id, orgID)
	return err
}

// RegenerateNodeToken updates the bcrypt hash.
func (s *Store) RegenerateNodeToken(ctx context.Context, orgID, id int64, newHash string) error {
	_, err := s.DB.ExecContext(ctx,
		`UPDATE nodes SET token_hash = ? WHERE id = ? AND org_id = ?`, newHash, id, orgID)
	return err
}

// UpdateNodeRegistration is called once a node successfully authenticates and identifies itself.
func (s *Store) UpdateNodeRegistration(ctx context.Context, id int64, hostname, osName, arch, ipAddress string) error {
	_, err := s.DB.ExecContext(ctx,
		`UPDATE nodes SET hostname = ?, os = ?, arch = ?, ip_address = ?, status = 'online', last_heartbeat = NOW() WHERE id = ?`,
		hostname, osName, arch, ipAddress, id)
	return err
}

// UpdateNodeHeartbeat refreshes the last_heartbeat and ensures status=online.
func (s *Store) UpdateNodeHeartbeat(ctx context.Context, id int64) error {
	_, err := s.DB.ExecContext(ctx,
		`UPDATE nodes SET last_heartbeat = NOW(), status = 'online' WHERE id = ?`, id)
	return err
}

// MarkNodeOffline transitions to offline (called on disconnect).
func (s *Store) MarkNodeOffline(ctx context.Context, id int64) error {
	_, err := s.DB.ExecContext(ctx,
		`UPDATE nodes SET status = 'offline' WHERE id = ?`, id)
	return err
}

// CountNodes returns total nodes for an org.
func (s *Store) CountNodes(ctx context.Context, orgID int64) (int64, error) {
	var n int64
	err := s.DB.GetContext(ctx, &n,
		`SELECT COUNT(*) FROM nodes WHERE org_id = ?`, orgID)
	return n, err
}

// MarkAllNodesOffline is run at server startup to reset stale state.
func (s *Store) MarkAllNodesOffline(ctx context.Context) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE nodes SET status = 'offline'`)
	return err
}
