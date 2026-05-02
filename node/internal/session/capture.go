// Package session watches Cowrie .tty (TTY log) files and forwards them as
// session_start / session_data / session_end protocol messages.
package session

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// Sender is implemented by the agent to push session messages upstream.
type Sender interface {
	SendSessionStart(potID, sessionID, srcIP string, srcPort int)
	SendSessionData(sessionID string, seq int64, chunk []byte)
	SendSessionEnd(sessionID string, durationSec float64)
}

// Capture watches a directory for new TTY files and tails each one.
type Capture struct {
	dir    string
	logger *slog.Logger
	sender Sender

	mu       sync.Mutex
	watching map[string]struct{}
}

// New constructs a Capture.
func New(dir string, logger *slog.Logger, sender Sender) *Capture {
	return &Capture{
		dir:      dir,
		logger:   logger,
		sender:   sender,
		watching: make(map[string]struct{}),
	}
}

// Start begins watching. Returns immediately if dir is empty.
func (c *Capture) Start(ctx context.Context) error {
	if c.dir == "" {
		return nil
	}
	if err := os.MkdirAll(c.dir, 0o755); err != nil {
		return err
	}
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	if err := w.Add(c.dir); err != nil {
		_ = w.Close()
		return err
	}
	c.logger.Info("session capture watching", slog.String("dir", c.dir))
	go func() {
		defer w.Close()
		for {
			select {
			case <-ctx.Done():
				return
			case ev, ok := <-w.Events:
				if !ok {
					return
				}
				if ev.Op&fsnotify.Create != 0 && filepath.Ext(ev.Name) == ".tty" {
					go c.tail(ctx, ev.Name)
				}
			case err, ok := <-w.Errors:
				if !ok {
					return
				}
				c.logger.Warn("watcher error", slog.Any("err", err))
			}
		}
	}()
	return nil
}

func (c *Capture) tail(ctx context.Context, path string) {
	c.mu.Lock()
	if _, ok := c.watching[path]; ok {
		c.mu.Unlock()
		return
	}
	c.watching[path] = struct{}{}
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		delete(c.watching, path)
		c.mu.Unlock()
	}()

	sessionID := filepath.Base(path)
	potID := filepath.Base(filepath.Dir(filepath.Dir(path)))
	c.sender.SendSessionStart(potID, sessionID, "", 0)
	start := time.Now()

	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	var seq int64
	buf := make([]byte, 4096)
	idle := 0
	for {
		select {
		case <-ctx.Done():
			c.sender.SendSessionEnd(sessionID, time.Since(start).Seconds())
			return
		default:
		}
		n, err := f.Read(buf)
		if n > 0 {
			seq++
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			c.sender.SendSessionData(sessionID, seq, chunk)
			idle = 0
			continue
		}
		if err == io.EOF || n == 0 {
			time.Sleep(500 * time.Millisecond)
			idle++
			// 5 minutes of idle = end of session
			if idle > 600 {
				c.sender.SendSessionEnd(sessionID, time.Since(start).Seconds())
				return
			}
			continue
		}
		if err != nil {
			c.sender.SendSessionEnd(sessionID, time.Since(start).Seconds())
			return
		}
	}
}
