package protocol

import (
	"encoding/json"
	"time"
)

// Message type constants (envelope.Type).
const (
	// Node -> Core
	MsgNodeAuth          = "node_auth"
	MsgHeartbeat         = "heartbeat"
	MsgTaskResult        = "task_result"
	MsgPotStatus         = "pot_status"
	MsgPotEvent          = "pot_event"
	MsgPotLog            = "pot_log"
	MsgPotInstalledList  = "pot_installed_list"
	MsgPotInfoResult     = "pot_info_result"
	MsgPotMetricsResult  = "pot_metrics_result"
	MsgSessionStart      = "session_start"
	MsgSessionData       = "session_data"
	MsgSessionEnd        = "session_end"

	// Core -> Node
	MsgAuthResult = "auth_result"
	MsgTaskAssign = "task_assign"
)

// TaskAssign command names (TaskAssign.Command).
const (
	CmdInstallPot       = "install_pot"
	CmdStartPot         = "start_pot"
	CmdStopPot          = "stop_pot"
	CmdRestartPot       = "restart_pot"
	CmdRemovePot        = "remove_pot"
	CmdUpdateConfig     = "update_config"
	CmdGetInstalledPots = "get_installed_pots"
	CmdGetPotInfo       = "get_pot_info"
	CmdGetPotMetrics    = "get_pot_metrics"
	CmdRestartNode      = "restart_node"
	CmdUninstallNode    = "uninstall_node"
)

// Task result status.
const (
	TaskStatusPending   = "pending"
	TaskStatusSent      = "sent"
	TaskStatusCompleted = "completed"
	TaskStatusFailed    = "failed"
)

// Pot/deployment status.
const (
	PotStatusInstalling = "installing"
	PotStatusRunning    = "running"
	PotStatusStopped    = "stopped"
	PotStatusFailed     = "failed"
	PotStatusRemoving   = "removing"
	PotStatusRemoved    = "removed"
)

// ----- Node -> Core payloads -----

// NodeAuth is the very first frame a node sends after dial.
type NodeAuth struct {
	Token    string `json:"token"`
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
}

// Heartbeat is sent periodically from node to core.
type Heartbeat struct {
	NodeID     int64   `json:"node_id"`
	CPUPct     float64 `json:"cpu_pct"`
	MemPct     float64 `json:"mem_pct"`
	DiskPct    float64 `json:"disk_pct"`
	UptimeSecs int64   `json:"uptime_secs"`
}

// TaskResult reports the outcome of a previously assigned task.
type TaskResult struct {
	TaskID  int64  `json:"task_id"`
	NodeID  int64  `json:"node_id"`
	Status  string `json:"status"` // completed | failed
	Message string `json:"message,omitempty"`
}

// PotStatus reports a deployment lifecycle change.
type PotStatus struct {
	NodeID  int64  `json:"node_id"`
	PotID   string `json:"pot_id"`
	PotType string `json:"pot_type"`
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
}

// PotEvent is an attack/interaction event from a honeypot.
type PotEvent struct {
	NodeID     int64           `json:"node_id"`
	PotID      string          `json:"pot_id"`
	PotType    string          `json:"pot_type"`
	EventType  string          `json:"event_type"`
	SourceIP   string          `json:"source_ip,omitempty"`
	SourcePort int             `json:"src_port,omitempty"`
	DestPort   int             `json:"dst_port,omitempty"`
	Data       json.RawMessage `json:"data,omitempty"`
	EventTime  time.Time       `json:"event_time"`
}

// PotLog is a structured internal log entry from a honeypot.
type PotLog struct {
	NodeID    int64                  `json:"node_id"`
	PotID     string                 `json:"pot_id"`
	PotType   string                 `json:"pot_type"`
	LogType   string                 `json:"log_type"`
	Data      map[string]any         `json:"data"`
	Timestamp time.Time              `json:"timestamp"`
}

