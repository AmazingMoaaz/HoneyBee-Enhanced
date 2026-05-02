package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/honeybee-enhanced/core/internal/api/middleware"
	"github.com/honeybee-enhanced/core/internal/config"
	"github.com/honeybee-enhanced/core/internal/nodeserver"
	"github.com/honeybee-enhanced/core/internal/store"
	"golang.org/x/crypto/bcrypt"
)

// NodesHandler handles /nodes/* endpoints.
type NodesHandler struct {
	Store      *store.Store
	NodeServer *nodeserver.Server
	Cfg        *config.Config
}

// NewNodesHandler constructs.
func NewNodesHandler(s *store.Store, ns *nodeserver.Server, c *config.Config) *NodesHandler {
	return &NodesHandler{Store: s, NodeServer: ns, Cfg: c}
}

// List returns nodes for the current org.
func (h *NodesHandler) List(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	nodes, err := h.Store.ListNodes(r.Context(), orgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list nodes")
		return
	}
	for i := range nodes {
		nodes[i].Online = h.NodeServer.IsOnline(nodes[i].ID)
	}
	writeJSON(w, http.StatusOK, nodes)
}

type createNodeReq struct {
	Name string `json:"name"`
}
type createNodeResp struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Token string `json:"token"`
}

// Create generates a new node + token (returned once).
func (h *NodesHandler) Create(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	var req createNodeReq
	if err := readJSON(r, &req); err != nil || strings.TrimSpace(req.Name) == "" {
		writeError(w, http.StatusBadRequest, "missing name")
		return
	}
	token, err := generateToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "generate token")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(token), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash token")
		return
	}
	id, err := h.Store.CreateNode(r.Context(), orgID, req.Name, string(hash))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create node")
		return
	}
	uid := middleware.UserID(r.Context())
	rid := strconv.FormatInt(id, 10)
	_ = h.Store.LogAudit(r.Context(), orgID, &uid, "create", "node", &rid, req.Name)
	writeJSON(w, http.StatusCreated, createNodeResp{ID: id, Name: req.Name, Token: token})
}

// Get returns a single node.
func (h *NodesHandler) Get(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	n, err := h.Store.GetNode(r.Context(), orgID, id)
	if err != nil {
		writeError(w, http.StatusNotFound, "node")
		return
	}
	n.Online = h.NodeServer.IsOnline(n.ID)
	deps, _ := h.Store.ListDeployments(r.Context(), orgID, id, "")
	writeJSON(w, http.StatusOK, map[string]any{
		"node":        n,
		"deployments": deps,
	})
}

// Delete soft-deletes a node and disconnects it.
func (h *NodesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if _, err := h.Store.GetNode(r.Context(), orgID, id); err != nil {
		writeError(w, http.StatusNotFound, "node")
		return
	}
	h.NodeServer.DisconnectNode(id)
	if err := h.Store.SoftDeleteNode(r.Context(), orgID, id); err != nil {
		writeError(w, http.StatusInternalServerError, "delete")
		return
	}
	uid := middleware.UserID(r.Context())
	rid := strconv.FormatInt(id, 10)
	_ = h.Store.LogAudit(r.Context(), orgID, &uid, "delete", "node", &rid, "")
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// RegenerateToken issues a new token, invalidating the previous.
func (h *NodesHandler) RegenerateToken(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if _, err := h.Store.GetNode(r.Context(), orgID, id); err != nil {
		writeError(w, http.StatusNotFound, "node")
		return
	}
	token, err := generateToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "generate")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(token), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash")
		return
	}
	if err := h.Store.RegenerateNodeToken(r.Context(), orgID, id, string(hash)); err != nil {
		writeError(w, http.StatusInternalServerError, "update")
		return
	}
	h.NodeServer.DisconnectNode(id)
	uid := middleware.UserID(r.Context())
	rid := strconv.FormatInt(id, 10)
	_ = h.Store.LogAudit(r.Context(), orgID, &uid, "regenerate-token", "node", &rid, "")
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "token": token})
}

