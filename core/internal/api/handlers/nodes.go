package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"net/url"
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
	// the request — preferring forwarded headers / Origin so going through the
	// Vite dev proxy (which rewrites Host to localhost:5100) still produces a
	// script that targets the real LAN address the operator opened.
	httpBase := h.Cfg.Server.PublicHTTPAddr
	if httpBase == "" {
		httpBase = scheme + "://" + resolvePublicHost(r)
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

$taskName = "HoneyBeeNode"
$BinDir   = "$env:LOCALAPPDATA\HoneyBeeNode"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
New-Item -ItemType Directory -Force -Path "$BinDir\data" | Out-Null

# Stop any already-running instance so we can overwrite the exe
Write-Host "[1/4] Stopping any existing HoneyBeeNode instance..."
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Stop-ScheduledTask  -TaskName $taskName -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
}
# Also stop any stray hb-node.exe processes
Get-Process -Name "hb-node" -ErrorAction SilentlyContinue | ForEach-Object { $_.Kill(); $_.WaitForExit(3000) }

# If the file is still locked (rare), stage the new binary next to it and swap after
$newExe = "$BinDir\hb-node-new.exe"
Write-Host "[2/4] Downloading honeybee-node (windows/$Arch)..."
Invoke-WebRequest "$HBServer/api/v1/download/node-agent?os=windows&arch=$Arch" -OutFile $newExe
# Swap: rename old → .old, new → hb-node.exe
if (Test-Path "$BinDir\hb-node.exe") {
    Remove-Item "$BinDir\hb-node.exe.old" -ErrorAction SilentlyContinue
    Rename-Item "$BinDir\hb-node.exe" "$BinDir\hb-node.exe.old" -ErrorAction SilentlyContinue
}
Rename-Item $newExe "$BinDir\hb-node.exe"

Write-Host "[3/4] Writing config..."
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

$exe  = "$BinDir\hb-node.exe"
$args = "--config " + '"' + "$BinDir\node.yaml" + '"'
$action   = New-ScheduledTaskAction -Execute $exe -Argument $args
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($isAdmin) {
    Write-Host "[4/4] Registering scheduled task (runs at startup as SYSTEM)..."
    $trigger   = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $taskName
    Write-Host "Done. Node '$NodeName' (ID $NodeID) is running as SYSTEM."
    Write-Host "      Manage: Get-ScheduledTask -TaskName HoneyBeeNode"
} else {
    Write-Host "[4/4] Registering scheduled task (runs at logon for current user)..."
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
// Prefers cfg.Server.NodePublicAddr; falls back to the resolved public host + node port.
func (h *NodesHandler) nodePublicAddr(r *http.Request) string {
	if h.Cfg.Server.NodePublicAddr != "" {
		return h.Cfg.Server.NodePublicAddr
	}
	hostport := resolvePublicHost(r)
	hostname := hostport
	if host, _, err := net.SplitHostPort(hostport); err == nil {
		hostname = host
	}
	_, port, _ := net.SplitHostPort(h.Cfg.Server.NodeAddr)
	if port == "" {
		port = "9001"
	}
	return net.JoinHostPort(hostname, port)
}

// resolvePublicHost returns the host:port to use in generated scripts.
// Priority:
//  1. X-Forwarded-Host header (set by our Vite proxy)
//  2. Origin / Referer headers (browser-set)
//  3. r.Host — but if that resolves to loopback/unspecified, swap the host
//     part for the machine's preferred outbound LAN IP so that install scripts
//     work even when the operator has the dashboard open at localhost.
func resolvePublicHost(r *http.Request) string {
	if fh := r.Header.Get("X-Forwarded-Host"); fh != "" {
		h := strings.TrimSpace(strings.Split(fh, ",")[0])
		if !isLoopbackHost(h) {
			return h
		}
	}
	for _, hdr := range []string{"Origin", "Referer"} {
		if v := r.Header.Get(hdr); v != "" {
			if u, err := url.Parse(v); err == nil && u.Host != "" && !isLoopbackHost(u.Host) {
				return u.Host
			}
		}
	}
	// Fall back to r.Host, but replace loopback/unspecified host with LAN IP.
	host := r.Host
	hostname, port, err := net.SplitHostPort(host)
	if err != nil {
		hostname = host
		port = ""
	}
	if isLoopbackHostname(hostname) {
		if lanIP := preferredLANIP(); lanIP != "" {
			hostname = lanIP
		}
	}
	if port != "" {
		return net.JoinHostPort(hostname, port)
	}
	return hostname
}

// isLoopbackHost reports whether a host:port (or bare host) is loopback/unspecified.
func isLoopbackHost(hostport string) bool {
	hostname := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		hostname = h
	}
	return isLoopbackHostname(hostname)
}