// PotInfo describes one installed pot.
type PotInfo struct {
	PotID       string                 `json:"pot_id"`
	PotType     string                 `json:"pot_type"`
	Status      string                 `json:"status"`
	Directory   string                 `json:"directory,omitempty"`
	Ports       map[string]int         `json:"ports,omitempty"`
	Config      map[string]any         `json:"config,omitempty"`
}

// PotInstalledList answers a get_installed_pots task.
type PotInstalledList struct {
	TaskID int64     `json:"task_id"`
	NodeID int64     `json:"node_id"`
	Pots   []PotInfo `json:"pots"`
}

// PotInfoResult answers a get_pot_info task.
type PotInfoResult struct {
	TaskID int64   `json:"task_id"`
	NodeID int64   `json:"node_id"`
	PotID  string  `json:"pot_id"`
	Info   PotInfo `json:"info"`
}

// PotMetricsResult answers a get_pot_metrics task.
type PotMetricsResult struct {
	TaskID      int64   `json:"task_id"`
	NodeID      int64   `json:"node_id"`
	PotID       string  `json:"pot_id"`
	CPUPct      float64 `json:"cpu_pct"`
	MemMB       float64 `json:"mem_mb"`
	Connections int     `json:"connections"`
	UptimeSecs  int64   `json:"uptime_secs"`
}

// SessionStart fires when an attacker begins a session.
type SessionStart struct {
	NodeID    int64     `json:"node_id"`
	SessionID string    `json:"session_id"`
	PotID     string    `json:"pot_id"`
	SrcIP     string    `json:"src_ip"`
	SrcPort   int       `json:"src_port"`
	DstPort   int       `json:"dst_port"`
	StartedAt time.Time `json:"started_at"`
}

// SessionData carries a chunk of attacker terminal bytes (base64).
type SessionData struct {
	SessionID string `json:"session_id"`
	Sequence  int64  `json:"sequence"`
	DataB64   string `json:"data_b64"`
}

// SessionEnd marks an attacker session closed.
type SessionEnd struct {
	SessionID    string `json:"session_id"`
	DurationSecs int64  `json:"duration_secs"`
}

// ----- Core -> Node payloads -----

// AuthResult is the response to NodeAuth.
type AuthResult struct {
	Success bool   `json:"success"`
	NodeID  int64  `json:"node_id,omitempty"`
	Message string `json:"message,omitempty"`
}

// TaskAssign delivers a command to a node.
type TaskAssign struct {
	TaskID  int64           `json:"task_id"`
	Command string          `json:"command"`
	Payload json.RawMessage `json:"payload"`
}

// ----- TaskAssign payloads -----

// InstallPotPayload is the payload for the install_pot command.
type InstallPotPayload struct {
	PotID        string         `json:"pot_id"`
	HoneypotType string         `json:"honeypot_type"`
	GitURL       string         `json:"git_url"`
	GitBranch    string         `json:"git_branch,omitempty"`
	// Entrypoint is the file/command to use when starting the pot.
	// If empty, the node will auto-detect based on cloned files.
	Entrypoint  string   `json:"entrypoint,omitempty"`
	// InstallCmds is a list of commands (each as argv) to run after cloning.
	InstallCmds []string `json:"install_cmds,omitempty"`
	// RunCmd is the full command argv to launch the pot process.
	// If set it overrides Entrypoint and auto-detection.
	RunCmd      []string `json:"run_cmd,omitempty"`
	// Subdir, if set, is the path within the cloned repo that contains the
	// pot files. After clone the node flattens this subdirectory into the
	// install dir root. Used for the honeybee_potstore monorepo.
	Subdir       string         `json:"subdir,omitempty"`
	Config       map[string]any `json:"config,omitempty"`
	AutoStart    bool           `json:"auto_start"`
}

// PotControlPayload covers start/stop/restart/remove/get_pot_info/get_pot_metrics.
type PotControlPayload struct {
	PotID string `json:"pot_id"`
}

// UpdateConfigPayload is the payload for update_config.
type UpdateConfigPayload struct {
	PotID  string         `json:"pot_id"`
	Config map[string]any `json:"config"`
}
