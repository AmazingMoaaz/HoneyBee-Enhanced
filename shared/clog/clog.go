// Package clog is a zero-dependency colorful slog handler plus a few helpers
// for drawing colored panels and banners in the terminal.
//
// It is shared by both the core and the node so their logs look consistent.
// Color is auto-disabled when stdout is not a terminal or NO_COLOR is set
// (https://no-color.org). On Windows it best-effort enables ANSI/VT processing.
package clog

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ANSI escape codes. Exported so callers can build their own colored output
// (e.g. the diagnostic health panels) with the same palette.
const (
	Reset        = "\x1b[0m"
	Bold         = "\x1b[1m"
	Dim          = "\x1b[2m"
	Italic       = "\x1b[3m"
	Red          = "\x1b[31m"
	Green        = "\x1b[32m"
	Yellow       = "\x1b[33m"
	Blue         = "\x1b[34m"
	Magenta      = "\x1b[35m"
	Cyan         = "\x1b[36m"
	Gray         = "\x1b[90m"
	BrightRed    = "\x1b[91m"
	BrightGreen  = "\x1b[92m"
	BrightYellow = "\x1b[93m"
	BrightBlue   = "\x1b[94m"
	BrightMag    = "\x1b[95m"
	BrightCyan   = "\x1b[96m"
	White        = "\x1b[97m"
)

// UseColor controls whether C() and the handler emit ANSI codes. New() sets it
// based on terminal detection; callers may override it.
var UseColor = true

// C wraps s in the given ANSI color (a no-op when color is disabled).
func C(color, s string) string {
	if !UseColor || color == "" {
		return s
	}
	return color + s + Reset
}

// LevelFromString maps a config string to an slog.Level (default info).
func LevelFromString(level string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// New builds a colorful slog.Logger writing to stdout. It auto-detects whether
// color should be used and enables VT processing on Windows when so.
func New(level string) *slog.Logger {
	w := os.Stdout
	UseColor = shouldColor(w)
	if UseColor {
		enableVT() // best-effort, Windows-only
	}
	return slog.New(NewHandler(w, LevelFromString(level)))
}

func shouldColor(f *os.File) bool {
	if _, ok := os.LookupEnv("NO_COLOR"); ok {
		return false
	}
	if os.Getenv("TERM") == "dumb" {
		return false
	}
	fi, err := f.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice != 0
}

// Handler is a human-friendly, colorized slog.Handler.
type Handler struct {
	mu     *sync.Mutex
	w      io.Writer
	level  slog.Level
	attrs  []slog.Attr
	groups []string
}

// NewHandler constructs a colorful handler at the given level.
func NewHandler(w io.Writer, level slog.Level) *Handler {
	return &Handler{mu: &sync.Mutex{}, w: w, level: level}
}

// Enabled implements slog.Handler.
func (h *Handler) Enabled(_ context.Context, l slog.Level) bool { return l >= h.level }

// WithAttrs implements slog.Handler.
func (h *Handler) WithAttrs(attrs []slog.Attr) slog.Handler {
	nh := h.clone()
	nh.attrs = append(nh.attrs, attrs...)
	return nh
}

// WithGroup implements slog.Handler.
func (h *Handler) WithGroup(name string) slog.Handler {
	if name == "" {
		return h
	}
	nh := h.clone()
	nh.groups = append(nh.groups, name)
	return nh
}

func (h *Handler) clone() *Handler {
	return &Handler{
		mu:     h.mu,
		w:      h.w,
		level:  h.level,
		attrs:  append([]slog.Attr(nil), h.attrs...),
		groups: append([]string(nil), h.groups...),
	}
}

func levelTag(l slog.Level) (text, color string) {
	switch {
	case l < slog.LevelInfo:
		return "DBG", Gray
	case l < slog.LevelWarn:
		return "INF", BrightGreen
	case l < slog.LevelError:
		return "WRN", BrightYellow
	default:
		return "ERR", BrightRed
	}
}

// Handle implements slog.Handler.
func (h *Handler) Handle(_ context.Context, r slog.Record) error {
	var b []byte

	// timestamp (dim)
	ts := r.Time.Format("15:04:05.000")
	b = append(b, C(Gray, ts)...)
	b = append(b, ' ')

	// level badge (bold, colored)
	tag, lc := levelTag(r.Level)
	b = append(b, C(Bold+lc, tag)...)
	b = append(b, ' ')

	// message — color reflects severity
	var msgColor string
	switch {
	case r.Level >= slog.LevelError:
		msgColor = Bold + Red
	case r.Level >= slog.LevelWarn:
		msgColor = Yellow
	case r.Level < slog.LevelInfo:
		msgColor = Gray
	default:
		msgColor = White
	}
	b = append(b, C(msgColor, r.Message)...)

	groupPrefix := strings.Join(h.groups, ".")
	for _, a := range h.attrs {
		h.appendAttr(&b, groupPrefix, a)
	}
	r.Attrs(func(a slog.Attr) bool {
		h.appendAttr(&b, groupPrefix, a)
		return true
	})
	b = append(b, '\n')

	h.mu.Lock()
	defer h.mu.Unlock()
	_, err := h.w.Write(b)
	return err
}

func (h *Handler) appendAttr(b *[]byte, groupPrefix string, a slog.Attr) {
	a.Value = a.Value.Resolve()
	if a.Equal(slog.Attr{}) {
		return
	}
	key := a.Key
	if groupPrefix != "" {
		key = groupPrefix + "." + key
	}
	if a.Value.Kind() == slog.KindGroup {
		for _, ga := range a.Value.Group() {
			h.appendAttr(b, key, ga)
		}
		return
	}

	// Accent certain keys so connection diagnostics jump out.
	keyColor, valColor := Cyan, ""
	switch strings.ToLower(a.Key) {
	case "err", "error":
		keyColor, valColor = Red, BrightRed
	case "node_id", "node":
		keyColor, valColor = Blue, BrightCyan
	case "diag", "reason", "class":
		keyColor, valColor = Magenta, BrightMag
	case "dur", "latency", "gap", "took":
		keyColor, valColor = Gray, BrightYellow
	}

	*b = append(*b, ' ')
	*b = append(*b, C(keyColor, key)...)
	*b = append(*b, C(Dim, "=")...)
	*b = append(*b, C(valColor, valStr(a.Value))...)
}

func valStr(v slog.Value) string {
	switch v.Kind() {
	case slog.KindString:
		s := v.String()
		if s == "" {
			return `""`
		}
		if strings.ContainsAny(s, " \t\"=") {
			return strconv.Quote(s)
		}
		return s
	case slog.KindDuration:
		return v.Duration().String()
	case slog.KindTime:
		return v.Time().Format(time.RFC3339)
	default:
		return v.String()
	}
}
