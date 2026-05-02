package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/honeybee-enhanced/shared/models"
)

// CreateSession inserts a new attacker session.
func (s *Store) CreateSession(ctx context.Context, sess *models.Session) (int64, error) {
	res, err := s.DB.ExecContext(ctx,
		`INSERT INTO sessions(org_id, node_id, deploy_id, pot_id, session_id,
		                     src_ip, src_port, dst_port, started_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		sess.OrgID, sess.NodeID, sess.DeployID, sess.PotID, sess.SessionID,
		sess.SrcIP, sess.SrcPort, sess.DstPort, sess.StartedAt)
	if err != nil {
		return 0, fmt.Errorf("insert session: %w", err)
	}
	id, err := res.LastInsertId()
	if err == nil {
		sess.ID = id
	}
	return id, err
}

// GetSession fetches by primary key, scoped to org.
func (s *Store) GetSession(ctx context.Context, orgID, id int64) (*models.Session, error) {
	var sess models.Session
	err := s.DB.GetContext(ctx, &sess,
		`SELECT id, org_id, node_id, deploy_id, pot_id, session_id,
		        src_ip, src_port, dst_port, started_at, ended_at, duration_secs
		 FROM sessions WHERE id = ? AND org_id = ?`, id, orgID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &sess, err
}

// GetSessionBySID looks up by the wire session_id (string from node).
func (s *Store) GetSessionBySID(ctx context.Context, sessionID string) (*models.Session, error) {
	var sess models.Session
	err := s.DB.GetContext(ctx, &sess,
		`SELECT id, org_id, node_id, deploy_id, pot_id, session_id,
		        src_ip, src_port, dst_port, started_at, ended_at, duration_secs
		 FROM sessions WHERE session_id = ?`, sessionID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &sess, err
}

// ListSessions returns sessions matching optional filters, newest first.
func (s *Store) ListSessions(ctx context.Context, orgID int64, nodeID int64, potID, srcIP string, limit, offset int) ([]models.Session, error) {
	if limit <= 0 {
		limit = 100
	}
	q := `SELECT id, org_id, node_id, deploy_id, pot_id, session_id,
	             src_ip, src_port, dst_port, started_at, ended_at, duration_secs
	      FROM sessions WHERE org_id = ?`
	args := []any{orgID}
	if nodeID > 0 {
		q += " AND node_id = ?"
		args = append(args, nodeID)
	}
	if potID != "" {
		q += " AND pot_id = ?"
		args = append(args, potID)
	}
	if srcIP != "" {
		q += " AND src_ip = ?"
		args = append(args, srcIP)
	}
	q += fmt.Sprintf(" ORDER BY started_at DESC LIMIT %d OFFSET %d", limit, offset)
	var out []models.Session
	err := s.DB.SelectContext(ctx, &out, q, args...)
	return out, err
}

// AppendSessionData adds one ordered chunk of attacker terminal bytes.
func (s *Store) AppendSessionData(ctx context.Context, sessionID, sequence int64, raw []byte) error {
	_, err := s.DB.ExecContext(ctx,
		`INSERT INTO session_data(session_id, sequence, raw_data) VALUES (?, ?, ?)`,
		sessionID, sequence, raw)
	return err
}

// GetSessionChunks returns ordered chunks for replay.
func (s *Store) GetSessionChunks(ctx context.Context, sessionID int64) ([]models.SessionDataChunk, error) {
	var out []models.SessionDataChunk
	err := s.DB.SelectContext(ctx, &out,
		`SELECT id, session_id, sequence, raw_data, captured_at
		 FROM session_data WHERE session_id = ? ORDER BY sequence ASC`, sessionID)
	return out, err
}

// FinalizeSession sets ended_at + duration.
func (s *Store) FinalizeSession(ctx context.Context, sessionID string, durationSecs int64) error {
	_, err := s.DB.ExecContext(ctx,
		`UPDATE sessions SET ended_at = ?, duration_secs = ? WHERE session_id = ?`,
		time.Now().UTC(), durationSecs, sessionID)
	return err
}
