package store

import (
	"context"
	"fmt"
	"time"

	"github.com/honeybee-enhanced/shared/models"
)

// EventFilter captures optional filters for ListEvents.
type EventFilter struct {
	NodeID    int64
	PotID     string
	EventType string
	SourceIP  string
	Start     *time.Time
	End       *time.Time
	Limit     int
	Offset    int
}

// InsertEvent stores an attacker event.
func (s *Store) InsertEvent(ctx context.Context, e *models.Event) (int64, error) {
	res, err := s.DB.ExecContext(ctx,
		`INSERT INTO events(org_id, node_id, deploy_id, pot_id, honeypot_type, event_type,
		                    source_ip, source_port, dest_port, data, country_code, city, lat, lon, event_time)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		e.OrgID, e.NodeID, e.DeployID, e.PotID, e.HoneypotType, e.EventType,
		e.SourceIP, e.SourcePort, e.DestPort, e.Data, e.CountryCode, e.City, e.Lat, e.Lon, e.EventTime)
	if err != nil {
		return 0, fmt.Errorf("insert event: %w", err)
	}
	id, err := res.LastInsertId()
	if err == nil {
		e.ID = id
	}
	return id, err
}

// ListEvents returns events matching the filter.
func (s *Store) ListEvents(ctx context.Context, orgID int64, f EventFilter) ([]models.Event, error) {
	q := `SELECT id, org_id, node_id, deploy_id, pot_id, honeypot_type, event_type,
	             source_ip, source_port, dest_port, data, country_code, city, lat, lon, event_time, created_at
	      FROM events WHERE org_id = ?`
	args := []any{orgID}
	if f.NodeID > 0 {
		q += " AND node_id = ?"
		args = append(args, f.NodeID)
	}
	if f.PotID != "" {
		q += " AND pot_id = ?"
		args = append(args, f.PotID)
	}
	if f.EventType != "" {
		q += " AND event_type = ?"
		args = append(args, f.EventType)
	}
	if f.SourceIP != "" {
		q += " AND source_ip = ?"
		args = append(args, f.SourceIP)
	}
	if f.Start != nil {
		q += " AND event_time >= ?"
		args = append(args, *f.Start)
	}
	if f.End != nil {
		q += " AND event_time <= ?"
		args = append(args, *f.End)
	}
	q += " ORDER BY event_time DESC"
	if f.Limit > 0 {
		q += fmt.Sprintf(" LIMIT %d OFFSET %d", f.Limit, f.Offset)
	}
	var out []models.Event
	err := s.DB.SelectContext(ctx, &out, q, args...)
	return out, err
}

// CountEvents returns the total count for org.
func (s *Store) CountEvents(ctx context.Context, orgID int64) (int64, error) {
	var n int64
	err := s.DB.GetContext(ctx, &n,
		`SELECT COUNT(*) FROM events WHERE org_id = ?`, orgID)
	return n, err
}

// CountUniqueIPs returns distinct attacker source IPs for org.
func (s *Store) CountUniqueIPs(ctx context.Context, orgID int64) (int64, error) {
	var n int64
	err := s.DB.GetContext(ctx, &n,
		`SELECT COUNT(DISTINCT source_ip) FROM events WHERE org_id = ? AND source_ip <> ''`, orgID)
	return n, err
}

// EventTypeStat is a stat row.
type EventTypeStat struct {
	Type  string `db:"type" json:"type"`
	Count int64  `db:"count" json:"count"`
}

// EventIPStat is a stat row.
type EventIPStat struct {
	IP    string `db:"ip"    json:"ip"`
	Count int64  `db:"count" json:"count"`
}

// EventTimelineBucket is one bucket in the timeline.
type EventTimelineBucket struct {
	Bucket time.Time `db:"bucket" json:"bucket"`
	Count  int64     `db:"count"  json:"count"`
}

// TopEventTypes returns the top N event types.
func (s *Store) TopEventTypes(ctx context.Context, orgID int64, n int) ([]EventTypeStat, error) {
	var out []EventTypeStat
	err := s.DB.SelectContext(ctx, &out,
		fmt.Sprintf(`SELECT event_type AS type, COUNT(*) AS count
		             FROM events WHERE org_id = ?
		             GROUP BY event_type ORDER BY count DESC LIMIT %d`, n), orgID)
	return out, err
}

// TopAttackerIPs returns the top N source IPs.
func (s *Store) TopAttackerIPs(ctx context.Context, orgID int64, n int) ([]EventIPStat, error) {
	var out []EventIPStat
	err := s.DB.SelectContext(ctx, &out,
		fmt.Sprintf(`SELECT source_ip AS ip, COUNT(*) AS count
		             FROM events WHERE org_id = ? AND source_ip <> ''
		             GROUP BY source_ip ORDER BY count DESC LIMIT %d`, n), orgID)
	return out, err
}

// EventTimelineHourly returns hourly buckets for the past `hours` hours.
func (s *Store) EventTimelineHourly(ctx context.Context, orgID int64, hours int) ([]EventTimelineBucket, error) {
	var out []EventTimelineBucket
	err := s.DB.SelectContext(ctx, &out,
		`SELECT DATE_FORMAT(event_time, '%Y-%m-%d %H:00:00') AS bucket, COUNT(*) AS count
		 FROM events WHERE org_id = ? AND event_time >= DATE_SUB(NOW(), INTERVAL ? HOUR)
		 GROUP BY bucket ORDER BY bucket ASC`, orgID, hours)
	return out, err
}

// PortStat is a stat row for port analysis.
type PortStat struct {
	Port  int   `db:"port" json:"port"`
	Count int64 `db:"count" json:"count"`
}

// TopTargetedPorts returns the most targeted destination ports.
func (s *Store) TopTargetedPorts(ctx context.Context, orgID int64, n int) ([]PortStat, error) {
	var out []PortStat
	err := s.DB.SelectContext(ctx, &out,
		fmt.Sprintf(`SELECT dest_port AS port, COUNT(*) AS count
		             FROM events WHERE org_id = ? AND dest_port > 0
		             GROUP BY dest_port ORDER BY count DESC LIMIT %d`, n), orgID)
	return out, err
}

// PotStat is a stat row for events-by-honeypot.
type PotStat struct {
	PotID string `db:"pot_id" json:"pot_id"`
	Type  string `db:"honeypot_type" json:"type"`
	Count int64  `db:"count" json:"count"`
}

// EventsByPot returns event counts grouped by honeypot.
func (s *Store) EventsByPot(ctx context.Context, orgID int64, n int) ([]PotStat, error) {
	var out []PotStat
	err := s.DB.SelectContext(ctx, &out,
		fmt.Sprintf(`SELECT pot_id, honeypot_type, COUNT(*) AS count
		             FROM events WHERE org_id = ?
		             GROUP BY pot_id, honeypot_type ORDER BY count DESC LIMIT %d`, n), orgID)
	return out, err
}

// HourlyHeatmapBucket represents one hour-of-day bucket.
type HourlyHeatmapBucket struct {
	Hour  int   `db:"hour" json:"hour"`
	Count int64 `db:"count" json:"count"`
}

// EventHourlyHeatmap returns event counts by hour of day (0-23) for the past 30 days.
func (s *Store) EventHourlyHeatmap(ctx context.Context, orgID int64) ([]HourlyHeatmapBucket, error) {
	var out []HourlyHeatmapBucket
	err := s.DB.SelectContext(ctx, &out,
		`SELECT HOUR(event_time) AS hour, COUNT(*) AS count
		 FROM events WHERE org_id = ? AND event_time >= DATE_SUB(NOW(), INTERVAL 30 DAY)
		 GROUP BY hour ORDER BY hour ASC`, orgID)
	return out, err
}

