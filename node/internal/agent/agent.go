// Package agent connects to the core, authenticates, and dispatches tasks.
package agent

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/honeybee-enhanced/node/internal/config"
	"github.com/honeybee-enhanced/node/internal/honeypot"
	"github.com/honeybee-enhanced/shared/protocol"
	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/mem"
)

// Agent is the long-running node-agent.
type Agent struct {
	cfg    *config.Config
	logger *slog.Logger
	hp     *honeypot.Manager

	mu     sync.Mutex
	conn   net.Conn
	nodeID int64
	connOK bool
}

// New constructs an Agent.
func New(cfg *config.Config, logger *slog.Logger, hp *honeypot.Manager) *Agent {
	return &Agent{cfg: cfg, logger: logger, hp: hp}
}

// Run loops: dial → auth → serve until disconnect, with exponential backoff.
func (a *Agent) Run(ctx context.Context) error {
	backoff := time.Second
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		err := a.connect(ctx)
		if err != nil {
			a.logger.Warn("connect failed", slog.Any("err", err), slog.Duration("retry", backoff))
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoff):
			}
			backoff *= 2
			if backoff > 5*time.Minute {
				backoff = 5 * time.Minute
			}
			continue
		}
		backoff = time.Second
	}
}

func (a *Agent) connect(ctx context.Context) error {
	d := net.Dialer{Timeout: 15 * time.Second}
	var conn net.Conn
	var err error
	if a.cfg.Server.TLS {
		conn, err = tls.DialWithDialer(&d, "tcp", a.cfg.Server.Address,
			&tls.Config{InsecureSkipVerify: a.cfg.Server.InsecureSkipVerify, MinVersion: tls.VersionTLS12})
	} else {
		conn, err = d.DialContext(ctx, "tcp", a.cfg.Server.Address)
	}
	if err != nil {
		return err
	}

	hostname, _ := os.Hostname()
	if err := protocol.SendMessage(conn, protocol.MsgNodeAuth, protocol.NodeAuth{
		Token:    a.cfg.Server.Token,
		Hostname: hostname,
		OS:       runtime.GOOS,
		Arch:     runtime.GOARCH,
	}); err != nil {
		_ = conn.Close()
		return fmt.Errorf("send auth: %w", err)
	}
	env, err := protocol.ReadMessage(conn)
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("read auth result: %w", err)
	}
	if env.Type != protocol.MsgAuthResult {
		_ = conn.Close()
		return fmt.Errorf("unexpected first frame: %s", env.Type)
	}
	var ar protocol.AuthResult
	if err := protocol.DecodePayload(env, &ar); err != nil {
		_ = conn.Close()
		return err
	}
	if !ar.Success {
		_ = conn.Close()
		return fmt.Errorf("auth rejected: %s", ar.Message)
	}

	a.mu.Lock()
	a.conn = conn
	a.nodeID = ar.NodeID
	a.connOK = true
	a.mu.Unlock()
	a.logger.Info("connected", slog.Int64("node_id", ar.NodeID))

	hbCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	go a.heartbeatLoop(hbCtx)
	go a.reportInstalledLoop(hbCtx)

	defer func() {
		a.mu.Lock()
		a.connOK = false
		a.conn = nil
		a.mu.Unlock()
		_ = conn.Close()
	}()

	for {
		env, err := protocol.ReadMessage(conn)
		if err != nil {
			a.logger.Warn("read loop ended", slog.Any("err", err))
			return err
		}
		go a.dispatch(ctx, env)
	}
}

func (a *Agent) send(msgType string, payload any) error {
	a.mu.Lock()
	conn := a.conn
	ok := a.connOK
	a.mu.Unlock()
	if !ok || conn == nil {
		return errors.New("not connected")
	}
	return protocol.SendMessage(conn, msgType, payload)
}

func (a *Agent) heartbeatLoop(ctx context.Context) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	a.sendHeartbeat()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			a.sendHeartbeat()
		}
	}
}

func (a *Agent) sendHeartbeat() {
	cpuPct, _ := cpu.Percent(0, false)
	v, _ := mem.VirtualMemory()
	du, _ := disk.Usage("/")
	if du == nil {
		du, _ = disk.Usage(".")
	}
	upt, _ := host.Uptime()
	hb := protocol.Heartbeat{
		NodeID:     a.nodeID,
		UptimeSecs: int64(upt),
	}
	if len(cpuPct) > 0 {
		hb.CPUPct = cpuPct[0]
	}
	if v != nil {
		hb.MemPct = v.UsedPercent
	}
	if du != nil {
		hb.DiskPct = du.UsedPercent
	}
	_ = a.send(protocol.MsgHeartbeat, hb)
}

