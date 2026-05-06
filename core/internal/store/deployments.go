package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/honeybee-enhanced/shared/models"
)

// CreateDeployment inserts a deployment row and returns its ID.
func (s *Store) CreateDeployment(ctx context.Context, orgID, nodeID int64, potID, potType, configJSON string) (int64, error) {
	res, err := s.DB.ExecContext(ctx,
		`INSERT INTO deployments(org_id, node_id, pot_id, honeypot_type, config, status)
		 VALUES (?, ?, ?, ?, ?, 'pending')`,
		orgID, nodeID, potID, potType, configJSON)
	if err != nil {
		return 0, fmt.Errorf("insert deployment: %w", err)
	}
	return res.LastInsertId()
}

// GetDeployment fetches a single deployment scoped to org.
func (s *Store) GetDeployment(ctx context.Context, orgID, id int64) (*models.Deployment, error) {
	var d models.Deployment
	err := s.DB.GetContext(ctx, &d,
		`SELECT id, org_id, node_id, pot_id, honeypot_type, config, status, status_message, created_at, updated_at
		 FROM deployments WHERE id = ? AND org_id = ?`, id, orgID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &d, err
}

// NextPotIDForNode returns the next sequential pot_id for the given node + honeypot type,
// formatted as "{type}-{n}" where n is one greater than the highest existing numeric suffix
// for that (node, type) pair. Returns "{type}-1" when no prior deployments exist.
func (s *Store) NextPotIDForNode(ctx context.Context, nodeID int64, hpType string) (string, error) {
	prefix := hpType + "-"
	rows, err := s.DB.QueryContext(ctx,
		`SELECT pot_id FROM deployments WHERE node_id = ? AND honeypot_type = ?`,
		nodeID, hpType)
	if err != nil {
		return "", fmt.Errorf("query existing pot_ids: %w", err)
	}
	defer rows.Close()
	max := 0
	for rows.Next() {
		var pid string
		if err := rows.Scan(&pid); err != nil {
			return "", err
		}
		if !strings.HasPrefix(pid, prefix) {
			continue
		}
		var n int
		if _, err := fmt.Sscanf(pid[len(prefix):], "%d", &n); err == nil && n > max {
			max = n
		}
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s%d", prefix, max+1), nil
}

// GetDeploymentByPotID fetches by (node_id, pot_id).
func (s *Store) GetDeploymentByPotID(ctx context.Context, nodeID int64, potID string) (*models.Deployment, error) {
	var d models.Deployment
	err := s.DB.GetContext(ctx, &d,
		`SELECT id, org_id, node_id, pot_id, honeypot_type, config, status, status_message, created_at, updated_at
		 FROM deployments WHERE node_id = ? AND pot_id = ?`, nodeID, potID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &d, err
}

// ListDeployments returns deployments for org with optional filters.
func (s *Store) ListDeployments(ctx context.Context, orgID int64, nodeID int64, status string) ([]models.Deployment, error) {
	q := `SELECT id, org_id, node_id, pot_id, honeypot_type, config, status, status_message, created_at, updated_at
	      FROM deployments WHERE org_id = ?`
	args := []any{orgID}
	if nodeID > 0 {
		q += " AND node_id = ?"
		args = append(args, nodeID)
	}
	if status != "" {
		q += " AND status = ?"
		args = append(args, status)
	}
	q += " ORDER BY created_at DESC"

	var out []models.Deployment
	err := s.DB.SelectContext(ctx, &out, q, args...)
	return out, err
}

// ListDeploymentsByNode returns deployments for a node (no org scope; used by node server).
func (s *Store) ListDeploymentsByNode(ctx context.Context, nodeID int64) ([]models.Deployment, error) {
	var out []models.Deployment
	err := s.DB.SelectContext(ctx, &out,
		`SELECT id, org_id, node_id, pot_id, honeypot_type, config, status, status_message, created_at, updated_at
		 FROM deployments WHERE node_id = ? ORDER BY created_at DESC`, nodeID)
	return out, err
}

// UpdateDeploymentStatus updates status + message.
func (s *Store) UpdateDeploymentStatus(ctx context.Context, nodeID int64, potID, status, message string) error {
	_, err := s.DB.ExecContext(ctx,
		`UPDATE deployments SET status = ?, status_message = ? WHERE node_id = ? AND pot_id = ?`,
		status, message, nodeID, potID)
	return err
}

// UpdateDeploymentStatusByID updates status + message by deployment primary key.
func (s *Store) UpdateDeploymentStatusByID(ctx context.Context, id int64, status, message string) error {
	_, err := s.DB.ExecContext(ctx,
		`UPDATE deployments SET status = ?, status_message = ? WHERE id = ?`,
		status, message, id)
	return err
}

// UpdateDeploymentConfig replaces the config JSON.
func (s *Store) UpdateDeploymentConfig(ctx context.Context, orgID, id int64, configJSON string) error {
	_, err := s.DB.ExecContext(ctx,
		`UPDATE deployments SET config = ? WHERE id = ? AND org_id = ?`,
		configJSON, id, orgID)
	return err
}

// CountRunningDeployments returns the number of deployments in 'running' state.
func (s *Store) CountRunningDeployments(ctx context.Context, orgID int64) (int64, error) {
	var n int64
	err := s.DB.GetContext(ctx, &n,
		`SELECT COUNT(*) FROM deployments WHERE org_id = ? AND status = 'running'`, orgID)
	return n, err
}

// DeleteDeployment removes a single deployment record from the DB (org-scoped).
// This only deletes the DB row — it does NOT send a remove command to the node.
// Use for stale/failed/pending records where no node-side cleanup is needed.
func (s *Store) DeleteDeployment(ctx context.Context, orgID, id int64) error {
	_, err := s.DB.ExecContext(ctx,
		`DELETE FROM deployments WHERE id = ? AND org_id = ?`, id, orgID)
	return err
}

// DeleteDeploymentsByStatus bulk-deletes all deployments whose status matches
// one of the given values (org-scoped). Used for cleanup of failed/pending rows.
func (s *Store) DeleteDeploymentsByStatus(ctx context.Context, orgID int64, statuses []string) (int64, error) {
	if len(statuses) == 0 {
		return 0, nil
	}
	// Build a parameterised IN clause.
	args := []any{orgID}
	placeholders := make([]string, len(statuses))
	for i, s := range statuses {
		placeholders[i] = "?"
		args = append(args, s)
	}
	q := fmt.Sprintf(
		`DELETE FROM deployments WHERE org_id = ? AND status IN (%s)`,
		strings.Join(placeholders, ","))
	res, err := s.DB.ExecContext(ctx, q, args...)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
