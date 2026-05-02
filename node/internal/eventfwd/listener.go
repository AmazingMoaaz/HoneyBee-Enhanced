// Package eventfwd accepts newline-delimited JSON events from local honeypots
// and forwards them upstream to the agent.
package eventfwd

import (
	"bufio"
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"time"
)

// Sink receives parsed events and pot logs from the listener.
type Sink interface {
	OnPotEvent(potID string, eventType, sourceIP string, raw map[string]any)
	OnPotLog(potID, logType, level, message string, raw map[string]any)
}

// Listener accepts TCP connections and parses one JSON object per line.
type Listener struct {
	addr   string
	logger *slog.Logger
	sink   Sink
	ln     net.Listener
}

// New constructs a Listener.
func New(addr string, logger *slog.Logger, sink Sink) *Listener {
	return &Listener{addr: addr, logger: logger, sink: sink}
}

// Start binds the listener and begins accepting.
func (l *Listener) Start(ctx context.Context) error {
	ln, err := net.Listen("tcp", l.addr)
	if err != nil {
		return err
	}
	l.ln = ln
	l.logger.Info("eventfwd listening", slog.String("addr", l.addr))
	go func() { <-ctx.Done(); _ = ln.Close() }()
	for {
		conn, err := ln.Accept()
		if err != nil {
			select {
			case <-ctx.Done():
				return nil
			default:
				return err
			}
		}
		go l.handle(ctx, conn)
	}
}

func (l *Listener) handle(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	r := bufio.NewReader(conn)
	for {
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Minute))
		line, err := r.ReadBytes('\n')
		if err != nil {
			return
		}
		var raw map[string]any
		if json.Unmarshal(line, &raw) != nil {
			continue
		}
		potID, _ := raw["pot_id"].(string)
		if potID == "" {
			continue
		}

		// Pot logs are explicitly tagged with log_type and are routed to the
		// pot_logs table (used for install/start/process.output progress).
		if logType, ok := raw["log_type"].(string); ok && logType != "" {
			level, _ := raw["level"].(string)
			msg, _ := raw["message"].(string)
			l.sink.OnPotLog(potID, logType, level, msg, raw)
			continue
		}

		// Otherwise it's an attacker-interaction event. Accept the canonical
		// schema (event_type, source_ip) AND the community schema used by
		// cowrie / HonnyPotter / WebTrap (eventid, src_ip).
		eventType, _ := raw["event_type"].(string)
		if eventType == "" {
			eventType, _ = raw["eventid"].(string)
		}
		srcIP, _ := raw["source_ip"].(string)
		if srcIP == "" {
			srcIP, _ = raw["src_ip"].(string)
		}
		l.sink.OnPotEvent(potID, eventType, srcIP, raw)
	}
}
