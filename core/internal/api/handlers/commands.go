package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/honeybee-enhanced/core/internal/api/middleware"
	"github.com/honeybee-enhanced/core/internal/nodeserver"
	"github.com/honeybee-enhanced/core/internal/store"
)

// CommandsHandler handles ad-hoc node commands and broadcast.
type CommandsHandler struct {
	Store      *store.Store
	NodeServer *nodeserver.Server
}

// NewCommandsHandler constructs.
func NewCommandsHandler(s *store.Store, ns *nodeserver.Server) *CommandsHandler {
	return &CommandsHandler{Store: s, NodeServer: ns}
}

type commandReq struct {
	Command string         `json:"command"`
	Payload map[string]any `json:"payload"`
}

// SendNodeCommand creates a task for a single node.
func (h *CommandsHandler) SendNodeCommand(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	nodeID, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if _, err := h.Store.GetNode(r.Context(), orgID, nodeID); err != nil {
		writeError(w, http.StatusNotFound, "node")
		return
	}
	var req commandReq
	if err := readJSON(r, &req); err != nil || req.Command == "" {
		writeError(w, http.StatusBadRequest, "missing command")
		return
	}
	body, _ := json.Marshal(req.Payload)
	taskID, err := h.Store.CreateTask(r.Context(), orgID, nodeID, nil, req.Command, string(body))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create task")
		return
	}
	if h.NodeServer.IsOnline(nodeID) {
		if err := h.NodeServer.SendToNode(nodeID, taskID, req.Command, req.Payload); err == nil {
			_ = h.Store.MarkTaskSent(r.Context(), taskID)
		}
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"task_id": taskID})
}

// Broadcast creates the same task for every online node in the org.
func (h *CommandsHandler) Broadcast(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	var req commandReq
	if err := readJSON(r, &req); err != nil || req.Command == "" {
		writeError(w, http.StatusBadRequest, "missing command")
		return
	}
	nodes, err := h.Store.ListNodes(r.Context(), orgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list nodes")
		return
	}
	body, _ := json.Marshal(req.Payload)
	tasks := make([]int64, 0, len(nodes))
	for _, n := range nodes {
		if !h.NodeServer.IsOnline(n.ID) {
			continue
		}
		taskID, err := h.Store.CreateTask(r.Context(), orgID, n.ID, nil, req.Command, string(body))
		if err != nil {
			continue
		}
		if err := h.NodeServer.SendToNode(n.ID, taskID, req.Command, req.Payload); err == nil {
			_ = h.Store.MarkTaskSent(r.Context(), taskID)
		}
		tasks = append(tasks, taskID)
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"task_ids": tasks, "count": len(tasks)})
}
