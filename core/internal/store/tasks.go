package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/honeybee-enhanced/shared/models"
)

// CreateTask inserts a task in 'pending' state.
func (s *Store) CreateTask(ctx context.Context, orgID, nodeID int64, deployID *int64, command, payloadJSON string) (int64, error) {
	res, err := s.DB.ExecContext(ctx,
		`INSERT INTO tasks(org_id, node_id, deploy_id, command, payload, status, result)
		 VALUES (?, ?, ?, ?, ?, 'pending', '')`,
		orgID, nodeID, deployID, command, payloadJSON)
	if err != nil {
		return 0, fmt.Errorf("insert task: %w", err)
	}
	return res.LastInsertId()
}

// MarkTaskSent transitions a task pending -> sent.
func (s *Store) MarkTaskSent(ctx context.Context, id int64) error {
	_, err := s.DB.ExecContext(ctx,
		`UPDATE tasks SET status = 'sent' WHERE id = ? AND status = 'pending'`, id)
	return err
}

// UpdateTaskResult sets the final status + message.
func (s *Store) UpdateTaskResult(ctx context.Context, id int64, status, result string) error {
	_, err := s.DB.ExecContext(ctx,
		`UPDATE tasks SET status = ?, result = ? WHERE id = ?`, status, result, id)
	return err
}

// PendingTasksForNode returns all pending tasks for a node, oldest first.
func (s *Store) PendingTasksForNode(ctx context.Context, nodeID int64) ([]models.Task, error) {
	var out []models.Task
	err := s.DB.SelectContext(ctx, &out,
		`SELECT id, org_id, node_id, deploy_id, command, payload, status, result, created_at, updated_at
		 FROM tasks WHERE node_id = ? AND status = 'pending' ORDER BY id ASC`, nodeID)
	return out, err
}

// ResetSentTasksForNode demotes 'sent' -> 'pending' for the given node.
// Called when a node disconnects so undelivered work is retried on reconnect.
func (s *Store) ResetSentTasksForNode(ctx context.Context, nodeID int64) error {
	_, err := s.DB.ExecContext(ctx,
		`UPDATE tasks SET status = 'pending' WHERE node_id = ? AND status = 'sent'`, nodeID)
	return err
}

// ResetAllSentTasks is run at server startup to recover from a crash.
func (s *Store) ResetAllSentTasks(ctx context.Context) error {
	_, err := s.DB.ExecContext(ctx,
		`UPDATE tasks SET status = 'pending' WHERE status = 'sent'`)
	return err
}

// GetTask fetches a task scoped to org.
func (s *Store) GetTask(ctx context.Context, orgID, id int64) (*models.Task, error) {
	var t models.Task
	err := s.DB.GetContext(ctx, &t,
		`SELECT id, org_id, node_id, deploy_id, command, payload, status, result, created_at, updated_at
		 FROM tasks WHERE id = ? AND org_id = ?`, id, orgID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &t, err
}
