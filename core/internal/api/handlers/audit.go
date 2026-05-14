package handlers

import (
	"net/http"

	"github.com/honeybee-enhanced/core/internal/api/middleware"
	"github.com/honeybee-enhanced/core/internal/store"
)

// AuditHandler handles /audit-log endpoints.
type AuditHandler struct {
	Store *store.Store
}

// NewAuditHandler constructs.
func NewAuditHandler(s *store.Store) *AuditHandler {
	return &AuditHandler{Store: s}
}

// List returns paginated audit entries.
func (h *AuditHandler) List(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	limit := queryInt(r, "limit", 100)
	entries, err := h.Store.ListAudit(r.Context(), orgID, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list audit")
		return
	}
	writeJSON(w, http.StatusOK, entries)
}
