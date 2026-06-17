package models

import "time"

// TelegramMsgFormat controls Telegram parse_mode. Reserved for future use;
// v1 delivers plain text for reliability (no MarkdownV2 escaping pitfalls).
type TelegramMsgFormat string

const (
	TGFormatText     TelegramMsgFormat = "text"
	TGFormatMarkdown TelegramMsgFormat = "markdown"
	TGFormatHTML     TelegramMsgFormat = "html"
)

// SubscriptionConfig controls which system signals notify a Telegram bot.
// Stored as the JSON `config` column. Empty filter slices mean "match any".
type SubscriptionConfig struct {
	// Attacker interaction events.
	Events struct {
		Enabled       bool     `json:"enabled"`
		HoneypotTypes []string `json:"honeypot_types"` // empty = any
		NodeIDs       []int64  `json:"node_ids"`       // empty = any
		EventTypes    []string `json:"event_types"`    // empty = any
	} `json:"events"`

	// Alerts, gated by a minimum severity.
	Alerts struct {
		Enabled     bool   `json:"enabled"`
		MinSeverity string `json:"min_severity"` // info|low|medium|high|critical ("" = any)
	} `json:"alerts"`

	// Node online/offline transitions.
	NodeStatus struct {
		Enabled bool `json:"enabled"`
		Online  bool `json:"online"`
		Offline bool `json:"offline"`
	} `json:"node_status"`

	// Deployment (honeypot) status changes.
	Deployments struct {
		Enabled  bool     `json:"enabled"`
		Statuses []string `json:"statuses"` // empty = any
	} `json:"deployments"`

	// Audit / security actions.
	Audit struct {
		Enabled bool     `json:"enabled"`
		Actions []string `json:"actions"` // empty = any
	} `json:"audit"`
}

// TelegramBot is a configured outbound notification bot.
type TelegramBot struct {
	ID           int64              `json:"id"`
	OrgID        int64              `json:"org_id"`
	Name         string             `json:"name"`
	BotToken     string             `json:"-"`         // secret — never serialized to the dashboard
	HasToken     bool               `json:"has_token"` // computed: token present
	ChatID       string             `json:"chat_id"`
	Enabled      bool               `json:"enabled"`
	Config       SubscriptionConfig `json:"config"`
	MsgFormat    TelegramMsgFormat  `json:"msg_format"`
	ThrottleSecs int                `json:"throttle_secs"`
	LastSentAt   *time.Time         `json:"last_sent_at"`
	CreatedAt    time.Time          `json:"created_at"`
	UpdatedAt    time.Time          `json:"updated_at"`
}
