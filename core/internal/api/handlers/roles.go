package handlers

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/honeybee-enhanced/core/internal/api/middleware"
	"github.com/honeybee-enhanced/core/internal/store"
	"github.com/honeybee-enhanced/shared/models"
)

// RolesHandler handles /roles (requires users.manage).
type RolesHandler struct {
	Store *store.Store
}

// NewRolesHandler constructs.
func NewRolesHandler(s *store.Store) *RolesHandler { return &RolesHandler{Store: s} }

// Catalog returns the full list of assignable permissions for the role builder.
func (h *RolesHandler) Catalog(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, models.PermissionCatalog)
}

// List returns all roles (built-in + custom) for the org, ensuring the
// built-in roles exist first.
func (h *RolesHandler) List(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	_ = h.Store.EnsureSystemRoles(r.Context(), orgID)
	roles, err := h.Store.ListRoles(r.Context(), orgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list roles")
		return
	}
	writeJSON(w, http.StatusOK, roles)
}

type roleReq struct {
	Name        string   `json:"name"`
	Color       string   `json:"color"`
	Permissions []string `json:"permissions"`
}

// Create adds a custom role.
func (h *RolesHandler) Create(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	var req roleReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad json")
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		writeError(w, http.StatusBadRequest, "name required")
		return
	}
	role, err := h.Store.CreateRole(r.Context(), orgID, strings.TrimSpace(req.Name), req.Color, req.Permissions)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create role")
		return
	}
	uid := middleware.UserID(r.Context())
	rid := strconv.FormatInt(role.ID, 10)
	_ = h.Store.LogAudit(r.Context(), orgID, &uid, "role-create", "role", &rid, role.Name)
	writeJSON(w, http.StatusCreated, role)
}

// Update edits a custom role.
func (h *RolesHandler) Update(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	var req roleReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad json")
		return
	}
	if err := h.Store.UpdateRole(r.Context(), orgID, id, strings.TrimSpace(req.Name), req.Color, req.Permissions); err != nil {
		if errors.Is(err, store.ErrSystemRole) {
			writeError(w, http.StatusBadRequest, "built-in roles cannot be edited")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "role")
			return
		}
		writeError(w, http.StatusInternalServerError, "update role")
		return
	}
	uid := middleware.UserID(r.Context())
	rid := strconv.FormatInt(id, 10)
	_ = h.Store.LogAudit(r.Context(), orgID, &uid, "role-update", "role", &rid, strings.TrimSpace(req.Name))
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Delete removes a custom role (must be unused and non-built-in).
func (h *RolesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.OrgID(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	role, _ := h.Store.GetRole(r.Context(), orgID, id)
	if err := h.Store.DeleteRole(r.Context(), orgID, id); err != nil {
		switch {
		case errors.Is(err, store.ErrSystemRole):
			writeError(w, http.StatusBadRequest, "built-in roles cannot be deleted")
		case errors.Is(err, store.ErrRoleInUse):
			writeError(w, http.StatusConflict, "role is still assigned to users")
		case errors.Is(err, store.ErrNotFound):
			writeError(w, http.StatusNotFound, "role")
		default:
			writeError(w, http.StatusInternalServerError, "delete role")
		}
		return
	}
	uid := middleware.UserID(r.Context())
	rid := strconv.FormatInt(id, 10)
	name := ""
	if role != nil {
		name = role.Name
	}
	_ = h.Store.LogAudit(r.Context(), orgID, &uid, "role-delete", "role", &rid, name)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
