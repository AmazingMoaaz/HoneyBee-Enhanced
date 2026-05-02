package store

import (
	"context"
	"fmt"

	"github.com/honeybee-enhanced/shared/models"
)

// InsertPotLog stores a structured pot log entry.
func (s *Store) InsertPotLog(ctx context.Context, e *models.PotLogEntry) (int64, error) {
	res, err := s.DB.ExecContext(ctx,
		`INSERT INTO pot_logs(org_id, node_id, deployment_id, pot_id, pot_type, log_type, data, logged_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		e.OrgID, e.NodeID, e.DeploymentID, e.PotID, e.PotType, e.LogType, e.Data, e.LoggedAt)
	if err != nil {
		return 0, fmt.Errorf("insert pot_log: %w", err)
	}
	id, err := res.LastInsertId()
	if err == nil {
		e.ID = id
	}
	return id, err
}

// ListPotLogs returns logs for a pot (paginated, newest first).
func (s *Store) ListPotLogs(ctx context.Context, orgID int64, potID string, limit, offset int) ([]models.PotLogEntry, error) {
	if limit <= 0 {
		limit = 100
	}
	var out []models.PotLogEntry
	err := s.DB.SelectContext(ctx, &out,
		`SELECT id, org_id, node_id, deployment_id, pot_id, pot_type, log_type, data, logged_at
		 FROM pot_logs WHERE org_id = ? AND pot_id = ?
		 ORDER BY logged_at DESC LIMIT ? OFFSET ?`,
		orgID, potID, limit, offset)
	return out, err
}

// ListPotLogsByDeployment returns logs for a specific deployment in chronological order.
func (s *Store) ListPotLogsByDeployment(ctx context.Context, deploymentID int64, limit, offset int) ([]models.PotLogEntry, error) {
	if limit <= 0 {
		limit = 200
	}
	var out []models.PotLogEntry
	err := s.DB.SelectContext(ctx, &out,
		`SELECT id, org_id, node_id, deployment_id, pot_id, pot_type, log_type, data, logged_at
		 FROM pot_logs WHERE deployment_id = ?
		 ORDER BY logged_at ASC, id ASC LIMIT ? OFFSET ?`,
		deploymentID, limit, offset)
	return out, err
}
