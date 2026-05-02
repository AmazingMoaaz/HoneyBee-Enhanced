package handlers

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/honeybee-enhanced/core/internal/api/middleware"
	"github.com/honeybee-enhanced/core/internal/store"
)

// SessionsHandler handles /sessions/*.
type SessionsHandler struct {
	Store *store.Store
}

// NewSessionsHandler constructs.
func NewSessionsHandler(s *store.Store) *SessionsHandler {
	return &SessionsHandler{Store: s}
}

// List returns session metadata, paginated.
func (h *SessionsHandler) List(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	nodeID := queryInt64(r, "node_id", 0)
	potID := r.URL.Query().Get("pot_id")
	srcIP := r.URL.Query().Get("src_ip")
	limit := queryInt(r, "limit", 100)
	offset := queryInt(r, "offset", 0)
	out, err := h.Store.ListSessions(r.Context(), orgID, nodeID, potID, srcIP, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// Get returns one session's metadata.
func (h *SessionsHandler) Get(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	sess, err := h.Store.GetSession(r.Context(), orgID, id)
	if err != nil {
		writeError(w, http.StatusNotFound, "session")
		return
	}
	writeJSON(w, http.StatusOK, sess)
}

// Replay returns ordered chunks for xterm.js playback.
func (h *SessionsHandler) Replay(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	sess, err := h.Store.GetSession(r.Context(), orgID, id)
	if err != nil {
		writeError(w, http.StatusNotFound, "session")
		return
	}
	chunks, err := h.Store.GetSessionChunks(r.Context(), sess.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "chunks")
		return
	}
	type chunkOut struct {
		Sequence int64  `json:"sequence"`
		DataB64  string `json:"data_b64"`
	}
	out := make([]chunkOut, len(chunks))
	for i, c := range chunks {
		out[i] = chunkOut{Sequence: c.Sequence, DataB64: base64.StdEncoding.EncodeToString(c.RawData)}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"session": sess,
		"chunks":  out,
	})
}

// _ unused
var _ = json.Marshal
