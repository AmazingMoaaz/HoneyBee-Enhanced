package nodeserver

import (
	"context"
	"log/slog"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/honeybee-enhanced/shared/clog"
)

// Connection-diagnostic thresholds. These only affect *logging*, never the
// actual connection behavior — they exist so an operator can tell which failure
// mode they are hitting (head-of-line blocking vs ghost connections vs storms).
const (
	// slowDispatchThreshold: a single inbound message that takes longer than
	// this to persist+broadcast is flagged. Sustained slow dispatch is the
	// signature of read-loop head-of-line blocking under event floods.
	slowDispatchThreshold = 250 * time.Millisecond

	// reconnectStormWindow: if a node reconnects within this window of its last
	// disconnect, it's counted as a "storm" (flapping) reconnect.
	reconnectStormWindow = 30 * time.Second

	// heartbeatGapThreshold: heartbeats are sent every ~20s; a gap longer than
	// this means beats are arriving late (slow read loop) or were dropped.
	heartbeatGapThreshold = 45 * time.Second

	// reportInterval: how often the colored connection-health panel is printed.
	reportInterval = 60 * time.Second
)

type nodeConn struct {
	connects       int64
	lastConnect    time.Time
	lastDisconnect time.Time
	lastHeartbeat  time.Time
}

// Diag accumulates connection-health signals for the node TCP server and
// periodically renders a colored panel. All counters are observational.
type Diag struct {
	logger *slog.Logger
	start  time.Time

	mu    sync.Mutex
	nodes map[int64]*nodeConn

	msgsTotal        atomic.Int64
	slowDispatches   atomic.Int64
	maxDispatchNanos atomic.Int64
	heartbeats       atomic.Int64
	heartbeatGaps    atomic.Int64
	ghostDisconnects atomic.Int64
	cleanDisconnects atomic.Int64
	errDisconnects   atomic.Int64
	reconnectStorms  atomic.Int64
	totalConnects    atomic.Int64
}

func newDiag(logger *slog.Logger) *Diag {
	return &Diag{
		logger: logger,
		start:  time.Now(),
		nodes:  make(map[int64]*nodeConn),
	}
}

// onConnect records a (re)connection and returns the gap since the node last
// disconnected plus whether that gap qualifies as a reconnect storm.
func (d *Diag) onConnect(nodeID int64) (connects int64, gap time.Duration, storm bool) {
	d.totalConnects.Add(1)
	d.mu.Lock()
	defer d.mu.Unlock()
	nc := d.nodes[nodeID]
	if nc == nil {
		nc = &nodeConn{}
		d.nodes[nodeID] = nc
	}
	nc.connects++
	now := time.Now()
	if !nc.lastDisconnect.IsZero() {
		gap = now.Sub(nc.lastDisconnect)
		if gap < reconnectStormWindow {
			storm = true
			d.reconnectStorms.Add(1)
		}
	}
	nc.lastConnect = now
	nc.lastHeartbeat = now // grace: don't flag a gap immediately after connect
	return nc.connects, gap, storm
}

// disconnectClass categorizes why a session's read loop ended.
type disconnectClass string

const (
	discClean disconnectClass = "clean" // EOF / closed socket — normal
	discGhost disconnectClass = "ghost" // read deadline expired — no heartbeats
	discErr   disconnectClass = "error" // some other read error
)

func (d *Diag) onDisconnect(nodeID int64, class disconnectClass) {
	switch class {
	case discGhost:
		d.ghostDisconnects.Add(1)
	case discErr:
		d.errDisconnects.Add(1)
	default:
		d.cleanDisconnects.Add(1)
	}
	d.mu.Lock()
	if nc := d.nodes[nodeID]; nc != nil {
		nc.lastDisconnect = time.Now()
	}
	d.mu.Unlock()
}

// onHeartbeat records a heartbeat arrival and returns the gap since the prior
// one (zero on the first beat of a connection).
func (d *Diag) onHeartbeat(nodeID int64) time.Duration {
	d.heartbeats.Add(1)
	d.mu.Lock()
	defer d.mu.Unlock()
	nc := d.nodes[nodeID]
	if nc == nil {
		return 0
	}
	var gap time.Duration
	if !nc.lastHeartbeat.IsZero() {
		gap = time.Since(nc.lastHeartbeat)
	}
	nc.lastHeartbeat = time.Now()
	if gap > heartbeatGapThreshold {
		d.heartbeatGaps.Add(1)
	}
	return gap
}

// recordDispatch tracks how long one inbound message took to handle.
func (d *Diag) recordDispatch(msgType string, took time.Duration) {
	d.msgsTotal.Add(1)
	for {
		cur := d.maxDispatchNanos.Load()
		if int64(took) <= cur || d.maxDispatchNanos.CompareAndSwap(cur, int64(took)) {
			break
		}
	}
	if took >= slowDispatchThreshold {
		d.slowDispatches.Add(1)
		d.logger.Warn("slow dispatch — possible read-loop back-pressure",
			slog.String("type", msgType),
			slog.Duration("took", took),
			slog.String("diag", "hol_blocking"),
		)
	}
}

// reportLoop prints the colored connection-health panel until ctx is done.
func (d *Diag) reportLoop(ctx context.Context, liveCount func() int) {
	t := time.NewTicker(reportInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			d.printPanel(liveCount())
		}
	}
}

func (d *Diag) printPanel(online int) {
	uptime := time.Since(d.start).Round(time.Second)
	maxDisp := time.Duration(d.maxDispatchNanos.Load()).Round(time.Millisecond)

	okRed := func(n int64) string {
		if n > 0 {
			return clog.BrightRed
		}
		return clog.BrightGreen
	}
	okYellow := func(n int64) string {
		if n > 0 {
			return clog.BrightYellow
		}
		return clog.BrightGreen
	}
	maxColor := clog.BrightGreen
	if maxDisp >= slowDispatchThreshold {
		maxColor = clog.BrightYellow
	}

	rows := []clog.Row{
		clog.R("uptime", uptime.String(), clog.White),
		clog.R("nodes online", itoa(int64(online)), clog.BrightCyan),
		clog.R("total connects", itoa(d.totalConnects.Load()), clog.White),
		clog.R("messages handled", itoa(d.msgsTotal.Load()), clog.White),
		clog.R("heartbeats", itoa(d.heartbeats.Load()), clog.White),
		clog.R("heartbeat gaps (>45s)", itoa(d.heartbeatGaps.Load()), okYellow(d.heartbeatGaps.Load())),
		clog.R("slow dispatch (>250ms)", itoa(d.slowDispatches.Load()), okYellow(d.slowDispatches.Load())),
		clog.R("max dispatch", maxDisp.String(), maxColor),
		clog.R("ghost disconnects", itoa(d.ghostDisconnects.Load()), okRed(d.ghostDisconnects.Load())),
		clog.R("error disconnects", itoa(d.errDisconnects.Load()), okYellow(d.errDisconnects.Load())),
		clog.R("clean disconnects", itoa(d.cleanDisconnects.Load()), clog.Gray),
		clog.R("reconnect storms", itoa(d.reconnectStorms.Load()), okRed(d.reconnectStorms.Load())),
	}
	os.Stdout.WriteString("\n" + clog.Panel(clog.BrightCyan, "CORE · connection health", rows))
}
