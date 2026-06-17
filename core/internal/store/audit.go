package store

import (
	"context"
	"database/sql"

	"github.com/honeybee-enhanced/shared/models"
)

// LogAudit writes an audit entry.
func (s *Store) LogAudit(ctx context.Context, orgID int64, userID *int64, action, resource string, resourceID *string, details string) error {
	var uid sql.NullInt64
	if userID != nil {
		uid = sql.NullInt64{Int64: *userID, Valid: true}
	}
	var rid sql.NullString
	if resourceID != nil {
		rid = sql.NullString{String: *resourceID, Valid: true}
	}
	_, err := s.DB.ExecContext(ctx,
		`INSERT INTO audit_log(org_id, user_id, action, resource, resource_id, details)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		orgID, uid, action, resource, rid, details)
	if err == nil && s.AuditHook != nil {
		s.AuditHook(orgID, userID, action, resource)
	}
	return err
}

// ListAudit returns recent audit entries for an org.
func (s *Store) ListAudit(ctx context.Context, orgID int64, limit int) ([]models.AuditEntry, error) {
	if limit <= 0 {
		limit = 100
	}
	var out []models.AuditEntry
	err := s.DB.SelectContext(ctx, &out,
		`SELECT id, org_id, user_id, action, resource, resource_id, details, created_at
		 FROM audit_log WHERE org_id = ? ORDER BY id DESC LIMIT ?`, orgID, limit)
	return out, err
}
