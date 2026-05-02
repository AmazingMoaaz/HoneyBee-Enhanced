package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
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

	host := r.Host
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	switch platform {
	case "ps", "powershell", "windows":
		fmt.Fprintf(w, `# HoneyBee-Enhanced node install (Windows)
$NodeID    = "%d"
$NodeName  = "%s"
$NodeToken = "%s"
$Server    = "http://%s"
$BinDir    = "$env:LOCALAPPDATA\HoneyBeeNode"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
Invoke-WebRequest "$Server/api/v1/download/node-agent?os=windows&arch=amd64" -OutFile "$BinDir\hb-node.exe"
@"
node:
  name: "$NodeName"
server:
  address: "%s"
  token: "$NodeToken"
"@ | Set-Content "$BinDir\node.yaml"
Start-Process "$BinDir\hb-node.exe" -ArgumentList "--config","$BinDir\node.yaml"
`, n.ID, n.Name, rawToken, host, h.Cfg.Server.NodeAddr)
	default:
		fmt.Fprintf(w, `#!/usr/bin/env bash
# HoneyBee-Enhanced node install (Linux/macOS)
set -e
NODE_ID="%d"
NODE_NAME="%s"
NODE_TOKEN="%s"
SERVER="http://%s"
BIN_DIR="$HOME/.honeybee/bin"
mkdir -p "$BIN_DIR"
curl -fsSL "$SERVER/api/v1/download/node-agent?os=linux&arch=amd64" -o "$BIN_DIR/hb-node"
chmod +x "$BIN_DIR/hb-node"
mkdir -p "$HOME/.honeybee"
cat > "$HOME/.honeybee/node.yaml" <<EOF
node:
  name: "$NODE_NAME"
server:
  address: "%s"
  token: "$NODE_TOKEN"
EOF
nohup "$BIN_DIR/hb-node" --config "$HOME/.honeybee/node.yaml" > "$HOME/.honeybee/node.log" 2>&1 &
echo "Node $NODE_NAME ($NODE_ID) installed; logs: $HOME/.honeybee/node.log"
`, n.ID, n.Name, rawToken, host, h.Cfg.Server.NodeAddr)
	}
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
