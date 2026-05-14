package store

import (
	"context"
	"fmt"

	"github.com/honeybee-enhanced/shared/models"
)

// InsertNodeMetric stores a single heartbeat performance snapshot.
func (s *Store) InsertNodeMetric(ctx context.Context, nodeID int64, cpuPct, memPct, diskPct float64, uptimeSecs int64) error {
	_, err := s.DB.ExecContext(ctx,
		`INSERT INTO node_metrics(node_id, cpu_pct, mem_pct, disk_pct, uptime_secs) VALUES (?, ?, ?, ?, ?)`,
		nodeID, cpuPct, memPct, diskPct, uptimeSecs)
	return err
}

// LatestNodeMetric returns the most recent metric row for a node.
func (s *Store) LatestNodeMetric(ctx context.Context, nodeID int64) (*models.NodeMetric, error) {
	var m models.NodeMetric
	err := s.DB.GetContext(ctx, &m,
		`SELECT id, node_id, cpu_pct, mem_pct, disk_pct, uptime_secs, recorded_at
		 FROM node_metrics WHERE node_id = ? ORDER BY recorded_at DESC LIMIT 1`, nodeID)
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// ListNodeMetrics returns the last N metric snapshots for a node, ordered chronologically.
func (s *Store) ListNodeMetrics(ctx context.Context, nodeID int64, hours int) ([]models.NodeMetric, error) {
	if hours <= 0 {
		hours = 1
	}
	var out []models.NodeMetric
	err := s.DB.SelectContext(ctx, &out,
		`SELECT id, node_id, cpu_pct, mem_pct, disk_pct, uptime_secs, recorded_at
		 FROM node_metrics WHERE node_id = ? AND recorded_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
		 ORDER BY recorded_at ASC`, nodeID, hours)
	return out, err
}

// PurgeOldMetrics deletes metrics older than the given number of days.
func (s *Store) PurgeOldMetrics(ctx context.Context, days int) (int64, error) {
	if days <= 0 {
		days = 7
	}
	res, err := s.DB.ExecContext(ctx,
		fmt.Sprintf(`DELETE FROM node_metrics WHERE recorded_at < DATE_SUB(NOW(), INTERVAL %d DAY)`, days))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
