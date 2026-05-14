package handlers

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/honeybee-enhanced/core/internal/api/middleware"
	"github.com/honeybee-enhanced/core/internal/store"
)

// AnalyticsHandler serves advanced analytics endpoints.
type AnalyticsHandler struct {
	Store *store.Store
}

// NewAnalyticsHandler constructs.
func NewAnalyticsHandler(s *store.Store) *AnalyticsHandler {
	return &AnalyticsHandler{Store: s}
}

// Overview returns a comprehensive analytics summary.
func (h *AnalyticsHandler) Overview(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	hours := queryInt(r, "hours", 24)

	total, _ := h.Store.CountEvents(r.Context(), orgID)
	uniqueIPs, _ := h.Store.CountUniqueIPs(r.Context(), orgID)
	byType, _ := h.Store.TopEventTypes(r.Context(), orgID, 20)
	byIP, _ := h.Store.TopAttackerIPs(r.Context(), orgID, 20)
	timeline, _ := h.Store.EventTimelineHourly(r.Context(), orgID, hours)
	byPort, _ := h.Store.TopTargetedPorts(r.Context(), orgID, 15)
	byPot, _ := h.Store.EventsByPot(r.Context(), orgID, 20)
	hourlyHeatmap, _ := h.Store.EventHourlyHeatmap(r.Context(), orgID)

	writeJSON(w, http.StatusOK, map[string]any{
		"total_events":   total,
		"unique_ips":     uniqueIPs,
		"by_type":        byType,
		"by_ip":          byIP,
		"timeline":       timeline,
		"by_port":        byPort,
		"by_pot":         byPot,
		"hourly_heatmap": hourlyHeatmap,
	})
}

// NodeMetrics returns performance metrics for a specific node.
func (h *AnalyticsHandler) NodeMetrics(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	nodeID, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	hours := queryInt(r, "hours", 1)

	// Verify the node belongs to this org
	if _, err := h.Store.GetNode(r.Context(), orgID, nodeID); err != nil {
		writeError(w, http.StatusNotFound, "node")
		return
	}

	metrics, err := h.Store.ListNodeMetrics(r.Context(), nodeID, hours)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "metrics")
		return
	}

	latest, _ := h.Store.LatestNodeMetric(r.Context(), nodeID)

	writeJSON(w, http.StatusOK, map[string]any{
		"latest":  latest,
		"history": metrics,
	})
}
