package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/honeybee-enhanced/shared/models"
)

// ErrRoleInUse is returned when deleting a role still assigned to users.
var ErrRoleInUse = errors.New("store: role is assigned to users")

// ErrSystemRole is returned when attempting to modify a built-in role.
var ErrSystemRole = errors.New("store: built-in roles cannot be modified")

var roleSlugRE = regexp.MustCompile(`[^a-z0-9]+`)

func roleSlugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = roleSlugRE.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = "role"
	}
	if len(s) > 60 {
		s = s[:60]
	}
	return s
}

// sanitizePerms keeps only known permission keys, de-duplicated.
func sanitizePerms(perms []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(perms))
	for _, p := range perms {
		if !models.ValidPerm(p) {
			continue
		}
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	return out
}

// EnsureSystemRoles upserts the three built-in roles for an org so their
// metadata + permission sets stay current (e.g. when new permissions ship).
func (s *Store) EnsureSystemRoles(ctx context.Context, orgID int64) error {
	for slug, meta := range models.SystemRoleMeta {
		perms, _ := json.Marshal(models.BuiltinRolePerms[slug])
		_, err := s.DB.ExecContext(ctx,
			`INSERT INTO roles (org_id, slug, name, color, permissions, is_system)
			 VALUES (?, ?, ?, ?, ?, 1)
			 ON DUPLICATE KEY UPDATE name=VALUES(name), color=VALUES(color),
			   permissions=VALUES(permissions), is_system=1`,
			orgID, slug, meta.Name, meta.Color, string(perms))
		if err != nil {
			return fmt.Errorf("ensure system role %s: %w", slug, err)
		}
	}
	return nil
}

// SeedSystemRolesAllOrgs ensures built-in roles exist for every org (run once
// at startup so pre-existing orgs gain the roles table rows).
func (s *Store) SeedSystemRolesAllOrgs(ctx context.Context) error {
	var ids []int64
	if err := s.DB.SelectContext(ctx, &ids, `SELECT id FROM organizations`); err != nil {
		return err
	}
	for _, id := range ids {
		if err := s.EnsureSystemRoles(ctx, id); err != nil {
			return err
		}
	}
	return nil
}

func scanRole(rows interface {
	Scan(dest ...any) error
}) (models.RoleDef, error) {
	var r models.RoleDef
	var permsJSON string
	var isSystem int
	if err := rows.Scan(&r.ID, &r.OrgID, &r.Slug, &r.Name, &r.Color, &permsJSON, &isSystem, &r.CreatedAt, &r.UpdatedAt); err != nil {
		return r, err
	}
	r.IsSystem = isSystem == 1
	if permsJSON != "" {
		_ = json.Unmarshal([]byte(permsJSON), &r.Permissions)
	}
	if r.Permissions == nil {
		r.Permissions = []string{}
	}
	return r, nil
}

const roleCols = `id, org_id, slug, name, color, permissions, is_system, created_at, updated_at`

// ListRoles returns all roles for an org (system first, then by name).
func (s *Store) ListRoles(ctx context.Context, orgID int64) ([]models.RoleDef, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT `+roleCols+` FROM roles WHERE org_id = ? ORDER BY is_system DESC, name ASC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.RoleDef{}
	for rows.Next() {
		r, err := scanRole(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetRoleBySlug fetches one role by org + slug.
func (s *Store) GetRoleBySlug(ctx context.Context, orgID int64, slug string) (*models.RoleDef, error) {
	row := s.DB.QueryRowContext(ctx, `SELECT `+roleCols+` FROM roles WHERE org_id = ? AND slug = ?`, orgID, slug)
	r, err := scanRole(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// GetRole fetches one role by org + id.
func (s *Store) GetRole(ctx context.Context, orgID, id int64) (*models.RoleDef, error) {
	row := s.DB.QueryRowContext(ctx, `SELECT `+roleCols+` FROM roles WHERE org_id = ? AND id = ?`, orgID, id)
	r, err := scanRole(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// ResolvePerms returns the effective permission set for a role slug in an org.
// Admin always resolves to the full set; unknown roles resolve to none.
func (s *Store) ResolvePerms(ctx context.Context, orgID int64, slug string) []string {
	if slug == string(models.RoleAdmin) {
		return models.AllPermKeys()
	}
	if r, err := s.GetRoleBySlug(ctx, orgID, slug); err == nil {
		return r.Permissions
	}
	if def, ok := models.BuiltinRolePerms[slug]; ok {
		return def
	}
	return []string{}
}

// CreateRole inserts a custom role with a generated unique slug.
func (s *Store) CreateRole(ctx context.Context, orgID int64, name, color string, perms []string) (*models.RoleDef, error) {
	base := roleSlugify(name)
	slug := base
	for i := 2; ; i++ {
		var n int
		if err := s.DB.GetContext(ctx, &n, `SELECT COUNT(*) FROM roles WHERE org_id = ? AND slug = ?`, orgID, slug); err != nil {
			return nil, err
		}
		if n == 0 {
			break
		}
		slug = fmt.Sprintf("%s-%d", base, i)
	}
	if color == "" {
		color = "#64748B"
	}
	permsJSON, _ := json.Marshal(sanitizePerms(perms))
	res, err := s.DB.ExecContext(ctx,
		`INSERT INTO roles (org_id, slug, name, color, permissions, is_system) VALUES (?, ?, ?, ?, ?, 0)`,
		orgID, slug, name, color, string(permsJSON))
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return s.GetRole(ctx, orgID, id)
}

// UpdateRole updates a custom role's name/color/permissions (system roles are immutable).
func (s *Store) UpdateRole(ctx context.Context, orgID, id int64, name, color string, perms []string) error {
	cur, err := s.GetRole(ctx, orgID, id)
	if err != nil {
		return err
	}
	if cur.IsSystem {
		return ErrSystemRole
	}
	if color == "" {
		color = cur.Color
	}
	permsJSON, _ := json.Marshal(sanitizePerms(perms))
	_, err = s.DB.ExecContext(ctx,
		`UPDATE roles SET name = ?, color = ?, permissions = ? WHERE org_id = ? AND id = ?`,
		name, color, string(permsJSON), orgID, id)
	return err
}

// CountUsersWithRole returns how many users currently hold a role slug.
func (s *Store) CountUsersWithRole(ctx context.Context, orgID int64, slug string) (int, error) {
	var n int
	err := s.DB.GetContext(ctx, &n, `SELECT COUNT(*) FROM users WHERE org_id = ? AND role = ?`, orgID, slug)
	return n, err
}

// DeleteRole removes a custom role if it is not built-in and not in use.
func (s *Store) DeleteRole(ctx context.Context, orgID, id int64) error {
	cur, err := s.GetRole(ctx, orgID, id)
	if err != nil {
		return err
	}
	if cur.IsSystem {
		return ErrSystemRole
	}
	n, err := s.CountUsersWithRole(ctx, orgID, cur.Slug)
	if err != nil {
		return err
	}
	if n > 0 {
		return ErrRoleInUse
	}
	_, err = s.DB.ExecContext(ctx, `DELETE FROM roles WHERE org_id = ? AND id = ?`, orgID, id)
	return err
}

// RoleExists reports whether a role slug exists for an org (built-in or custom).
func (s *Store) RoleExists(ctx context.Context, orgID int64, slug string) bool {
	if _, ok := models.BuiltinRolePerms[slug]; ok {
		return true
	}
	_, err := s.GetRoleBySlug(ctx, orgID, slug)
	return err == nil
}
