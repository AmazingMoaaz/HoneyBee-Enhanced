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
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash")
		return
	}
	id, err := h.Store.CreateUser(r.Context(), orgID, req.Email, string(hash), req.Name, req.Role)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create")
		return
	}
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
	Name string      `json:"name"`
	Role models.Role `json:"role"`
}

// Update updates name + role.
func (h *UsersHandler) Update(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	var req updateUserReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad json")
		return
	}
	if err := h.Store.UpdateUser(r.Context(), orgID, id, req.Name, req.Role); err != nil {
		writeError(w, http.StatusInternalServerError, "update")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Delete removes a user.
func (h *UsersHandler) Delete(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err := h.Store.DeleteUser(r.Context(), orgID, id); err != nil {
		writeError(w, http.StatusInternalServerError, "delete")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
