package nodeserver

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/honeybee-enhanced/core/internal/api/ws"
	"github.com/honeybee-enhanced/core/internal/store"
	"github.com/honeybee-enhanced/shared/models"
	"github.com/honeybee-enhanced/shared/protocol"
)

// Dispatcher routes incoming node messages to the store + WS hub.
type Dispatcher struct {
	store       *store.Store
	server      *Server
	broadcaster ws.Broadcaster
	logger      *slog.Logger
}

// NewDispatcher constructs a dispatcher.
func NewDispatcher(st *store.Store, srv *Server, logger *slog.Logger) *Dispatcher {
	return &Dispatcher{store: st, server: srv, logger: logger}
}

// Dispatch routes a single envelope.
func (d *Dispatcher) Dispatch(ctx context.Context, sess *Session, env *protocol.Envelope) {
	switch env.Type {
	case protocol.MsgHeartbeat:
		d.handleHeartbeat(ctx, sess, env)
	case protocol.MsgTaskResult:
		d.handleTaskResult(ctx, sess, env)
	case protocol.MsgPotStatus:
		d.handlePotStatus(ctx, sess, env)
	case protocol.MsgPotEvent:
		d.handlePotEvent(ctx, sess, env)
	case protocol.MsgPotLog:
		d.handlePotLog(ctx, sess, env)
	case protocol.MsgPotInstalledList:
		d.handlePotInstalledList(ctx, sess, env)
	case protocol.MsgPotInfoResult:
		d.handlePotInfoResult(ctx, sess, env)
	case protocol.MsgPotMetricsResult:
		d.handlePotMetricsResult(ctx, sess, env)
	case protocol.MsgSessionStart:
		d.handleSessionStart(ctx, sess, env)
	case protocol.MsgSessionData:
		d.handleSessionData(ctx, sess, env)
	case protocol.MsgSessionEnd:
		d.handleSessionEnd(ctx, sess, env)
	default:
		d.logger.Warn("unknown msg type", slog.String("type", env.Type), slog.Int64("node_id", sess.nodeID))
	}
}

// FlushPending sends every pending task for nodeID over sess.
func (d *Dispatcher) FlushPending(ctx context.Context, nodeID int64, sess *Session) {
	tasks, err := d.store.PendingTasksForNode(ctx, nodeID)
	if err != nil {
		d.logger.Warn("flush pending: list", slog.Any("err", err))
		return
	}
	for _, t := range tasks {
		ta := protocol.TaskAssign{TaskID: t.ID, Command: t.Command, Payload: json.RawMessage(t.Payload)}
		if err := sess.Send(protocol.MsgTaskAssign, ta); err != nil {
			d.logger.Warn("flush pending: send", slog.Any("err", err))
			return
		}
		_ = d.store.MarkTaskSent(ctx, t.ID)
	}
}

// ----- handlers -----

func (d *Dispatcher) handleHeartbeat(ctx context.Context, sess *Session, env *protocol.Envelope) {
	var hb protocol.Heartbeat
	if err := protocol.DecodePayload(env, &hb); err != nil {
		return
	}
	_ = d.store.UpdateNodeHeartbeat(ctx, sess.nodeID)
	// Persist the performance snapshot for historical charts.
	_ = d.store.InsertNodeMetric(ctx, sess.nodeID, hb.CPUPct, hb.MemPct, hb.DiskPct, hb.UptimeSecs)
	if d.broadcaster != nil {
		d.broadcaster.Broadcast(sess.orgID, "node."+itoa(sess.nodeID), "heartbeat", hb)
	}
}

