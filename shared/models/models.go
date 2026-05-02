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
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" db:"updated_at"`
}

// Node is a registered field agent.
type Node struct {
	ID            int64      `json:"id" db:"id"`
	OrgID         int64      `json:"org_id" db:"org_id"`
	Name          string     `json:"name" db:"name"`
	TokenHash     string     `json:"-" db:"token_hash"`
	OS            string     `json:"os" db:"os"`
	Arch          string     `json:"arch" db:"arch"`
	Hostname      string     `json:"hostname" db:"hostname"`
	Status        NodeStatus `json:"status" db:"status"`
	LastHeartbeat *time.Time `json:"last_heartbeat" db:"last_heartbeat"`
	CreatedAt     time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at" db:"updated_at"`
	DeletedAt     *time.Time `json:"deleted_at,omitempty" db:"deleted_at"`
	Online        bool       `json:"online" db:"-"`
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
	ID        int64      `json:"id" db:"id"`
	OrgID     int64      `json:"org_id" db:"org_id"`
	NodeID    int64      `json:"node_id" db:"node_id"`
	DeployID  *int64     `json:"deploy_id" db:"deploy_id"`
	Command   string     `json:"command" db:"command"`
	Payload   string     `json:"payload" db:"payload"` // JSON string
	Status    string     `json:"status" db:"status"`
	Result    string     `json:"result" db:"result"`
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt time.Time  `json:"updated_at" db:"updated_at"`
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

// PotStoreEntry is a catalog item from potstore.json.
type PotStoreEntry struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Type        string         `json:"type"`
	Description string         `json:"description"`
	GitURL      string         `json:"git_url"`
	GitBranch   string         `json:"git_branch"`
	EntryPoint  string         `json:"entry_point"`
	InstallCmd  []string       `json:"install_cmd"`
	RunCmd      []string       `json:"run_cmd"`
	DefaultPorts map[string]int `json:"default_ports"`
	Language    string         `json:"language"`
	// Subdir, if set, is the path WITHIN the cloned repo that contains the
	// actual pot files. After clone the node flattens dir/<Subdir>/* into
	// dir/. Used for the honeybee_potstore monorepo (HonnyPotter, WebTrap).
	Subdir string `json:"subdir,omitempty"`
}
