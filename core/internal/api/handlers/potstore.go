package handlers

import (
	"net/http"

	"github.com/honeybee-enhanced/core/internal/potstore"
)

// PotStoreHandler handles /potstore.
type PotStoreHandler struct {
	Client *potstore.Client
}

// NewPotStoreHandler constructs.
func NewPotStoreHandler(c *potstore.Client) *PotStoreHandler {
	return &PotStoreHandler{Client: c}
}

// List returns the catalog.
func (h *PotStoreHandler) List(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"pots":         h.Client.List(),
		"coming_soon":  h.Client.ListComingSoon(),
		"last_updated": h.Client.LastUpdated(),
	})
}

// Sync triggers a manual re-sync.
func (h *PotStoreHandler) Sync(w http.ResponseWriter, r *http.Request) {
	if err := h.Client.Sync(r.Context()); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "count": len(h.Client.List())})
}
