package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/honeybee-enhanced/core/internal/api/middleware"
	"github.com/honeybee-enhanced/core/internal/nodeserver"
	"github.com/honeybee-enhanced/core/internal/potstore"
	"github.com/honeybee-enhanced/core/internal/store"
	"github.com/honeybee-enhanced/shared/protocol"
)

// DeploymentsHandler handles /deployments and /nodes/{id}/deployments.
type DeploymentsHandler struct {
	Store      *store.Store
	NodeServer *nodeserver.Server
	PotStore   *potstore.Client
}

// NewDeploymentsHandler constructs.
func NewDeploymentsHandler(s *store.Store, ns *nodeserver.Server, ps *potstore.Client) *DeploymentsHandler {
	return &DeploymentsHandler{Store: s, NodeServer: ns, PotStore: ps}
}

// List returns deployments for the org with optional filters.
func (h *DeploymentsHandler) List(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	nodeID := queryInt64(r, "node_id", 0)
	status := r.URL.Query().Get("status")
	deps, err := h.Store.ListDeployments(r.Context(), orgID, nodeID, status)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list")
		return
	}
	writeJSON(w, http.StatusOK, deps)
}

type deployReq struct {
	PotID        string         `json:"pot_id"` // optional — auto-generated per node when blank
	HoneypotType string         `json:"honeypot_type"`
	Config       map[string]any `json:"config"`
	AutoStart    bool           `json:"auto_start"`
}

// CreateForNode deploys a honeypot on a node.
func (h *DeploymentsHandler) CreateForNode(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	nodeID, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if _, err := h.Store.GetNode(r.Context(), orgID, nodeID); err != nil {
		writeError(w, http.StatusNotFound, "node")
		return
	}
	var req deployReq
	if err := readJSON(r, &req); err != nil || req.HoneypotType == "" {
		writeError(w, http.StatusBadRequest, "missing fields")
		return
	}
	entry, ok := h.PotStore.Lookup(req.HoneypotType)
	if !ok {
		writeError(w, http.StatusBadRequest, "unknown honeypot type")
		return
	}
	// Auto-generate per-node sequential pot_id when client doesn't supply one.
	if req.PotID == "" {
		next, err := h.Store.NextPotIDForNode(r.Context(), nodeID, req.HoneypotType)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "alloc pot id")
			return
		}
		req.PotID = next
	}
	cfgBytes, err := json.Marshal(req.Config)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid config json")
		return
	}
	depID, err := h.Store.CreateDeployment(r.Context(), orgID, nodeID, req.PotID, req.HoneypotType, string(cfgBytes))
	if err != nil {
		if errors.Is(err, store.ErrDuplicatePotID) {
			writeError(w, http.StatusConflict, "a deployment with pot_id '"+req.PotID+"' already exists on this node — pick a different ID or remove the existing one")
			return
		}
		writeError(w, http.StatusInternalServerError, "create")
		return
	}
	payload := protocol.InstallPotPayload{
		PotID:        req.PotID,
		HoneypotType: req.HoneypotType,
		GitURL:       entry.GitURL,
		GitBranch:    entry.GitBranch,
		Entrypoint:   entry.EntryPoint,
		InstallCmds:  entry.InstallCmd,
		RunCmd:       entry.RunCmd,
		Subdir:       entry.Subdir,
		Config:       req.Config,
		AutoStart:    req.AutoStart,
	}
	if err := h.queueAndSend(r, orgID, nodeID, &depID, protocol.CmdInstallPot, payload); err != nil {
		writeError(w, http.StatusInternalServerError, "queue task")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"deployment_id": depID, "pot_id": req.PotID})
}

// Action covers start/stop/restart/remove on a deployment.
func (h *DeploymentsHandler) Action(action string) http.HandlerFunc {
	cmd := map[string]string{
		"start":   protocol.CmdStartPot,
		"stop":    protocol.CmdStopPot,
		"restart": protocol.CmdRestartPot,
		"remove":  protocol.CmdRemovePot,
	}[action]
	return func(w http.ResponseWriter, r *http.Request) {
		orgID := middleware.OrgID(r.Context())
		id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
		dep, err := h.Store.GetDeployment(r.Context(), orgID, id)
		if err != nil {
			writeError(w, http.StatusNotFound, "deployment")
			return
		}
		payload := protocol.PotControlPayload{PotID: dep.PotID}
		if err := h.queueAndSend(r, orgID, dep.NodeID, &dep.ID, cmd, payload); err != nil {
			writeError(w, http.StatusInternalServerError, "queue task")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "queued"})
	}
}

