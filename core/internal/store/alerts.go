package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/honeybee-enhanced/shared/models"
)

// CreateAlert inserts a new alert.
func (s *Store) CreateAlert(ctx context.Context, a *models.Alert) (int64, error) {
	res, err := s.DB.ExecContext(ctx,
		`INSERT INTO alerts(org_id, rule_id, severity, title, message, source, source_ref)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		a.OrgID, a.RuleID, a.Severity, a.Title, a.Message, a.Source, a.SourceRef)
	if err != nil {
		return 0, fmt.Errorf("insert alert: %w", err)
	}
	id, err := res.LastInsertId()
	if err == nil {
		a.ID = id
	}
	return id, err
}

// ListAlerts returns alerts for an org with optional filters.
func (s *Store) ListAlerts(ctx context.Context, orgID int64, severity, acknowledged string, limit, offset int) ([]models.Alert, error) {
	if limit <= 0 {
		limit = 50
	}
	q := `SELECT id, org_id, rule_id, severity, title, message, source, source_ref,
	             acknowledged, acknowledged_by, acknowledged_at, created_at
	      FROM alerts WHERE org_id = ?`
	args := []any{orgID}
	if severity != "" {
		q += " AND severity = ?"
		args = append(args, severity)
	}
	if acknowledged == "true" {
		q += " AND acknowledged = TRUE"
	} else if acknowledged == "false" {
		q += " AND acknowledged = FALSE"
	}
	q += fmt.Sprintf(" ORDER BY created_at DESC LIMIT %d OFFSET %d", limit, offset)
	var out []models.Alert
	err := s.DB.SelectContext(ctx, &out, q, args...)
	return out, err
}

// CountUnacknowledgedAlerts returns the count of unacknowledged alerts for an org.
func (s *Store) CountUnacknowledgedAlerts(ctx context.Context, orgID int64) (int64, error) {
	var n int64
	err := s.DB.GetContext(ctx, &n,
		`SELECT COUNT(*) FROM alerts WHERE org_id = ? AND acknowledged = FALSE`, orgID)
	return n, err
}

// AcknowledgeAlert marks an alert as acknowledged by a user.
func (s *Store) AcknowledgeAlert(ctx context.Context, orgID, alertID, userID int64) error {
	_, err := s.DB.ExecContext(ctx,
		`UPDATE alerts SET acknowledged = TRUE, acknowledged_by = ?, acknowledged_at = NOW()
		 WHERE id = ? AND org_id = ?`, userID, alertID, orgID)
	return err
}

// DeleteAlert removes an alert.
func (s *Store) DeleteAlert(ctx context.Context, orgID, alertID int64) error {
	_, err := s.DB.ExecContext(ctx,
		`DELETE FROM alerts WHERE id = ? AND org_id = ?`, alertID, orgID)
	return err
}

// CreateAlertRule inserts a new alert rule.
func (s *Store) CreateAlertRule(ctx context.Context, r *models.AlertRule) (int64, error) {
	res, err := s.DB.ExecContext(ctx,
		"INSERT INTO alert_rules(org_id, name, description, event_type, `condition`, severity, enabled, cooldown_secs) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		r.OrgID, r.Name, r.Description, r.EventType, r.Condition, r.Severity, r.Enabled, r.Cooldown)
	if err != nil {
		return 0, fmt.Errorf("insert alert_rule: %w", err)
	}
	id, err := res.LastInsertId()
	if err == nil {
		r.ID = id
	}
	return id, err
}

// ListAlertRules returns all alert rules for an org.
func (s *Store) ListAlertRules(ctx context.Context, orgID int64) ([]models.AlertRule, error) {
	var out []models.AlertRule
	err := s.DB.SelectContext(ctx, &out,
		"SELECT id, org_id, name, description, event_type, `condition`, severity, enabled, cooldown_secs, last_fired, created_at, updated_at FROM alert_rules WHERE org_id = ? ORDER BY created_at DESC", orgID)
	return out, err
}

// GetAlertRule fetches a single alert rule.
func (s *Store) GetAlertRule(ctx context.Context, orgID, id int64) (*models.AlertRule, error) {
	var r models.AlertRule
	err := s.DB.GetContext(ctx, &r,
		"SELECT id, org_id, name, description, event_type, `condition`, severity, enabled, cooldown_secs, last_fired, created_at, updated_at FROM alert_rules WHERE id = ? AND org_id = ?", id, orgID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &r, err
}

// UpdateAlertRule updates an existing alert rule.
func (s *Store) UpdateAlertRule(ctx context.Context, r *models.AlertRule) error {
	_, err := s.DB.ExecContext(ctx,
		"UPDATE alert_rules SET name = ?, description = ?, event_type = ?, `condition` = ?, severity = ?, enabled = ?, cooldown_secs = ? WHERE id = ? AND org_id = ?",
		r.Name, r.Description, r.EventType, r.Condition, r.Severity, r.Enabled, r.Cooldown, r.ID, r.OrgID)
	return err
}

// DeleteAlertRule removes an alert rule.
func (s *Store) DeleteAlertRule(ctx context.Context, orgID, id int64) error {
	_, err := s.DB.ExecContext(ctx,
		`DELETE FROM alert_rules WHERE id = ? AND org_id = ?`, id, orgID)
	return err
}

// UpdateAlertRuleLastFired updates the last_fired timestamp.
func (s *Store) UpdateAlertRuleLastFired(ctx context.Context, id int64) error {
	_, err := s.DB.ExecContext(ctx,
		`UPDATE alert_rules SET last_fired = NOW() WHERE id = ?`, id)
	return err
}

// ListEnabledAlertRules returns all enabled rules across all orgs (used by the engine).
func (s *Store) ListEnabledAlertRules(ctx context.Context) ([]models.AlertRule, error) {
	var out []models.AlertRule
	err := s.DB.SelectContext(ctx, &out,
		"SELECT id, org_id, name, description, event_type, `condition`, severity, enabled, cooldown_secs, last_fired, created_at, updated_at FROM alert_rules WHERE enabled = TRUE")
	return out, err
}
