package agent

import (
	"context"
	"log/slog"
	"os"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/honeybee-enhanced/shared/clog"
)

// Node-side diagnostic thresholds. Observational only — they change logging,
// not connection behavior.
const (
	// slowSendThreshold: a single send to core taking longer than this means
	// the core is draining the socket slowly (read-loop back-pressure) — the
	// node-side view of head-of-line blocking on the server.
	slowSendThreshold = time.Second

	// nodeReportInterval: cadence of the colored node-health panel.
	nodeReportInterval = 60 * time.Second
)

// agentDiag accumulates connection-health signals for the node agent.
type agentDiag struct {
	logger *slog.Logger
	start  time.Time

	sends        atomic.Int64
	sendFails    atomic.Int64
	slowSends    atomic.Int64
	maxSendNanos atomic.Int64
	reconnects   atomic.Int64
	events       atomic.Int64
	sessions     atomic.Int64

	connected atomic.Bool
	nodeID    atomic.Int64
}

func newAgentDiag(logger *slog.Logger) *agentDiag {
	return &agentDiag{logger: logger, start: time.Now()}
}

// recordSend tracks one send to core. msgType labels the frame; took is the
// write latency; err is the (possibly nil) send result. The error is logged
// here but NOT acted upon — callers keep their existing behavior.
func (d *agentDiag) recordSend(msgType string, took time.Duration, err error) {
	d.sends.Add(1)
	for {
		cur := d.maxSendNanos.Load()
		if int64(took) <= cur || d.maxSendNanos.CompareAndSwap(cur, int64(took)) {
			break
		}
	}
	if err != nil {
		d.sendFails.Add(1)
		d.logger.Warn("send to core failed",
			slog.String("type", msgType),
			slog.Any("err", err),
			slog.String("diag", "send_fail"),
		)
		return
	}
	if took >= slowSendThreshold {
		d.slowSends.Add(1)
		d.logger.Warn("slow send to core — possible server back-pressure",
			slog.String("type", msgType),
			slog.Duration("took", took),
			slog.String("diag", "back_pressure"),
		)
	}
}

func (d *agentDiag) setConnected(ok bool, nodeID int64) {
	d.connected.Store(ok)
	if ok {
		d.nodeID.Store(nodeID)
	}
}

func (d *agentDiag) onReconnect() { d.reconnects.Add(1) }
func (d *agentDiag) onEvent()     { d.events.Add(1) }
func (d *agentDiag) onSession()   { d.sessions.Add(1) }

// reportLoop prints the colored node-health panel until ctx is done.
func (d *agentDiag) reportLoop(ctx context.Context) {
	t := time.NewTicker(nodeReportInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			d.printPanel()
		}
	}
}

func (d *agentDiag) printPanel() {
	uptime := time.Since(d.start).Round(time.Second)
	maxSend := time.Duration(d.maxSendNanos.Load()).Round(time.Millisecond)

	connStr, connColor := "no", clog.BrightRed
	if d.connected.Load() {
		connStr, connColor = "yes", clog.BrightGreen
	}
	okYellow := func(n int64) string {
		if n > 0 {
			return clog.BrightYellow
		}
		return clog.BrightGreen
	}
	okRed := func(n int64) string {
		if n > 0 {
			return clog.BrightRed
		}
		return clog.BrightGreen
	}
	maxColor := clog.BrightGreen
	if maxSend >= slowSendThreshold {
		maxColor = clog.BrightYellow
	}

	rows := []clog.Row{
		clog.R("uptime", uptime.String(), clog.White),
		clog.R("connected", connStr, connColor),
		clog.R("node id", itoa(d.nodeID.Load()), clog.BrightCyan),
		clog.R("reconnects", itoa(d.reconnects.Load()), okYellow(d.reconnects.Load())),
		clog.R("sends to core", itoa(d.sends.Load()), clog.White),
		clog.R("send failures", itoa(d.sendFails.Load()), okRed(d.sendFails.Load())),
		clog.R("slow sends (>1s)", itoa(d.slowSends.Load()), okYellow(d.slowSends.Load())),
		clog.R("max send latency", maxSend.String(), maxColor),
		clog.R("events forwarded", itoa(d.events.Load()), clog.White),
		clog.R("sessions started", itoa(d.sessions.Load()), clog.White),
	}
	os.Stdout.WriteString("\n" + clog.Panel(clog.BrightYellow, "NODE · connection health", rows))
}

func itoa(n int64) string {
	return strconv.FormatInt(n, 10)
}
