// Package telegram is a minimal client for the Telegram Bot API (sendMessage).
package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

// Client sends messages through the Telegram Bot API.
type Client struct {
	http *http.Client
	log  *slog.Logger
}

// New constructs a client.
func New(log *slog.Logger) *Client {
	if log == nil {
		log = slog.Default()
	}
	return &Client{
		http: &http.Client{Timeout: 8 * time.Second},
		log:  log.With(slog.String("component", "telegram")),
	}
}

// SendMessage posts text to a chat via https://api.telegram.org/bot<token>/sendMessage.
// parseMode is "" (plain), "MarkdownV2", or "HTML". Returns a descriptive error
// (surfacing Telegram's own `description`) so the UI test action is diagnosable.
func (c *Client) SendMessage(ctx context.Context, token, chatID, text, parseMode string) error {
	if token == "" || chatID == "" {
		return fmt.Errorf("telegram: bot token and chat id are required")
	}
	payload := map[string]any{
		"chat_id":                  chatID,
		"text":                     text,
		"disable_web_page_preview": true,
	}
	if parseMode != "" {
		payload["parse_mode"] = parseMode
	}
	body, _ := json.Marshal(payload)
	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", token)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("telegram: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))

	var out struct {
		OK          bool   `json:"ok"`
		Description string `json:"description"`
	}
	_ = json.Unmarshal(raw, &out)
	if resp.StatusCode >= 200 && resp.StatusCode < 300 && out.OK {
		return nil
	}
	if out.Description != "" {
		return fmt.Errorf("telegram: %s", out.Description)
	}
	return fmt.Errorf("telegram: HTTP %d", resp.StatusCode)
}
