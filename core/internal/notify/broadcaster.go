package notify

import (
	"encoding/json"

	"github.com/honeybee-enhanced/core/internal/api/ws"
	"github.com/honeybee-enhanced/shared/models"
)

// NotifyingBroadcaster decorates a ws.Broadcaster: it forwards every broadcast
// to the real hub unchanged, then additionally hands the signal to the Telegram
// notifier asynchronously. This is the single, least-invasive hook point — the
// node server and alert handler already route every signal through Broadcast.
type NotifyingBroadcaster struct {
	inner ws.Broadcaster
	n     *Notifier
}

// NewBroadcaster wraps inner with telegram-notify side effects.
func NewBroadcaster(inner ws.Broadcaster, n *Notifier) *NotifyingBroadcaster {
	return &NotifyingBroadcaster{inner: inner, n: n}
}

// Broadcast forwards to the hub, then dispatches a notification (org-wide).
func (b *NotifyingBroadcaster) Broadcast(orgID int64, topic, eventType string, payload any) {
	b.inner.Broadcast(orgID, topic, eventType, payload)
	b.translate(orgID, eventType, payload)
}

// BroadcastToTopic only forwards — topic-scoped messages are duplicates of the
// org-wide Broadcast, so re-notifying here would double-send.
func (b *NotifyingBroadcaster) BroadcastToTopic(orgID int64, topic, eventType string, payload any) {
	b.inner.BroadcastToTopic(orgID, topic, eventType, payload)
}

func (b *NotifyingBroadcaster) translate(orgID int64, eventType string, payload any) {
	switch eventType {
	case "event_new":
		if e, ok := payload.(*models.Event); ok {
			b.n.Dispatch(Signal{OrgID: orgID, Kind: "event", Event: e})
		}
	case "alert_new":
		if a, ok := payload.(*models.Alert); ok {
			b.n.Dispatch(Signal{OrgID: orgID, Kind: "alert", Alert: a})
		}
	case "node_status":
		var d struct {
			NodeID int64  `json:"node_id"`
			Status string `json:"status"`
			Online bool   `json:"online"`
		}
		if remarshal(payload, &d) == nil {
			b.n.Dispatch(Signal{OrgID: orgID, Kind: "node_status", NodeID: d.NodeID, NodeOnline: d.Online, NodeStatus: d.Status})
		}
	case "deployment_status":
		var d struct {
			NodeID  int64  `json:"node_id"`
			PotID   string `json:"pot_id"`
			Status  string `json:"status"`
			Message string `json:"message"`
		}
		if remarshal(payload, &d) == nil {
			b.n.Dispatch(Signal{OrgID: orgID, Kind: "deployment", NodeID: d.NodeID, DeployPotID: d.PotID, DeployStatus: d.Status, DeployMsg: d.Message})
		}
	}
}

// remarshal converts an arbitrary payload (struct or map) into the target via
// a JSON round-trip — decouples us from the concrete protocol/map shapes.
func remarshal(in any, out any) error {
	raw, err := json.Marshal(in)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, out)
}