func isLoopbackHostname(hostname string) bool {
	if hostname == "localhost" || hostname == "" {
		return true
	}
	ip := net.ParseIP(hostname)
	return ip != nil && (ip.IsLoopback() || ip.IsUnspecified())
}

// preferredLANIP returns the machine's preferred outbound LAN IP by dialling
// an unreachable address (no actual packet is sent — UDP dial just routes).
func preferredLANIP() string {
	conn, err := net.Dial("udp4", "8.8.8.8:80")
	if err != nil {
		return ""
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).IP.String()
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
$ErrorActionPreference = 'SilentlyContinue'
$taskName = "HoneyBeeNode"
$BinDir   = "$env:LOCALAPPDATA\HoneyBeeNode"

# ── Already-uninstalled check ────────────────────────────────────────────────
$taskExists = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$binExists  = Test-Path "$BinDir\hb-node.exe"
if (-not $taskExists -and -not $binExists) {
    Write-Host "HoneyBeeNode is not installed on this device — nothing to do."
    exit 0
}
# ─────────────────────────────────────────────────────────────────────────────

Write-Host "[1/4] Stopping scheduled task..."
if ($taskExists) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Write-Host "      Task stopped."
} else {
    Write-Host "      No scheduled task found — skipping."
}

Write-Host "[2/4] Removing scheduled task..."
if ($taskExists) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "      Task removed."
} else {
    Write-Host "      No scheduled task found — skipping."
}

Write-Host "[3/4] Killing any remaining processes running from $BinDir..."
$procs = Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($BinDir, [System.StringComparison]::OrdinalIgnoreCase)
}
if ($procs) {
    $procs | ForEach-Object {
        Write-Host "      killing PID $($_.ProcessId) - $($_.ExecutablePath)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 800
} else {
    Write-Host "      No running processes found — skipping."
}

Write-Host "[4/4] Deleting files..."
if (Test-Path $BinDir) {
    Start-Sleep -Seconds 2
    Remove-Item -Recurse -Force $BinDir -ErrorAction SilentlyContinue
    if (Test-Path $BinDir) {
        Write-Host "      Warning: some files could not be deleted (may need a reboot)."
    } else {
        Write-Host "      Directory removed."
    }
} else {
    Write-Host "      Directory not found — skipping."
}

Write-Host "Done. HoneyBeeNode has been removed from this device."
`)
	} else {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprint(w, `#!/usr/bin/env bash
# HoneyBee-Enhanced node uninstall — Linux / macOS
set -euo pipefail

SERVICE=honeybee-node
BIN_DIR="$HOME/.honeybee"

# ── Already-uninstalled check ────────────────────────────────────────────────
task_exists=false
bin_exists=false
systemctl --user is-enabled "$SERVICE" &>/dev/null && task_exists=true || true
systemctl        is-enabled "$SERVICE" &>/dev/null && task_exists=true || true
[ -f "$BIN_DIR/hb-node" ] && bin_exists=true || true
[ -f /usr/local/bin/hb-node ] && bin_exists=true || true
if ! $task_exists && ! $bin_exists; then
  echo "HoneyBeeNode is not installed on this device — nothing to do."
  exit 0
fi
# ─────────────────────────────────────────────────────────────────────────────

echo "[1/3] Stopping service..."
if systemctl --user is-active --quiet "$SERVICE" 2>/dev/null; then
  systemctl --user stop "$SERVICE"
  echo "      User service stopped."
elif systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
  sudo systemctl stop "$SERVICE"
  echo "      System service stopped."
else
  echo "      Service not running — skipping."
fi
pkill -f "hb-node" 2>/dev/null && echo "      Stray process killed." || true

echo "[2/3] Removing service unit..."
systemctl --user disable "$SERVICE" 2>/dev/null && echo "      User unit disabled." || true
rm -f "$HOME/.config/systemd/user/${SERVICE}.service"
systemctl --user daemon-reload 2>/dev/null || true
sudo systemctl disable "$SERVICE" 2>/dev/null && echo "      System unit disabled." || true
sudo rm -f "/etc/systemd/system/${SERVICE}.service"
sudo systemctl daemon-reload 2>/dev/null || true

echo "[3/3] Deleting files..."
if [ -d "$BIN_DIR" ]; then
  rm -rf "$BIN_DIR"
  echo "      $BIN_DIR removed."
else
  echo "      $BIN_DIR not found — skipping."
fi
if [ -f /usr/local/bin/hb-node ]; then
  sudo rm -f /usr/local/bin/hb-node
  echo "      /usr/local/bin/hb-node removed."
fi

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