func (a *Agent) reportInstalledLoop(ctx context.Context) {
	t := time.NewTicker(5 * time.Minute)
	defer t.Stop()
	a.sendInstalledList(0)
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			a.sendInstalledList(0)
		}
	}
}

func (a *Agent) sendInstalledList(taskID int64) {
	mfs := a.hp.ListInstalled()
	pots := make([]protocol.PotInfo, 0, len(mfs))
	for _, m := range mfs {
		status := protocol.PotStatusStopped
		if a.hp.IsRunning(m.PotID) {
			status = protocol.PotStatusRunning
		}
		pots = append(pots, protocol.PotInfo{
			PotID:     m.PotID,
			PotType:   m.HoneypotType,
			Status:    status,
			Directory: m.InstallDir,
			Config:    m.Config,
		})
	}
	_ = a.send(protocol.MsgPotInstalledList, protocol.PotInstalledList{
		TaskID: taskID,
		NodeID: a.nodeID,
		Pots:   pots,
	})
}

func (a *Agent) dispatch(ctx context.Context, env *protocol.Envelope) {
	if env.Type != protocol.MsgTaskAssign {
		a.logger.Warn("unexpected msg type", slog.String("type", env.Type))
		return
	}
	var ta protocol.TaskAssign
	if err := protocol.DecodePayload(env, &ta); err != nil {
		return
	}
	a.handleTask(ctx, ta)
}

func (a *Agent) handleTask(ctx context.Context, ta protocol.TaskAssign) {
	status := protocol.TaskStatusCompleted
	msg := ""
	switch ta.Command {
	case protocol.CmdInstallPot:
		var p protocol.InstallPotPayload
		_ = json.Unmarshal(ta.Payload, &p)
		_, err := a.hp.Install(ctx, p.PotID, p.HoneypotType, p.GitURL, p.GitBranch, p.Config)
		if err != nil {
			status, msg = protocol.TaskStatusFailed, err.Error()
		} else {
			a.sendPotStatus(p.PotID, p.HoneypotType, protocol.PotStatusStopped, "installed")
			if p.AutoStart {
				if err := a.hp.Start(ctx, p.PotID); err != nil {
					a.sendPotStatus(p.PotID, p.HoneypotType, protocol.PotStatusFailed, err.Error())
				} else {
					a.sendPotStatus(p.PotID, p.HoneypotType, protocol.PotStatusRunning, "started")
				}
			}
		}
	case protocol.CmdStartPot:
		var p protocol.PotControlPayload
		_ = json.Unmarshal(ta.Payload, &p)
		if err := a.hp.Start(ctx, p.PotID); err != nil {
			status, msg = protocol.TaskStatusFailed, err.Error()
		} else {
			a.sendPotStatus(p.PotID, "", protocol.PotStatusRunning, "started")
		}
	case protocol.CmdStopPot:
		var p protocol.PotControlPayload
		_ = json.Unmarshal(ta.Payload, &p)
		if err := a.hp.Stop(p.PotID); err != nil {
			status, msg = protocol.TaskStatusFailed, err.Error()
		} else {
			a.sendPotStatus(p.PotID, "", protocol.PotStatusStopped, "stopped")
		}
	case protocol.CmdRestartPot:
		var p protocol.PotControlPayload
		_ = json.Unmarshal(ta.Payload, &p)
		if err := a.hp.Restart(ctx, p.PotID); err != nil {
			status, msg = protocol.TaskStatusFailed, err.Error()
		} else {
			a.sendPotStatus(p.PotID, "", protocol.PotStatusRunning, "restarted")
		}
	case protocol.CmdRemovePot:
		var p protocol.PotControlPayload
		_ = json.Unmarshal(ta.Payload, &p)
		if err := a.hp.Remove(p.PotID); err != nil {
			status, msg = protocol.TaskStatusFailed, err.Error()
		} else {
			a.sendPotStatus(p.PotID, "", protocol.PotStatusRemoved, "removed")
		}
	case protocol.CmdUpdateConfig:
		// In this minimal node, we accept config changes but rely on restart to apply.
		// (Manifest update could be added; left intentionally simple.)
		status = protocol.TaskStatusCompleted
	case protocol.CmdGetInstalledPots:
		a.sendInstalledList(ta.TaskID)
	case protocol.CmdGetPotInfo:
		var p protocol.PotControlPayload
		_ = json.Unmarshal(ta.Payload, &p)
		info, err := a.hp.Info(p.PotID)
		if err != nil {
			status, msg = protocol.TaskStatusFailed, err.Error()
			break
		}
		potType, _ := info["manifest"].(*honeypot.Manifest)
		var pi protocol.PotInfo
		if potType != nil {
			pi = protocol.PotInfo{
				PotID: potType.PotID, PotType: potType.HoneypotType,
				Directory: potType.InstallDir, Config: potType.Config,
				Status: protocol.PotStatusStopped,
			}
			if a.hp.IsRunning(potType.PotID) {
				pi.Status = protocol.PotStatusRunning
			}
		}
		_ = a.send(protocol.MsgPotInfoResult, protocol.PotInfoResult{
			TaskID: ta.TaskID, NodeID: a.nodeID, PotID: p.PotID, Info: pi,
		})
	case protocol.CmdGetPotMetrics:
		var p protocol.PotControlPayload
		_ = json.Unmarshal(ta.Payload, &p)
		met, err := a.hp.Metrics(p.PotID)
		if err != nil {
			status, msg = protocol.TaskStatusFailed, err.Error()
			break
		}
		cpuPct, _ := met["cpu_percent"].(float64)
		var memMB float64
		if rss, ok := met["mem_rss_bytes"].(uint64); ok {
			memMB = float64(rss) / (1024 * 1024)
		}
		_ = a.send(protocol.MsgPotMetricsResult, protocol.PotMetricsResult{
			TaskID: ta.TaskID, NodeID: a.nodeID, PotID: p.PotID,
			CPUPct: cpuPct, MemMB: memMB,
		})
	case protocol.CmdRestartNode:
		_ = a.send(protocol.MsgTaskResult, protocol.TaskResult{
			TaskID: ta.TaskID, NodeID: a.nodeID, Status: protocol.TaskStatusCompleted,
		})
		go func() { time.Sleep(time.Second); os.Exit(0) }()
		return
	default:
		status, msg = protocol.TaskStatusFailed, "unknown command"
	}
	_ = a.send(protocol.MsgTaskResult, protocol.TaskResult{
		TaskID: ta.TaskID, NodeID: a.nodeID, Status: status, Message: msg,
	})
}