// UpdateConfig pushes a new config + queues update_config task.
func (h *DeploymentsHandler) UpdateConfig(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	dep, err := h.Store.GetDeployment(r.Context(), orgID, id)
	if err != nil {
		writeError(w, http.StatusNotFound, "deployment")
		return
	}
	var cfg map[string]any
	if err := readJSON(r, &cfg); err != nil {
		writeError(w, http.StatusBadRequest, "bad json")
		return
	}
	cfgBytes, err := json.Marshal(cfg)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid config")
		return
	}
	if err := h.Store.UpdateDeploymentConfig(r.Context(), orgID, id, string(cfgBytes)); err != nil {
		writeError(w, http.StatusInternalServerError, "update config")
		return
	}
	payload := protocol.UpdateConfigPayload{PotID: dep.PotID, Config: cfg}
	if err := h.queueAndSend(r, orgID, dep.NodeID, &dep.ID, protocol.CmdUpdateConfig, payload); err != nil {
		writeError(w, http.StatusInternalServerError, "queue task")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Delete removes a deployment record from the DB without sending any node command.
// Use for stale failed/pending records where no node-side cleanup is needed.
func (h *DeploymentsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err := h.Store.DeleteDeployment(r.Context(), orgID, id); err != nil {
		writeError(w, http.StatusInternalServerError, "delete deployment")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// Cleanup bulk-deletes all failed and pending deployment records from the DB.
// Accepts optional JSON body {"statuses": ["failed","pending"]} to control which
// statuses are purged; defaults to failed + pending + stopped.
func (h *DeploymentsHandler) Cleanup(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	statuses := []string{"failed", "pending", "stopped"}
	var body struct {
		Statuses []string `json:"statuses"`
	}
	if err := readJSON(r, &body); err == nil && len(body.Statuses) > 0 {
		statuses = body.Statuses
	}
	n, err := h.Store.DeleteDeploymentsByStatus(r.Context(), orgID, statuses)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "cleanup deployments")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": n, "statuses": statuses})
}

// Logs returns paginated pot_logs for a deployment, in chronological order.
func (h *DeploymentsHandler) Logs(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	// Verify deployment belongs to this org.
	if _, err := h.Store.GetDeployment(r.Context(), orgID, id); err != nil {
		writeError(w, http.StatusNotFound, "deployment")
		return
	}
	limit := queryInt(r, "limit", 500)
	offset := queryInt(r, "offset", 0)
	logs, err := h.Store.ListPotLogsByDeployment(r.Context(), id, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list logs")
		return
	}
	writeJSON(w, http.StatusOK, logs)
}

// RequestMetrics queues a get_pot_metrics task; client polls via WS.
func (h *DeploymentsHandler) RequestMetrics(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	dep, err := h.Store.GetDeployment(r.Context(), orgID, id)
	if err != nil {
		writeError(w, http.StatusNotFound, "deployment")
		return
	}
	payload := protocol.PotControlPayload{PotID: dep.PotID}
	taskID, err := h.queueAndSendReturnID(r, orgID, dep.NodeID, &dep.ID, protocol.CmdGetPotMetrics, payload)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "queue task")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"task_id": taskID})
}

func (h *DeploymentsHandler) queueAndSend(r *http.Request, orgID, nodeID int64, depID *int64, cmd string, payload any) error {
	_, err := h.queueAndSendReturnID(r, orgID, nodeID, depID, cmd, payload)
	return err
}

func (h *DeploymentsHandler) queueAndSendReturnID(r *http.Request, orgID, nodeID int64, depID *int64, cmd string, payload any) (int64, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return 0, err
	}
	taskID, err := h.Store.CreateTask(r.Context(), orgID, nodeID, depID, cmd, string(body))
	if err != nil {
		return 0, err
	}
	if h.NodeServer.IsOnline(nodeID) {
		if err := h.NodeServer.SendToNode(nodeID, taskID, cmd, payload); err == nil {
			_ = h.Store.MarkTaskSent(r.Context(), taskID)
		}
	}
	return taskID, nil
}
