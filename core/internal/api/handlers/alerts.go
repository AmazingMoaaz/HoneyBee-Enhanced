package handlers

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/honeybee-enhanced/core/internal/api/middleware"
	"github.com/honeybee-enhanced/core/internal/api/ws"
	"github.com/honeybee-enhanced/core/internal/store"
	"github.com/honeybee-enhanced/shared/models"
)

// AlertsHandler handles /alerts and /alert-rules endpoints.
type AlertsHandler struct {
	Store       *store.Store
	Broadcaster ws.Broadcaster
}

// NewAlertsHandler constructs.
func NewAlertsHandler(s *store.Store, b ws.Broadcaster) *AlertsHandler {
	return &AlertsHandler{Store: s, Broadcaster: b}
}

// ListAlerts returns alerts with optional filters.
func (h *AlertsHandler) ListAlerts(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	severity := r.URL.Query().Get("severity")
	acked := r.URL.Query().Get("acknowledged")
	limit := queryInt(r, "limit", 50)
	offset := queryInt(r, "offset", 0)
	alerts, err := h.Store.ListAlerts(r.Context(), orgID, severity, acked, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list alerts")
		return
	}
	writeJSON(w, http.StatusOK, alerts)
}

// CountUnacknowledged returns the count of unacknowledged alerts.
func (h *AlertsHandler) CountUnacknowledged(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	n, _ := h.Store.CountUnacknowledgedAlerts(r.Context(), orgID)
	writeJSON(w, http.StatusOK, map[string]int64{"count": n})
}

// Acknowledge marks an alert as acknowledged.
func (h *AlertsHandler) Acknowledge(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	uid := middleware.UserID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err := h.Store.AcknowledgeAlert(r.Context(), orgID, id, uid); err != nil {
		writeError(w, http.StatusInternalServerError, "acknowledge")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "acknowledged"})
}

// DeleteAlert removes an alert.
func (h *AlertsHandler) DeleteAlert(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err := h.Store.DeleteAlert(r.Context(), orgID, id); err != nil {
		writeError(w, http.StatusInternalServerError, "delete alert")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// CreateAlert creates a manual alert (used by admins or webhook integrations).
func (h *AlertsHandler) CreateAlert(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	var req struct {
		Severity  string `json:"severity"`
		Title     string `json:"title"`
		Message   string `json:"message"`
		Source    string `json:"source"`
		SourceRef string `json:"source_ref"`
	}
	if err := readJSON(r, &req); err != nil || req.Title == "" {
		writeError(w, http.StatusBadRequest, "missing fields")
		return
	}
	if req.Severity == "" {
		req.Severity = "medium"
	}
	alert := &models.Alert{
		OrgID:    orgID,
		Severity: models.AlertSeverity(req.Severity),
		Title:    req.Title,
		Message:  req.Message,
		Source:   req.Source,
		SourceRef: req.SourceRef,
	}
	id, err := h.Store.CreateAlert(r.Context(), alert)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create alert")
		return
	}
	if h.Broadcaster != nil {
		h.Broadcaster.Broadcast(orgID, "alerts", "alert_new", alert)
	}
	writeJSON(w, http.StatusCreated, map[string]int64{"id": id})
}

// --- Alert Rules ---

// ListRules returns all alert rules for the org.
func (h *AlertsHandler) ListRules(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	rules, err := h.Store.ListAlertRules(r.Context(), orgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list rules")
		return
	}
	writeJSON(w, http.StatusOK, rules)
}

// CreateRule creates a new alert rule.
func (h *AlertsHandler) CreateRule(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	var req models.AlertRule
	if err := readJSON(r, &req); err != nil || req.Name == "" {
		writeError(w, http.StatusBadRequest, "missing fields")
		return
	}
	req.OrgID = orgID
	id, err := h.Store.CreateAlertRule(r.Context(), &req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create rule")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]int64{"id": id})
}

// UpdateRule updates an existing alert rule.
func (h *AlertsHandler) UpdateRule(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	var req models.AlertRule
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad json")
		return
	}
	req.ID = id
	req.OrgID = orgID
	if err := h.Store.UpdateAlertRule(r.Context(), &req); err != nil {
		writeError(w, http.StatusInternalServerError, "update rule")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// DeleteRule removes an alert rule.
func (h *AlertsHandler) DeleteRule(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err := h.Store.DeleteAlertRule(r.Context(), orgID, id); err != nil {
		writeError(w, http.StatusInternalServerError, "delete rule")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
