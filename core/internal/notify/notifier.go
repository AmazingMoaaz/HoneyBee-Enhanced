// Package notify dispatches system signals to outbound Telegram bots, filtered
// per-bot by subscription config. All dispatch is fire-and-forget so it never
// blocks the event/ingest hot path.
package notify

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/honeybee-enhanced/core/internal/store"
	"github.com/honeybee-enhanced/core/internal/telegram"
	"github.com/honeybee-enhanced/shared/models"
)

// Signal is a normalized internal notification trigger.
type Signal struct {
	OrgID int64
	Kind  string // event | alert | node_status | deployment | audit

	Event *models.Event
	Alert *models.Alert

	NodeID     int64
	NodeOnline bool
	NodeStatus string

	DeployPotID  string
	DeployStatus string
	DeployMsg    string

	AuditAction string
}

const botCacheTTL = 8 * time.Second

type botCacheEntry struct {
	bots []models.TelegramBot
	exp  time.Time
}

// Notifier holds the dependencies + in-memory throttle/cache state.
type Notifier struct {
	store *store.Store
	tg    *telegram.Client
	log   *slog.Logger

	mu   sync.Mutex
	last map[int64]map[string]time.Time // botID -> signal kind -> last send time

	cmu   sync.Mutex
	cache map[int64]botCacheEntry // orgID -> cached enabled bots (short TTL)
}

// New constructs a notifier.
func New(st *store.Store, tg *telegram.Client, log *slog.Logger) *Notifier {
	if log == nil {
		log = slog.Default()
	}
	return &Notifier{
		store: st, tg: tg,
		log:   log.With(slog.String("component", "notify")),
		last:  make(map[int64]map[string]time.Time),
		cache: make(map[int64]botCacheEntry),
	}
}

// enabledBots returns the org's enabled bots, cached briefly so a high-volume
// event stream doesn't issue one DB query per signal. Config changes propagate
// within botCacheTTL; the "test" action bypasses this (reads the row directly).
func (n *Notifier) enabledBots(ctx context.Context, orgID int64) ([]models.TelegramBot, error) {
	now := time.Now()
	n.cmu.Lock()
	if e, ok := n.cache[orgID]; ok && now.Before(e.exp) {
		n.cmu.Unlock()
		return e.bots, nil
	}
	n.cmu.Unlock()

	bots, err := n.store.ListEnabledTelegramBots(ctx, orgID)
	if err != nil {
		return nil, err
	}
	n.cmu.Lock()
	n.cache[orgID] = botCacheEntry{bots: bots, exp: now.Add(botCacheTTL)}
	n.cmu.Unlock()
	return bots, nil
}

// Dispatch processes a signal asynchronously — never blocks the caller.
func (n *Notifier) Dispatch(sig Signal) {
	if n == nil || sig.OrgID == 0 || sig.Kind == "" {
		return
	}
	go n.process(sig)
}

// AuditHook adapts store.LogAudit's callback into an audit signal. Assigned to
// store.AuditHook in main.go.
func (n *Notifier) AuditHook(orgID int64, _ *int64, action, _ string) {
	n.Dispatch(Signal{OrgID: orgID, Kind: "audit", AuditAction: action})
}

func (n *Notifier) process(sig Signal) {
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()

	bots, err := n.enabledBots(ctx, sig.OrgID)
	if err != nil {
		n.log.Warn("list bots", slog.Any("err", err))
		return
	}
	if len(bots) == 0 {
		return
	}
	text := format(sig)
	for i := range bots {
		bot := bots[i]
		if !matches(bot.Config, sig) {
			continue
		}
		if !n.passThrottle(bot.ID, sig.Kind, bot.ThrottleSecs) {
			continue
		}
		// v1: deliver as plain text for reliability (no MarkdownV2 escaping bugs).
		if err := n.tg.SendMessage(ctx, bot.BotToken, bot.ChatID, text, ""); err != nil {
			n.log.Warn("telegram send failed", slog.Int64("bot", bot.ID), slog.Any("err", err))
			continue
		}
		_ = n.store.TouchTelegramBotSent(ctx, bot.ID)
	}
}