func (d *Dispatcher) handleTaskResult(ctx context.Context, sess *Session, env *protocol.Envelope) {
	var tr protocol.TaskResult
	if err := protocol.DecodePayload(env, &tr); err != nil {
		return
	}
	_ = d.store.UpdateTaskResult(ctx, tr.TaskID, tr.Status, tr.Message)
	// If the task failed, propagate the failure to the associated deployment.
	if tr.Status == protocol.TaskStatusFailed {
		task, err := d.store.GetTask(ctx, sess.orgID, tr.TaskID)
		if err == nil && task.DeployID != nil {
			_ = d.store.UpdateDeploymentStatusByID(ctx, *task.DeployID, "failed", tr.Message)
		}
	}
	if d.broadcaster != nil {
		d.broadcaster.Broadcast(sess.orgID, "tasks", "task_result", tr)
	}
}

func (d *Dispatcher) handlePotStatus(ctx context.Context, sess *Session, env *protocol.Envelope) {
	var ps protocol.PotStatus
	if err := protocol.DecodePayload(env, &ps); err != nil {
		return
	}
	// When the node confirms removal, hard-delete the deployment row so it disappears from the UI.
	if ps.Status == "removed" {
		if err := d.store.DeleteDeploymentByNodePot(ctx, sess.nodeID, ps.PotID); err != nil {
			d.logger.Warn("delete removed deployment", slog.Any("err", err))
		}
	} else if err := d.store.UpdateDeploymentStatus(ctx, sess.nodeID, ps.PotID, ps.Status, ps.Message); err != nil {
		d.logger.Warn("update deployment status", slog.Any("err", err))
	}
	if d.broadcaster != nil {
		d.broadcaster.Broadcast(sess.orgID, "deployments", "deployment_status", ps)
	}
}

func (d *Dispatcher) handlePotEvent(ctx context.Context, sess *Session, env *protocol.Envelope) {
	var pe protocol.PotEvent
	if err := protocol.DecodePayload(env, &pe); err != nil {
		return
	}
	if pe.EventTime.IsZero() {
		pe.EventTime = time.Now().UTC()
	}
	dataStr := string(pe.Data)
	if dataStr == "" {
		dataStr = "{}"
	}
	dep, _ := d.store.GetDeploymentByPotID(ctx, sess.nodeID, pe.PotID)
	var depID *int64
	if dep != nil {
		depID = &dep.ID
	}
	ev := &models.Event{
		OrgID:        sess.orgID,
		NodeID:       sess.nodeID,
		DeployID:     depID,
		PotID:        pe.PotID,
		HoneypotType: pe.PotType,
		EventType:    pe.EventType,
		SourceIP:     pe.SourceIP,
		SourcePort:   pe.SourcePort,
		DestPort:     pe.DestPort,
		Data:         dataStr,
		EventTime:    pe.EventTime,
	}
	if _, err := d.store.InsertEvent(ctx, ev); err != nil {
		d.logger.Warn("insert event", slog.Any("err", err))
		return
	}
	if d.broadcaster != nil {
		d.broadcaster.Broadcast(sess.orgID, "pot_events", "event_new", ev)
		d.broadcaster.BroadcastToTopic(sess.orgID, "pot_events."+pe.PotID, "event_new", ev)
	}
}

func (d *Dispatcher) handlePotLog(ctx context.Context, sess *Session, env *protocol.Envelope) {
	var pl protocol.PotLog
	if err := protocol.DecodePayload(env, &pl); err != nil {
		return
	}
	dataBytes, _ := json.Marshal(pl.Data)
	entry := &models.PotLogEntry{
		OrgID:    sess.orgID,
		NodeID:   sess.nodeID,
		PotID:    pl.PotID,
		PotType:  pl.PotType,
		LogType:  pl.LogType,
		Data:     string(dataBytes),
		LoggedAt: pl.Timestamp,
	}
	if entry.LoggedAt.IsZero() {
		entry.LoggedAt = time.Now().UTC()
	}
	// Attach the deployment_id so logs are scoped per-deployment (not all-time per pot).
	if dep, err := d.store.GetDeploymentByPotID(ctx, sess.nodeID, pl.PotID); err == nil {
		entry.DeploymentID = &dep.ID
	}
	if _, err := d.store.InsertPotLog(ctx, entry); err != nil {
		d.logger.Warn("insert pot_log", slog.Any("err", err))
		return
	}
	if d.broadcaster != nil {
		d.broadcaster.Broadcast(sess.orgID, "pot_logs", "pot_log", entry)
	}
}

