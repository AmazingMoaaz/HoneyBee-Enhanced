package handlers

import (
	"net/http"
	"time"

	"github.com/honeybee-enhanced/core/internal/api/middleware"
	"github.com/honeybee-enhanced/core/internal/store"
)

// EventsHandler handles /events.
type EventsHandler struct {
	Store *store.Store
}

// NewEventsHandler constructs.
func NewEventsHandler(s *store.Store) *EventsHandler {
	return &EventsHandler{Store: s}
}

// List returns paginated, filtered events.
func (h *EventsHandler) List(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	f := store.EventFilter{
		NodeID:    queryInt64(r, "node_id", 0),
		PotID:     r.URL.Query().Get("pot_id"),
		EventType: r.URL.Query().Get("event_type"),
		SourceIP:  r.URL.Query().Get("source_ip"),
		Limit:     queryInt(r, "limit", 100),
		Offset:    queryInt(r, "offset", 0),
	}
	if v := r.URL.Query().Get("start_time"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			f.Start = &t
		}
	}
	if v := r.URL.Query().Get("end_time"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			f.End = &t
		}
	}
	events, err := h.Store.ListEvents(r.Context(), orgID, f)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list")
		return
	}
	writeJSON(w, http.StatusOK, events)
}

// Stats returns aggregate stats for org.
func (h *EventsHandler) Stats(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	total, _ := h.Store.CountEvents(r.Context(), orgID)
	byType, _ := h.Store.TopEventTypes(r.Context(), orgID, 10)
	byIP, _ := h.Store.TopAttackerIPs(r.Context(), orgID, 10)
	timeline, _ := h.Store.EventTimelineHourly(r.Context(), orgID, 24)
	uniqueIPs, _ := h.Store.CountUniqueIPs(r.Context(), orgID)
	writeJSON(w, http.StatusOK, map[string]any{
		"total_events": total,
		"unique_ips":   uniqueIPs,
		"by_type":      byType,
		"by_ip":        byIP,
		"timeline":     timeline,
	})
}
