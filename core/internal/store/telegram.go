package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/honeybee-enhanced/shared/models"
)

const tgCols = `id, org_id, name, bot_token, chat_id, enabled, config, msg_format, throttle_secs, last_sent_at, created_at, updated_at`

func scanTelegramBot(rows interface{ Scan(dest ...any) error }) (models.TelegramBot, error) {
	var b models.TelegramBot
	var token, cfgJSON, format string
	var enabled int
	var lastSent sql.NullTime
	if err := rows.Scan(&b.ID, &b.OrgID, &b.Name, &token, &b.ChatID, &enabled, &cfgJSON, &format,
		&b.ThrottleSecs, &lastSent, &b.CreatedAt, &b.UpdatedAt); err != nil {
		return b, err
	}
	b.BotToken = token
	b.HasToken = token != ""
	b.Enabled = enabled == 1
	b.MsgFormat = models.TelegramMsgFormat(format)
	if lastSent.Valid {
		t := lastSent.Time
		b.LastSentAt = &t
	}
	if cfgJSON != "" {
		_ = json.Unmarshal([]byte(cfgJSON), &b.Config)
	}
	return b, nil
}

// ListTelegramBots returns all bots for an org (newest first).
func (s *Store) ListTelegramBots(ctx context.Context, orgID int64) ([]models.TelegramBot, error) {
	return s.queryTelegramBots(ctx, `SELECT `+tgCols+` FROM telegram_bots WHERE org_id = ? ORDER BY id DESC`, orgID)
}

// ListEnabledTelegramBots returns only enabled bots for an org (notifier hot path).
func (s *Store) ListEnabledTelegramBots(ctx context.Context, orgID int64) ([]models.TelegramBot, error) {
	return s.queryTelegramBots(ctx, `SELECT `+tgCols+` FROM telegram_bots WHERE org_id = ? AND enabled = 1`, orgID)
}

func (s *Store) queryTelegramBots(ctx context.Context, q string, args ...any) ([]models.TelegramBot, error) {
	rows, err := s.DB.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.TelegramBot{}
	for rows.Next() {
		b, err := scanTelegramBot(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// GetTelegramBot fetches one bot by org + id (includes the secret token).
func (s *Store) GetTelegramBot(ctx context.Context, orgID, id int64) (*models.TelegramBot, error) {
	row := s.DB.QueryRowContext(ctx, `SELECT `+tgCols+` FROM telegram_bots WHERE org_id = ? AND id = ?`, orgID, id)
	b, err := scanTelegramBot(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &b, nil
}

// CreateTelegramBot inserts a new bot and returns its id.
func (s *Store) CreateTelegramBot(ctx context.Context, b *models.TelegramBot) (int64, error) {
	cfg, _ := json.Marshal(b.Config)
	if b.MsgFormat == "" {
		b.MsgFormat = models.TGFormatText
	}
	res, err := s.DB.ExecContext(ctx,
		`INSERT INTO telegram_bots (org_id, name, bot_token, chat_id, enabled, config, msg_format, throttle_secs)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		b.OrgID, b.Name, b.BotToken, b.ChatID, b.Enabled, string(cfg), string(b.MsgFormat), b.ThrottleSecs)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// UpdateTelegramBot updates a bot. An empty BotToken preserves the stored token
// (so the dashboard can edit a bot without re-entering its secret).
func (s *Store) UpdateTelegramBot(ctx context.Context, b *models.TelegramBot) error {
	cfg, _ := json.Marshal(b.Config)
	if b.MsgFormat == "" {
		b.MsgFormat = models.TGFormatText
	}
	_, err := s.DB.ExecContext(ctx,
		`UPDATE telegram_bots
		 SET name = ?, chat_id = ?, enabled = ?, config = ?, msg_format = ?, throttle_secs = ?,
		     bot_token = IF(? = '', bot_token, ?)
		 WHERE org_id = ? AND id = ?`,
		b.Name, b.ChatID, b.Enabled, string(cfg), string(b.MsgFormat), b.ThrottleSecs,
		b.BotToken, b.BotToken, b.OrgID, b.ID)
	return err
}

// SetTelegramBotEnabled toggles a bot on/off.
func (s *Store) SetTelegramBotEnabled(ctx context.Context, orgID, id int64, enabled bool) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE telegram_bots SET enabled = ? WHERE org_id = ? AND id = ?`, enabled, orgID, id)
	return err
}

// DeleteTelegramBot removes a bot.
func (s *Store) DeleteTelegramBot(ctx context.Context, orgID, id int64) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM telegram_bots WHERE org_id = ? AND id = ?`, orgID, id)
	return err
}

// TouchTelegramBotSent records the last successful send time (UI only).
func (s *Store) TouchTelegramBotSent(ctx context.Context, id int64) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE telegram_bots SET last_sent_at = NOW() WHERE id = ?`, id)
	return err
}