func (a *Agent) sendPotStatus(potID, potType, status, msg string) {
	_ = a.send(protocol.MsgPotStatus, protocol.PotStatus{
		NodeID: a.nodeID, PotID: potID, PotType: potType, Status: status, Message: msg,
	})
}

// ----- session.Sender impl -----

// SendSessionStart implements session.Sender.
func (a *Agent) SendSessionStart(potID, sessionID, srcIP string, srcPort int) {
	_ = a.send(protocol.MsgSessionStart, protocol.SessionStart{
		NodeID: a.nodeID, SessionID: sessionID, PotID: potID,
		SrcIP: srcIP, SrcPort: srcPort, StartedAt: time.Now().UTC(),
	})
}

// SendSessionData implements session.Sender.
func (a *Agent) SendSessionData(sessionID string, seq int64, chunk []byte) {
	_ = a.send(protocol.MsgSessionData, protocol.SessionData{
		SessionID: sessionID, Sequence: seq,
		DataB64: base64.StdEncoding.EncodeToString(chunk),
	})
}

// SendSessionEnd implements session.Sender.
func (a *Agent) SendSessionEnd(sessionID string, durationSec float64) {
	_ = a.send(protocol.MsgSessionEnd, protocol.SessionEnd{
		SessionID: sessionID, DurationSecs: int64(durationSec),
	})
}

// ----- eventfwd.Sink impl -----

// OnPotEvent implements eventfwd.Sink.
func (a *Agent) OnPotEvent(potID, eventType, sourceIP string, raw map[string]any) {
	dataBytes, _ := json.Marshal(raw)
	potType, _ := raw["pot_type"].(string)
	srcPort, _ := raw["src_port"].(float64)
	dstPort, _ := raw["dst_port"].(float64)
	_ = a.send(protocol.MsgPotEvent, protocol.PotEvent{
		NodeID: a.nodeID, PotID: potID, PotType: potType,
		EventType: eventType, SourceIP: sourceIP,
		SourcePort: int(srcPort), DestPort: int(dstPort),
		Data: dataBytes, EventTime: time.Now().UTC(),
	})
}

// OnPotLog implements eventfwd.Sink.
func (a *Agent) OnPotLog(potID, logType, level, message string, raw map[string]any) {
	potType, _ := raw["pot_type"].(string)
	_ = a.send(protocol.MsgPotLog, protocol.PotLog{
		NodeID: a.nodeID, PotID: potID, PotType: potType,
		LogType: logType, Data: raw, Timestamp: time.Now().UTC(),
	})
	_ = level
	_ = message
}
