// Package models holds DTOs shared between core, node, cli and (via JSON) the dashboard.
package models

import "time"

// Role is a user role.
type Role string

const (
	RoleAdmin    Role = "admin"
	RoleOperator Role = "operator"
	RoleViewer   Role = "viewer"
)

// NodeStatus is a node connectivity state.
type NodeStatus string

const (
	NodeOffline   NodeStatus = "offline"
	NodeOnline    NodeStatus = "online"
	NodeDeploying NodeStatus = "deploying"
	NodeFailed    NodeStatus = "failed"
)

// Organization represents a tenant.
type Organization struct {
	ID        int64     `json:"id" db:"id"`
	Name      string    `json:"name" db:"name"`
	Slug      string    `json:"slug" db:"slug"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// User is an account inside an organization.
type User struct {
	ID           int64     `json:"id" db:"id"`
	OrgID        int64     `json:"org_id" db:"org_id"`
	Email        string    `json:"email" db:"email"`
	PasswordHash string    `json:"-" db:"password_hash"`
	Name         string    `json:"name" db:"name"`
	Role         Role      `json:"role" db:"role"`
	Avatar       string    `json:"avatar" db:"avatar"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" db:"updated_at"`
}

// ── Permissions & custom roles ───────────────────────────────────────
//
// Each protected, mutating route requires a single permission key. A role
// (built-in or custom) is a named set of these keys. The built-in admin role
// implicitly holds every permission.

const (
	PermPotsDeploy       = "pots.deploy"
	PermNodesManage      = "nodes.manage"
	PermAlertsManage     = "alerts.manage"
	PermBroadcast        = "broadcast"
	PermPotstoreSync     = "potstore.sync"
	PermAlertRulesManage = "alertrules.manage"
	PermUsersManage      = "users.manage"
	PermNotificationsManage = "notifications.manage"
)

// PermissionDef describes one permission for the role-builder UI.
type PermissionDef struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Group string `json:"group"`
	Desc  string `json:"description"`
}

// PermissionCatalog is the full, ordered list of assignable permissions.
var PermissionCatalog = []PermissionDef{
	{PermPotsDeploy, "Deploy & control honeypots", "Honeypots", "Install, start, stop, restart and remove honeypots."},
	{PermNodesManage, "Manage nodes", "Infrastructure", "Register, delete, regenerate tokens, and configure nodes."},
	{PermBroadcast, "Broadcast commands", "Infrastructure", "Send commands to every node at once."},
	{PermAlertsManage, "Manage alerts", "Security", "Create, acknowledge and delete alerts."},
	{PermAlertRulesManage, "Manage alert rules", "Security", "Create, edit and delete alert rules."},
	{PermPotstoreSync, "Sync PotStore catalog", "Catalog", "Refresh the honeypot catalog from the repository."},
	{PermUsersManage, "Manage users & roles", "Administration", "Invite users, assign roles, and define custom roles."},
	{PermNotificationsManage, "Manage notifications", "Administration", "Create, configure, test and delete Telegram notification bots."},
}

// AllPermKeys returns every permission key (admin's implicit set).
func AllPermKeys() []string {
	out := make([]string, len(PermissionCatalog))
	for i, p := range PermissionCatalog {
		out[i] = p.Key
	}
	return out
}

// ValidPerm reports whether key is a known permission.
func ValidPerm(key string) bool {
	for _, p := range PermissionCatalog {
		if p.Key == key {
			return true
		}
	}
	return false
}

// BuiltinRolePerms maps each built-in role slug to its default permission set.
var BuiltinRolePerms = map[string][]string{
	string(RoleAdmin):    AllPermKeys(),
	string(RoleOperator): {PermPotsDeploy, PermNodesManage, PermBroadcast, PermAlertsManage},
	string(RoleViewer):   {},
}

// SystemRoleMeta is display metadata for the seeded built-in roles.
var SystemRoleMeta = map[string]struct{ Name, Color string }{
	string(RoleAdmin):    {"Administrator", "#B45309"},
	string(RoleOperator): {"Operator", "#4338CA"},
	string(RoleViewer):   {"Viewer", "#475569"},
}