// InstallScript returns a one-liner install script (bash or PowerShell).
// Supports JWT auth OR raw node token via ?token=<token>.
func (h *NodesHandler) InstallScript(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	platform := strings.ToLower(r.URL.Query().Get("platform"))
	if platform == "" {
		platform = "bash"
	}

	// Auth: JWT preferred; fall back to ?token=<raw>
	var orgIDOK int64
	if c, _ := h.parseJWTQuery(r); c != nil {
		orgIDOK = c.OrgID
	} else {
		raw := r.URL.Query().Get("token")
		if raw == "" {
			writeError(w, http.StatusUnauthorized, "auth required")
			return
		}
		nodes, _ := h.Store.ListAllNodes(r.Context())
		for _, n := range nodes {
			if bcrypt.CompareHashAndPassword([]byte(n.TokenHash), []byte(raw)) == nil && n.ID == id {
				orgIDOK = n.OrgID
				break
			}
		}
		if orgIDOK == 0 {
			writeError(w, http.StatusUnauthorized, "invalid token")
			return
		}
	}

	n, err := h.Store.GetNode(r.Context(), orgIDOK, id)
	if err != nil {
		writeError(w, http.StatusNotFound, "node")
		return
	}

	rawToken := r.URL.Query().Get("token")
	if rawToken == "" {
		rawToken = "<NODE_TOKEN_HERE>"
	}

	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	// Use explicit public address from config (production), else derive from
	// the Host header — nginx passes $http_host which preserves the port.
	httpBase := h.Cfg.Server.PublicHTTPAddr
	if httpBase == "" {
		httpBase = scheme + "://" + r.Host
	}
	nodeAddr := h.nodePublicAddr(r)

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	switch platform {
	case "ps", "powershell", "windows":
		// PowerShell script — no backtick characters so Go raw-string literal is safe.
		fmt.Fprintf(w, `# HoneyBee-Enhanced node install (Windows / PowerShell)
# Run as Administrator.
$ErrorActionPreference = 'Stop'

$NodeID    = %d
$NodeName  = "%s"
$NodeToken = "%s"
$HBServer  = "%s"
$HBAddr    = "%s"

# --- detect arch ---
$Arch = if ([Environment]::Is64BitOperatingSystem) { "amd64" } else { "386" }

$BinDir = "$env:LOCALAPPDATA\HoneyBeeNode"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
New-Item -ItemType Directory -Force -Path "$BinDir\data" | Out-Null

Write-Host "[1/4] Downloading honeybee-node (windows/$Arch)..."
Invoke-WebRequest "$HBServer/api/v1/download/node-agent?os=windows&arch=$Arch" -OutFile "$BinDir\hb-node.exe"

Write-Host "[2/4] Writing config..."
$DataDir = "$BinDir\data" -replace '\\', '/'
$BinDirFwd = $BinDir -replace '\\', '/'
@"
node:
  name: "$NodeName"
  data_dir: "$DataDir"
server:
  address: "$HBAddr"
  token: "$NodeToken"
log:
  level: "info"
"@ | Set-Content "$BinDir\node.yaml"

$taskName = "HoneyBeeNode"
$exe  = "$BinDir\hb-node.exe"
$args = "--config " + '"' + "$BinDir\node.yaml" + '"'
$action   = New-ScheduledTaskAction -Execute $exe -Argument $args
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($isAdmin) {
    Write-Host "[3/4] Registering scheduled task (runs at startup as SYSTEM)..."
    $trigger   = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $taskName
    Write-Host "[4/4] Done. Node '$NodeName' (ID $NodeID) is running as SYSTEM."
    Write-Host "      Manage: Get-ScheduledTask -TaskName HoneyBeeNode"
} else {
    Write-Host "[3/4] Registering scheduled task (runs at logon for current user)..."
    $trigger   = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    Write-Host "      (No admin rights - task runs at logon instead of startup)"
    Write-Host "      To run as SYSTEM at startup, re-run this script from an elevated PowerShell."
    Start-Process -FilePath $exe -ArgumentList $args -WindowStyle Hidden
    Write-Host "[4/4] Done. Node '$NodeName' (ID $NodeID) started in background."
    Write-Host "      Manage: Get-ScheduledTask -TaskName HoneyBeeNode"
}
Write-Host "      Logs:   $BinDir\data"
`, n.ID, n.Name, rawToken, httpBase, nodeAddr)

	default: // bash (Linux / macOS)
		fmt.Fprintf(w, `#!/usr/bin/env bash
# HoneyBee-Enhanced node install — Linux / macOS
# Usage:  curl -fsSL "%s/api/v1/nodes/%d/install?token=%s" | bash
set -euo pipefail

NODE_ID=%d
NODE_NAME="%s"
NODE_TOKEN="%s"
HB_SERVER="%s"
HB_ADDR="%s"

# --- detect OS / arch ---
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
case $(uname -m) in
  x86_64)        ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *)             echo "Unsupported arch: $(uname -m)"; exit 1 ;;
esac

BIN="$HOME/.honeybee/bin/hb-node"
CFG="$HOME/.honeybee/node.yaml"
mkdir -p "$(dirname "$BIN")" "$HOME/.honeybee/data"

echo "[1/4] Downloading honeybee-node ($OS/$ARCH)..."
curl -fsSL "$HB_SERVER/api/v1/download/node-agent?os=$OS&arch=$ARCH" -o "$BIN"
chmod +x "$BIN"

echo "[2/4] Writing config..."
cat > "$CFG" <<EOF
node:
  name: "$NODE_NAME"
  data_dir: "$HOME/.honeybee/data"
server:
  address: "$HB_ADDR"
  token: "$NODE_TOKEN"
log:
  level: "info"
EOF

echo "[3/4] Installing service..."
if command -v systemctl &>/dev/null && [[ "$EUID" -eq 0 || $(id -u) -eq 0 ]]; then
  # running as root — install system-wide
  cat > /etc/systemd/system/honeybee-node.service <<SVCEOF
[Unit]
Description=HoneyBee Node Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$BIN --config $CFG
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SVCEOF
  systemctl daemon-reload
  systemctl enable --now honeybee-node
  echo "[4/4] systemd service 'honeybee-node' started."
elif command -v systemctl &>/dev/null; then
  # non-root — user systemd unit
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/honeybee-node.service" <<SVCEOF
[Unit]
Description=HoneyBee Node Agent
After=network.target

[Service]
Type=simple
ExecStart=$BIN --config $CFG
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
SVCEOF
  systemctl --user daemon-reload
  systemctl --user enable --now honeybee-node
  loginctl enable-linger "$USER" 2>/dev/null || true
  echo "[4/4] User systemd service 'honeybee-node' started."
else
  nohup "$BIN" --config "$CFG" > "$HOME/.honeybee/node.log" 2>&1 &
  echo "[4/4] Node started in background (logs: $HOME/.honeybee/node.log)."
fi

echo "Done. Node '$NODE_NAME' (ID $NODE_ID) → $HB_ADDR"
`, httpBase, n.ID, rawToken, n.ID, n.Name, rawToken, httpBase, nodeAddr)
	}
}

