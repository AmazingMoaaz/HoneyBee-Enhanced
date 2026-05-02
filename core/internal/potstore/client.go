// Package potstore fetches and caches the catalog of available honeypots.
package potstore

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/honeybee-enhanced/shared/models"
)

// Client retrieves and caches the potstore.json catalog.
type Client struct {
	repoURL  string
	interval time.Duration
	logger   *slog.Logger
	http     *http.Client

	mu      sync.RWMutex
	entries []models.PotStoreEntry
	byID    map[string]models.PotStoreEntry
	updated time.Time
}

// NewClient constructs a Client.
func NewClient(repoURL string, interval time.Duration, logger *slog.Logger) *Client {
	return &Client{
		repoURL:  repoURL,
		interval: interval,
		logger:   logger,
		http:     &http.Client{Timeout: 30 * time.Second},
		byID:     make(map[string]models.PotStoreEntry),
	}
}

// Start begins the periodic sync loop. Performs one sync immediately.
func (c *Client) Start(ctx context.Context) {
	if err := c.Sync(ctx); err != nil {
		c.logger.Warn("initial potstore sync failed", slog.Any("err", err))
	}
	go func() {
		t := time.NewTicker(c.interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if err := c.Sync(ctx); err != nil {
					c.logger.Warn("potstore sync failed", slog.Any("err", err))
				}
			}
		}
	}()
}

// Sync fetches the manifest now.
func (c *Client) Sync(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.repoURL, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("potstore http %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	var entries []models.PotStoreEntry
	if err := json.Unmarshal(body, &entries); err != nil {
		// Tolerate {"pots":[...]} wrapper.
		var wrap struct {
			Pots []models.PotStoreEntry `json:"pots"`
		}
		if err2 := json.Unmarshal(body, &wrap); err2 == nil {
			entries = wrap.Pots
		} else {
			return fmt.Errorf("parse potstore: %w", err)
		}
	}
	byID := make(map[string]models.PotStoreEntry, len(entries))
	for _, e := range entries {
		byID[e.ID] = e
	}
	c.mu.Lock()
	c.entries = entries
	c.byID = byID
	c.updated = time.Now().UTC()
	c.mu.Unlock()
	c.logger.Info("potstore synced", slog.Int("count", len(entries)))
	return nil
}

// List returns all entries.
func (c *Client) List() []models.PotStoreEntry {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make([]models.PotStoreEntry, len(c.entries))
	copy(out, c.entries)
	return out
}

// Lookup returns one entry by ID.
func (c *Client) Lookup(id string) (models.PotStoreEntry, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	e, ok := c.byID[id]
	return e, ok
}

// LastUpdated returns the timestamp of the last successful sync.
func (c *Client) LastUpdated() time.Time {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.updated
}
