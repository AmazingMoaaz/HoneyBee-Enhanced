// Package store implements the persistence layer over MySQL.
package store

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"strings"
	"time"

	mysql "github.com/go-sql-driver/mysql"
	"github.com/jmoiron/sqlx"
)

//go:embed schema.sql
var migrationFS embed.FS

// Store is the central database handle.
type Store struct {
	DB *sqlx.DB
}

// Open dials MySQL, configures the pool, and returns a Store.
func Open(ctx context.Context, dsn string, maxOpen, maxIdle int) (*Store, error) {
	db, err := sqlx.ConnectContext(ctx, "mysql", dsn)
	if err != nil {
		return nil, fmt.Errorf("connect mysql: %w", err)
	}
	db.SetMaxOpenConns(maxOpen)
	db.SetMaxIdleConns(maxIdle)
	db.SetConnMaxLifetime(time.Hour)
	return &Store{DB: db}, nil
}

// Close releases the underlying pool.
func (s *Store) Close() error {
	if s == nil || s.DB == nil {
		return nil
	}
	return s.DB.Close()
}

// Migrate applies the embedded up migration. Idempotent.
// MySQL 8 does not support ADD COLUMN IF NOT EXISTS; instead we suppress
// error 1060 (duplicate column) and 1061 (duplicate key name) which simply
// mean the statement was already applied on a previous run.
func (s *Store) Migrate(ctx context.Context) error {
	data, err := migrationFS.ReadFile("schema.sql")
	if err != nil {
		return fmt.Errorf("read migration: %w", err)
	}
	for _, stmt := range splitStatements(string(data)) {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		if _, err := s.DB.ExecContext(ctx, stmt); err != nil {
			var myErr *mysql.MySQLError
			if errors.As(err, &myErr) && (myErr.Number == 1060 || myErr.Number == 1061) {
				// 1060 = duplicate column name, 1061 = duplicate key name
				// column/index already exists from a previous migration run — safe to skip
				continue
			}
			return fmt.Errorf("exec migration: %w\nstatement: %s", err, stmt)
		}
	}
	return nil
}

func splitStatements(sqlText string) []string {
	parts := strings.Split(sqlText, ";")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if strings.TrimSpace(p) != "" {
			out = append(out, p)
		}
	}
	return out
}

// SQLNullTime helper for nullable timestamps.
func SQLNullTime(t *time.Time) sql.NullTime {
	if t == nil {
		return sql.NullTime{}
	}
	return sql.NullTime{Time: *t, Valid: true}
}
