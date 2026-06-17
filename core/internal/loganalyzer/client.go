// Package loganalyzer is a thin HTTP client for the LogAnalyzer service.
//
// It is intentionally minimal: HoneyBee only needs to (1) provision a
// workspace when a node opts in, and (2) push log/event entries to that
// workspace's ingest endpoint. Both calls are safe to invoke when the
// integration is disabled — they become no-ops.
package loganalyzer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/honeybee-enhanced/core/internal/config"
)

// Entry is a single ingestible log record. The LogAnalyzer schema is
// permissive — any map[string]any with at least a timestamp and message is
// accepted, so we surface common fields and let callers add the rest.
//
// Defined as an alias (=) rather than a new type so callers can pass plain
// []map[string]any literals without conversion.
type Entry = map[string]any

// Client talks to the LogAnalyzer HTTP API.
type Client struct {
	cfg  config.LogAnalyzerConfig
	http *http.Client
	log  *slog.Logger
}

// New constructs a client. Returns a usable disabled client when cfg.Enabled
// is false so callers can avoid nil checks.
func New(cfg config.LogAnalyzerConfig, log *slog.Logger) *Client {
	if log == nil {
		log = slog.Default()
	}
	cfg.URL = strings.TrimRight(cfg.URL, "/")
	if cfg.PublicURL == "" {
		cfg.PublicURL = cfg.URL
	}
	cfg.PublicURL = strings.TrimRight(cfg.PublicURL, "/")
	if cfg.RetentionDays <= 0 {
		cfg.RetentionDays = 30
	}
	return &Client{
		cfg:  cfg,
		http: &http.Client{Timeout: 5 * time.Second},
		log:  log.With(slog.String("component", "loganalyzer")),
	}
}

// Enabled reports whether the integration is on.
func (c *Client) Enabled() bool { return c != nil && c.cfg.Enabled }

// PublicURL returns the browser-facing base URL of the LogAnalyzer UI.
func (c *Client) PublicURL() string {
	if c == nil {
		return ""
	}
	return c.cfg.PublicURL
}

// Health performs a lightweight reachability probe against the LogAnalyzer
// service. It returns nil when the service answers at all (any status < 500),
// which is enough to confirm the integration endpoint is up and routable
// without depending on a specific health route existing.
func (c *Client) Health(ctx context.Context) error {
	if !c.Enabled() {
		return errors.New("loganalyzer: integration disabled")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.cfg.URL, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 2048))
	if resp.StatusCode >= 500 {
		return fmt.Errorf("loganalyzer returned status %d", resp.StatusCode)
	}
	return nil
}

// WorkspaceURL returns a deep link to a specific workspace's UI page.
func (c *Client) WorkspaceURL(workspaceID string) string {
	if c == nil || workspaceID == "" {
		return ""
	}
	return fmt.Sprintf("%s/?workspace=%s", c.cfg.PublicURL, workspaceID)
}

// CreateWorkspace provisions a webhook-mode workspace and returns the
// LogAnalyzer-generated workspace ID together with its ingest token.
//
// The LogAnalyzer endpoint `POST /api/workspaces` accepts:
//
//	{ "name": "...", "connectionType": "webhook", "retentionDays": N }
//
// and returns the full workspace object including a one-time token under
// `connectionConfig.token` plus a top-level `webhookUrl`.
func (c *Client) CreateWorkspace(ctx context.Context, name string) (workspaceID, token string, err error) {
	if !c.Enabled() {
		return "", "", errors.New("loganalyzer: integration disabled")
	}
	body, _ := json.Marshal(map[string]any{
		"name":           name,
		"connectionType": "webhook",
		"retentionDays":  c.cfg.RetentionDays,
	})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		c.cfg.URL+"/api/workspaces", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("loganalyzer: create workspace: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", "", fmt.Errorf("loganalyzer: create workspace: status %d: %s", resp.StatusCode, string(raw))
	}

	var ws struct {
		ID          string `json:"id"`
		IngestToken string `json:"ingestToken"`
	}
	if err := json.Unmarshal(raw, &ws); err != nil {
		return "", "", fmt.Errorf("loganalyzer: decode workspace response: %w", err)
	}
	if ws.ID == "" || ws.IngestToken == "" {
		return "", "", fmt.Errorf("loganalyzer: incomplete workspace response: %s", string(raw))
	}
	return ws.ID, ws.IngestToken, nil
}

// Ingest pushes a batch of entries to the LogAnalyzer ingest endpoint using
// the workspace-scoped bearer token. Single-entry or array payloads are both
// supported by the LogAnalyzer; we always send an array.
func (c *Client) Ingest(ctx context.Context, token string, entries []Entry) error {
	if !c.Enabled() || token == "" || len(entries) == 0 {
		return nil
	}
	body, err := json.Marshal(entries)
	if err != nil {
		return err
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		c.cfg.URL+"/api/ingest", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("loganalyzer: ingest: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("loganalyzer: ingest: status %d: %s", resp.StatusCode, string(raw))
	}
	return nil
}

// FireAndForget pushes entries in a goroutine with a short timeout, never
// blocking the caller and only logging failures. Use this on the hot path
// (event/log dispatch) where the integration is best-effort.
func (c *Client) FireAndForget(token string, entries []Entry) {
	if !c.Enabled() || token == "" || len(entries) == 0 {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := c.Ingest(ctx, token, entries); err != nil {
			c.log.Warn("ingest failed", slog.String("err", err.Error()), slog.Int("entries", len(entries)))
		}
	}()
}

// DeleteWorkspace removes a workspace from LogAnalyzer.
// This is a best-effort call: if the workspace does not exist (404) the error
// is silently swallowed, so callers can safely call it even after a partial
// earlier failure.
func (c *Client) DeleteWorkspace(ctx context.Context, workspaceID string) error {
	if !c.Enabled() || workspaceID == "" {
		return nil
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodDelete,
		c.cfg.URL+"/api/workspaces/"+workspaceID, nil)
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("loganalyzer: delete workspace: %w", err)
	}
	defer resp.Body.Close()
	// 404 means it was already gone — treat as success.
	if resp.StatusCode == http.StatusNotFound {
		return nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("loganalyzer: delete workspace: status %d: %s", resp.StatusCode, string(raw))
	}
	return nil
}