// SendTest synchronously sends a fixed test message and returns the Telegram error.
func (n *Notifier) SendTest(ctx context.Context, bot *models.TelegramBot) error {
	msg := fmt.Sprintf("🐝 HoneyBee test message\nBot \"%s\" is connected — notifications will be delivered here.", bot.Name)
	return n.tg.SendMessage(ctx, bot.BotToken, bot.ChatID, msg, "")
}

func (n *Notifier) passThrottle(botID int64, kind string, secs int) bool {
	if secs <= 0 {
		return true
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	m := n.last[botID]
	if m == nil {
		m = make(map[string]time.Time)
		n.last[botID] = m
	}
	now := time.Now()
	if t, ok := m[kind]; ok && now.Sub(t) < time.Duration(secs)*time.Second {
		return false
	}
	m[kind] = now
	return true
}

// ── matching ──────────────────────────────────────────────────────────
func matches(cfg models.SubscriptionConfig, sig Signal) bool {
	switch sig.Kind {
	case "event":
		if !cfg.Events.Enabled || sig.Event == nil {
			return false
		}
		return inOrEmpty(cfg.Events.HoneypotTypes, sig.Event.HoneypotType) &&
			inOrEmptyInt(cfg.Events.NodeIDs, sig.Event.NodeID) &&
			inOrEmpty(cfg.Events.EventTypes, sig.Event.EventType)
	case "alert":
		if !cfg.Alerts.Enabled || sig.Alert == nil {
			return false
		}
		return severityRank(string(sig.Alert.Severity)) >= severityRank(cfg.Alerts.MinSeverity)
	case "node_status":
		if !cfg.NodeStatus.Enabled {
			return false
		}
		if sig.NodeOnline {
			return cfg.NodeStatus.Online
		}
		return cfg.NodeStatus.Offline
	case "deployment":
		if !cfg.Deployments.Enabled {
			return false
		}
		return inOrEmpty(cfg.Deployments.Statuses, sig.DeployStatus)
	case "audit":
		if !cfg.Audit.Enabled {
			return false
		}
		return inOrEmpty(cfg.Audit.Actions, sig.AuditAction)
	}
	return false
}

func inOrEmpty(list []string, v string) bool {
	if len(list) == 0 {
		return true
	}
	for _, x := range list {
		if strings.EqualFold(strings.TrimSpace(x), v) {
			return true
		}
	}
	return false
}

func inOrEmptyInt(list []int64, v int64) bool {
	if len(list) == 0 {
		return true
	}
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func severityRank(s string) int {
	switch models.AlertSeverity(strings.ToLower(strings.TrimSpace(s))) {
	case models.AlertSeverityInfo:
		return 0
	case models.AlertSeverityLow:
		return 1
	case models.AlertSeverityMedium:
		return 2
	case models.AlertSeverityHigh:
		return 3
	case models.AlertSeverityCritical:
		return 4
	}
	return 0 // unknown / empty min severity ⇒ match all
}

// ── message formatting (plain text) ───────────────────────────────────
func format(sig Signal) string {
	switch sig.Kind {
	case "event":
		e := sig.Event
		return fmt.Sprintf("👾 Attack event: %s\nFrom %s on %s (%s) · node #%d",
			nz(e.EventType, "event"), nz(e.SourceIP, "unknown"), nz(e.HoneypotType, "honeypot"), nz(e.PotID, "-"), e.NodeID)
	case "alert":
		a := sig.Alert
		t := fmt.Sprintf("🚨 Alert [%s]: %s", strings.ToUpper(string(a.Severity)), a.Title)
		if a.Message != "" {
			t += "\n" + a.Message
		}
		return t
	case "node_status":
		if sig.NodeOnline {
			return fmt.Sprintf("🟢 Node #%d is now ONLINE", sig.NodeID)
		}
		return fmt.Sprintf("🔴 Node #%d went OFFLINE", sig.NodeID)
	case "deployment":
		t := fmt.Sprintf("📦 Deployment %s → %s", nz(sig.DeployPotID, "honeypot"), nz(sig.DeployStatus, "updated"))
		if sig.DeployMsg != "" {
			t += " — " + sig.DeployMsg
		}
		return t
	case "audit":
		return fmt.Sprintf("🛡 Audit: %s", nz(sig.AuditAction, "action"))
	}
	return "HoneyBee notification"
}

func nz(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}