// RoleDef is a role row (built-in or custom) with its permission set.
type RoleDef struct {
	ID          int64     `json:"id"`
	OrgID       int64     `json:"org_id"`
	Slug        string    `json:"slug"`
	Name        string    `json:"name"`
	Color       string    `json:"color"`
	Permissions []string  `json:"permissions"`
	IsSystem    bool      `json:"is_system"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Node is a registered field agent.
type Node struct {
	ID            int64      `json:"id" db:"id"`
	OrgID         int64      `json:"org_id" db:"org_id"`
	Name          string     `json:"name" db:"name"`
	TokenHash     string     `json:"-" db:"token_hash"`
	IPAddress     string     `json:"ip_address" db:"ip_address"`
	OS            string     `json:"os" db:"os"`
	Arch          string     `json:"arch" db:"arch"`
	Hostname      string     `json:"hostname" db:"hostname"`
	Status        NodeStatus `json:"status" db:"status"`
	LastHeartbeat *time.Time `json:"last_heartbeat" db:"last_heartbeat"`
	CreatedAt     time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at" db:"updated_at"`
	// DisplayOrder is the 1-based sequential rank by created_at within the org.
	// Always contiguous (1, 2, 3…) regardless of DB id gaps.
	DisplayOrder int     `json:"display_order" db:"display_order"`
	Online       bool    `json:"online" db:"-"`
	CPUPct       float64 `json:"cpu_pct,omitempty" db:"-"`
	MemPct       float64 `json:"mem_pct,omitempty" db:"-"`
	DiskPct      float64 `json:"disk_pct,omitempty" db:"-"`
	UptimeSecs   int64   `json:"uptime_secs,omitempty" db:"-"`

	// LogAnalyzer integration (per-node opt-in).
	// The raw ingest token is never serialized to the dashboard.
	LAEnabled       bool   `json:"la_enabled" db:"la_enabled"`
	LAWorkspaceID   string `json:"la_workspace_id,omitempty" db:"la_workspace_id"`
	LAWorkspaceName string `json:"la_workspace_name,omitempty" db:"la_workspace_name"`
	LAIngestToken   string `json:"-" db:"la_ingest_token"`
}

// NodeMetric is a single performance snapshot from a node heartbeat.
type NodeMetric struct {
	ID         int64     `json:"id" db:"id"`
	NodeID     int64     `json:"node_id" db:"node_id"`
	CPUPct     float64   `json:"cpu_pct" db:"cpu_pct"`
	MemPct     float64   `json:"mem_pct" db:"mem_pct"`
	DiskPct    float64   `json:"disk_pct" db:"disk_pct"`
	UptimeSecs int64     `json:"uptime_secs" db:"uptime_secs"`
	RecordedAt time.Time `json:"recorded_at" db:"recorded_at"`
}

