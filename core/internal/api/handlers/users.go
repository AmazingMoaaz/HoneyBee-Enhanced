package handlers

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/honeybee-enhanced/core/internal/api/middleware"
	"github.com/honeybee-enhanced/core/internal/store"
	"github.com/honeybee-enhanced/shared/models"
	"golang.org/x/crypto/bcrypt"
)

// maxAvatarBytes caps the inline (base64 data-URL) avatar size to keep user
// rows small — the dashboard resizes images well under this before upload.
const maxAvatarBytes = 256 * 1024

// UsersHandler handles /users (admin-only).
type UsersHandler struct {
	Store *store.Store
}

// NewUsersHandler constructs.
func NewUsersHandler(s *store.Store) *UsersHandler { return &UsersHandler{Store: s} }

// List users in org.
func (h *UsersHandler) List(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	users, err := h.Store.ListUsers(r.Context(), orgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list")
		return
	}
	writeJSON(w, http.StatusOK, users)
}

type createUserReq struct {
	Email    string      `json:"email"`
	Password string      `json:"password"`
	Name     string      `json:"name"`
	Role     models.Role `json:"role"`
	Avatar   string      `json:"avatar"`
}

// Create a new user in org.
func (h *UsersHandler) Create(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	var req createUserReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad json")
		return
	}
	if req.Role == "" {
		req.Role = models.RoleViewer
	}
	if req.Email == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "email and password required")
		return
	}
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}
	if !h.Store.RoleExists(r.Context(), orgID, string(req.Role)) {
		writeError(w, http.StatusBadRequest, "unknown role")
		return
	}
	if len(req.Avatar) > maxAvatarBytes {
		writeError(w, http.StatusBadRequest, "avatar too large")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash")
		return
	}
	id, err := h.Store.CreateUser(r.Context(), orgID, req.Email, string(hash), req.Name, req.Role, req.Avatar)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create")
		return
	}
	uid := middleware.UserID(r.Context())
	rid := strconv.FormatInt(id, 10)
	_ = h.Store.LogAudit(r.Context(), orgID, &uid, "user-create", "user", &rid, req.Email+" ("+string(req.Role)+")")
	writeJSON(w, http.StatusCreated, map[string]any{"id": id})
}

// Get returns a single user.
func (h *UsersHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	u, err := h.Store.GetUser(r.Context(), id)
	if err != nil || u.OrgID != middleware.OrgID(r.Context()) {
		writeError(w, http.StatusNotFound, "user")
		return
	}
	writeJSON(w, http.StatusOK, u)
}

type updateUserReq struct {
	Name   string      `json:"name"`
	Role   models.Role `json:"role"`
	Avatar *string     `json:"avatar"` // pointer: omitted = keep existing avatar
}

// Update updates name + role (+ avatar when provided).
func (h *UsersHandler) Update(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	var req updateUserReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad json")
		return
	}
	if req.Role != "" && !h.Store.RoleExists(r.Context(), orgID, string(req.Role)) {
		writeError(w, http.StatusBadRequest, "unknown role")
		return
	}
	if req.Avatar != nil && len(*req.Avatar) > maxAvatarBytes {
		writeError(w, http.StatusBadRequest, "avatar too large")
		return
	}
	// Snapshot the prior role so we can record an explicit role change in the
	// security audit trail (vs. an ordinary profile update).
	prev, _ := h.Store.GetUser(r.Context(), id)
	// Preserve the existing avatar unless a new one was explicitly sent.
	avatar := ""
	if prev != nil {
		avatar = prev.Avatar
	}
	if req.Avatar != nil {
		avatar = *req.Avatar
	}
	if err := h.Store.UpdateUser(r.Context(), orgID, id, req.Name, req.Role, avatar); err != nil {
		writeError(w, http.StatusInternalServerError, "update")
		return
	}
	uid := middleware.UserID(r.Context())
	rid := strconv.FormatInt(id, 10)
	action, details := "user-update", req.Name+" · "+string(req.Role)
	if prev != nil && prev.OrgID == orgID && req.Role != "" && prev.Role != req.Role {
		action = "user-role-change"
		details = string(prev.Role) + " → " + string(req.Role)
	}
	_ = h.Store.LogAudit(r.Context(), orgID, &uid, action, "user", &rid, details)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Delete removes a user.
func (h *UsersHandler) Delete(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	// Capture the email before deletion so the audit entry is meaningful.
	prev, _ := h.Store.GetUser(r.Context(), id)
	if err := h.Store.DeleteUser(r.Context(), orgID, id); err != nil {
		writeError(w, http.StatusInternalServerError, "delete")
		return
	}
	uid := middleware.UserID(r.Context())
	rid := strconv.FormatInt(id, 10)
	details := ""
	if prev != nil && prev.OrgID == orgID {
		details = prev.Email
	}
	_ = h.Store.LogAudit(r.Context(), orgID, &uid, "user-delete", "user", &rid, details)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