func (d *Dispatcher) handlePotInstalledList(_ context.Context, sess *Session, env *protocol.Envelope) {
	var lst protocol.PotInstalledList
	if err := protocol.DecodePayload(env, &lst); err != nil {
		return
	}
	if d.broadcaster != nil {
		d.broadcaster.Broadcast(sess.orgID, "tasks", "pot_installed_list", lst)
	}
}

func (d *Dispatcher) handlePotInfoResult(_ context.Context, sess *Session, env *protocol.Envelope) {
	var r protocol.PotInfoResult
	if err := protocol.DecodePayload(env, &r); err != nil {
		return
	}
	if d.broadcaster != nil {
		d.broadcaster.Broadcast(sess.orgID, "tasks", "pot_info_result", r)
	}
}

func (d *Dispatcher) handlePotMetricsResult(_ context.Context, sess *Session, env *protocol.Envelope) {
	var r protocol.PotMetricsResult
	if err := protocol.DecodePayload(env, &r); err != nil {
		return
	}
	if d.broadcaster != nil {
		d.broadcaster.Broadcast(sess.orgID, "tasks", "pot_metrics_result", r)
	}
}

func (d *Dispatcher) handleSessionStart(ctx context.Context, sess *Session, env *protocol.Envelope) {
	var ss protocol.SessionStart
	if err := protocol.DecodePayload(env, &ss); err != nil {
		return
	}
	if ss.StartedAt.IsZero() {
		ss.StartedAt = time.Now().UTC()
	}
	dep, _ := d.store.GetDeploymentByPotID(ctx, sess.nodeID, ss.PotID)
	var depID *int64
	if dep != nil {
		depID = &dep.ID
	}
	row := &models.Session{
		OrgID:     sess.orgID,
		NodeID:    sess.nodeID,
		DeployID:  depID,
		PotID:     ss.PotID,
		SessionID: ss.SessionID,
		SrcIP:     ss.SrcIP,
		SrcPort:   ss.SrcPort,
		DstPort:   ss.DstPort,
		StartedAt: ss.StartedAt,
	}
	if _, err := d.store.CreateSession(ctx, row); err != nil {
		d.logger.Warn("create session", slog.Any("err", err))
		return
	}
	if d.broadcaster != nil {
		d.broadcaster.Broadcast(sess.orgID, "sessions", "session_start", row)
	}
}

func (d *Dispatcher) handleSessionData(ctx context.Context, sess *Session, env *protocol.Envelope) {
	var sd protocol.SessionData
	if err := protocol.DecodePayload(env, &sd); err != nil {
		return
	}
	row, err := d.store.GetSessionBySID(ctx, sd.SessionID)
	if err != nil {
		return
	}
	raw, err := base64.StdEncoding.DecodeString(sd.DataB64)
	if err != nil {
		raw = []byte(sd.DataB64)
	}
	_ = d.store.AppendSessionData(ctx, row.ID, sd.Sequence, raw)
	if d.broadcaster != nil {
		d.broadcaster.BroadcastToTopic(sess.orgID, "sessions."+sd.SessionID, "session_data", sd)
	}
}

func (d *Dispatcher) handleSessionEnd(ctx context.Context, sess *Session, env *protocol.Envelope) {
	var se protocol.SessionEnd
	if err := protocol.DecodePayload(env, &se); err != nil {
		return
	}
	_ = d.store.FinalizeSession(ctx, se.SessionID, se.DurationSecs)
	if d.broadcaster != nil {
		d.broadcaster.Broadcast(sess.orgID, "sessions", "session_end", se)
	}
}

func itoa(n int64) string { return fmt.Sprintf("%d", n) }