// Deployment is one honeypot installed on a node.
type Deployment struct {
	ID            int64     `json:"id" db:"id"`
	OrgID         int64     `json:"org_id" db:"org_id"`
	NodeID        int64     `json:"node_id" db:"node_id"`
	PotID         string    `json:"pot_id" db:"pot_id"`
	HoneypotType  string    `json:"honeypot_type" db:"honeypot_type"`
	Config        string    `json:"config" db:"config"` // JSON string
	Status        string    `json:"status" db:"status"`
	StatusMessage string    `json:"status_message" db:"status_message"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
	UpdatedAt     time.Time `json:"updated_at" db:"updated_at"`
}

// Task is a durable command queued for a node.
type Task struct {
	ID        int64     `json:"id" db:"id"`
	OrgID     int64     `json:"org_id" db:"org_id"`
	NodeID    int64     `json:"node_id" db:"node_id"`
	DeployID  *int64    `json:"deploy_id" db:"deploy_id"`
	Command   string    `json:"command" db:"command"`
	Payload   string    `json:"payload" db:"payload"` // JSON string
	Status    string    `json:"status" db:"status"`
	Result    string    `json:"result" db:"result"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// Event is an attacker interaction record.
type Event struct {
	ID           int64     `json:"id" db:"id"`
	OrgID        int64     `json:"org_id" db:"org_id"`
	NodeID       int64     `json:"node_id" db:"node_id"`
	DeployID     *int64    `json:"deploy_id" db:"deploy_id"`
	PotID        string    `json:"pot_id" db:"pot_id"`
	HoneypotType string    `json:"honeypot_type" db:"honeypot_type"`
	EventType    string    `json:"event_type" db:"event_type"`
	SourceIP     string    `json:"source_ip" db:"source_ip"`
	SourcePort   int       `json:"source_port" db:"source_port"`
	DestPort     int       `json:"dest_port" db:"dest_port"`
	Data         string    `json:"data" db:"data"` // raw JSON
	EventTime    time.Time `json:"event_time" db:"event_time"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
}

// PotLogEntry mirrors the pot_logs table row.
type PotLogEntry struct {
	ID           int64     `json:"id" db:"id"`
	OrgID        int64     `json:"org_id" db:"org_id"`
	NodeID       int64     `json:"node_id" db:"node_id"`
	DeploymentID *int64    `json:"deployment_id,omitempty" db:"deployment_id"`
	PotID        string    `json:"pot_id" db:"pot_id"`
	PotType      string    `json:"pot_type" db:"pot_type"`
	LogType      string    `json:"log_type" db:"log_type"`
	Data         string    `json:"data" db:"data"`
	LoggedAt     time.Time `json:"logged_at" db:"logged_at"`
}

// Session is a captured attacker session.
type Session struct {
	ID           int64      `json:"id" db:"id"`
	OrgID        int64      `json:"org_id" db:"org_id"`
	NodeID       int64      `json:"node_id" db:"node_id"`
	DeployID     *int64     `json:"deploy_id" db:"deploy_id"`
	PotID        string     `json:"pot_id" db:"pot_id"`
	SessionID    string     `json:"session_id" db:"session_id"`
	SrcIP        string     `json:"src_ip" db:"src_ip"`
	SrcPort      int        `json:"src_port" db:"src_port"`
	DstPort      int        `json:"dst_port" db:"dst_port"`
	StartedAt    time.Time  `json:"started_at" db:"started_at"`
	EndedAt      *time.Time `json:"ended_at" db:"ended_at"`
	DurationSecs int64      `json:"duration_secs" db:"duration_secs"`
}

// SessionDataChunk is one ordered chunk of attacker terminal bytes.
type SessionDataChunk struct {
	ID         int64     `json:"id" db:"id"`
	SessionID  int64     `json:"session_id" db:"session_id"`
	Sequence   int64     `json:"sequence" db:"sequence"`
	RawData    []byte    `json:"raw_data" db:"raw_data"`
	CapturedAt time.Time `json:"captured_at" db:"captured_at"`
}

// AuditEntry mirrors the audit_log table row.
type AuditEntry struct {
	ID         int64     `json:"id" db:"id"`
	OrgID      int64     `json:"org_id" db:"org_id"`
	UserID     *int64    `json:"user_id" db:"user_id"`
	Action     string    `json:"action" db:"action"`
	Resource   string    `json:"resource" db:"resource"`
	ResourceID *string   `json:"resource_id" db:"resource_id"`
	Details    string    `json:"details" db:"details"`
	CreatedAt  time.Time `json:"created_at" db:"created_at"`
}

// AlertSeverity represents alert severity levels.
type AlertSeverity string

const (
	AlertSeverityCritical AlertSeverity = "critical"
	AlertSeverityHigh     AlertSeverity = "high"
	AlertSeverityMedium   AlertSeverity = "medium"
	AlertSeverityLow      AlertSeverity = "low"
	AlertSeverityInfo     AlertSeverity = "info"
)

// Alert is a triggered alert instance.
type Alert struct {
	ID             int64         `json:"id" db:"id"`
	OrgID          int64         `json:"org_id" db:"org_id"`
	RuleID         *int64        `json:"rule_id" db:"rule_id"`
	Severity       AlertSeverity `json:"severity" db:"severity"`
	Title          string        `json:"title" db:"title"`
	Message        string        `json:"message" db:"message"`
	Source         string        `json:"source" db:"source"`
	SourceRef      string        `json:"source_ref" db:"source_ref"`
	Acknowledged   bool          `json:"acknowledged" db:"acknowledged"`
	AcknowledgedBy *int64        `json:"acknowledged_by" db:"acknowledged_by"`
	AcknowledgedAt *time.Time    `json:"acknowledged_at" db:"acknowledged_at"`
	CreatedAt      time.Time     `json:"created_at" db:"created_at"`
}

// AlertRule defines an alerting rule that generates alerts.
type AlertRule struct {
	ID          int64      `json:"id" db:"id"`
	OrgID       int64      `json:"org_id" db:"org_id"`
	Name        string     `json:"name" db:"name"`
	Description string     `json:"description" db:"description"`
	EventType   string     `json:"event_type" db:"event_type"`
	Condition   string     `json:"condition" db:"condition"` // JSON condition
	Severity    string     `json:"severity" db:"severity"`
	Enabled     bool       `json:"enabled" db:"enabled"`
	Cooldown    int        `json:"cooldown_secs" db:"cooldown_secs"`
	LastFired   *time.Time `json:"last_fired" db:"last_fired"`
	CreatedAt   time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at" db:"updated_at"`
}

// PotStoreEntry is a catalog item from potstore.json.
type PotStoreEntry struct {
	ID           string         `json:"id"`
	Name         string         `json:"name"`
	Type         string         `json:"type"`
	Description  string         `json:"description"`
	GitURL       string         `json:"git_url"`
	GitBranch    string         `json:"git_branch"`
	EntryPoint   string         `json:"entry_point"`
	InstallCmd   []string       `json:"install_cmd"`
	RunCmd       []string       `json:"run_cmd"`
	DefaultPorts map[string]int `json:"default_ports"`
	Language     string         `json:"language"`
	// Subdir, if set, is the path WITHIN the cloned repo that contains the
	// actual pot files. After clone the node flattens dir/<Subdir>/* into
	// dir/. Used for the honeybee_potstore monorepo (HonnyPotter, WebTrap).
	Subdir string `json:"subdir,omitempty"`
}