// nodePublicAddr resolves the TCP address that node agents should dial.
// Prefers cfg.Server.NodePublicAddr; falls back to r.Host hostname + node port.
func (h *NodesHandler) nodePublicAddr(r *http.Request) string {
	if h.Cfg.Server.NodePublicAddr != "" {
		return h.Cfg.Server.NodePublicAddr
	}
	hostname := r.Host
	if host, _, err := net.SplitHostPort(r.Host); err == nil {
		hostname = host
	}
	_, port, _ := net.SplitHostPort(h.Cfg.Server.NodeAddr)
	if port == "" {
		port = "9001"
	}
	return net.JoinHostPort(hostname, port)
}

func (h *NodesHandler) parseJWTQuery(r *http.Request) (*middleware.Claims, error) {
	auth := r.Header.Get("Authorization")
	tok := strings.TrimPrefix(auth, "Bearer ")
	if tok == "" || tok == auth {
		tok = r.URL.Query().Get("jwt")
	}
	if tok == "" {
		return nil, fmt.Errorf("no jwt")
	}
	jwtMid := middleware.NewJWTAuth(h.Cfg.JWT.Secret)
	return jwtMid.Parse(tok)
}

// generateToken returns 32 random bytes hex-encoded.
func generateToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// UninstallScript returns a platform-specific script that removes the node agent.
func (h *NodesHandler) UninstallScript(w http.ResponseWriter, r *http.Request) {
	platform := strings.ToLower(r.URL.Query().Get("platform"))

	if platform == "windows" {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprint(w, `# HoneyBee-Enhanced node uninstall — Windows
$taskName = "HoneyBeeNode"
$BinDir   = "$env:LOCALAPPDATA\HoneyBeeNode"

Write-Host "[1/3] Stopping scheduled task..."
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

Write-Host "[2/3] Removing scheduled task..."
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Write-Host "[3/3] Deleting files..."
Start-Sleep -Seconds 1
Remove-Item -Recurse -Force $BinDir -ErrorAction SilentlyContinue

Write-Host "Done. HoneyBeeNode has been removed from this device."
`)
	} else {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprint(w, `#!/usr/bin/env bash
# HoneyBee-Enhanced node uninstall — Linux / macOS
set -euo pipefail

SERVICE=honeybee-node
BIN_DIR="$HOME/.honeybee"

echo "[1/3] Stopping service..."
if systemctl --user is-active --quiet "$SERVICE" 2>/dev/null; then
  systemctl --user stop "$SERVICE"
elif systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
  sudo systemctl stop "$SERVICE"
fi
pkill -f "hb-node" 2>/dev/null || true

echo "[2/3] Removing service unit..."
systemctl --user disable "$SERVICE" 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/${SERVICE}.service"
systemctl --user daemon-reload 2>/dev/null || true
sudo systemctl disable "$SERVICE" 2>/dev/null || true
sudo rm -f "/etc/systemd/system/${SERVICE}.service"
sudo systemctl daemon-reload 2>/dev/null || true

echo "[3/3] Deleting files..."
rm -rf "$BIN_DIR"
sudo rm -f /usr/local/bin/hb-node 2>/dev/null || true

echo "Done. HoneyBeeNode has been removed from this device."
`)
	}
}

// Uninstall sends CmdUninstallNode to the node (if online), then deletes from DB.
func (h *NodesHandler) Uninstall(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	n, err := h.Store.GetNode(r.Context(), orgID, id)
	if err != nil {
		writeError(w, http.StatusNotFound, "node")
		return
	}
	// If the node is online, send the uninstall command so it self-destructs.
	online := h.NodeServer.IsOnline(n.ID)
	if online {
		_ = h.NodeServer.SendCommand(n.ID, "uninstall_node", nil)
	}
	// Disconnect and remove from DB.
	h.NodeServer.DisconnectNode(id)
	if err := h.Store.SoftDeleteNode(r.Context(), orgID, id); err != nil {
		writeError(w, http.StatusInternalServerError, "delete")
		return
	}
	uid := middleware.UserID(r.Context())
	rid := strconv.FormatInt(id, 10)
	_ = h.Store.LogAudit(r.Context(), orgID, &uid, "uninstall", "node", &rid, "")
	writeJSON(w, http.StatusOK, map[string]any{"status": "uninstalled", "signal_sent": online})
}
