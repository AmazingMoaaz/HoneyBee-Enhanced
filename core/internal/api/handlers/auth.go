package handlers

import (
	"context"
	"net/http"
	"regexp"
	"strings"

	"github.com/honeybee-enhanced/core/internal/api/middleware"
	"github.com/honeybee-enhanced/core/internal/config"
	"github.com/honeybee-enhanced/core/internal/store"
	"github.com/honeybee-enhanced/shared/models"
	"golang.org/x/crypto/bcrypt"
)

// AuthHandler handles register/login/refresh/logout.
type AuthHandler struct {
	Store *store.Store
	JWT   *middleware.JWTAuth
	Cfg   *config.Config
}

// NewAuthHandler constructs.
func NewAuthHandler(s *store.Store, jwt *middleware.JWTAuth, c *config.Config) *AuthHandler {
	return &AuthHandler{Store: s, JWT: jwt, Cfg: c}
}

type registerReq struct {
	OrgName  string `json:"org_name"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}
type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}
type tokenResp struct {
	AccessToken  string      `json:"access_token"`
	RefreshToken string      `json:"refresh_token"`
	UserID       int64       `json:"user_id"`
	OrgID        int64       `json:"org_id"`
	Role         models.Role `json:"role"`
	Email        string      `json:"email"`
	Name         string      `json:"name"`
	Permissions  []string    `json:"permissions"`
}

var slugRE = regexp.MustCompile(`[^a-z0-9-]+`)

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = slugRE.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = "org"
	}
	return s
}

// Register creates a new org + admin user. First registration becomes admin.
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req registerReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad json")
		return
	}
	if req.Email == "" || req.Password == "" || req.OrgName == "" {
		writeError(w, http.StatusBadRequest, "missing fields")
		return
	}
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}
	if existing, _ := h.Store.GetUserByEmail(r.Context(), req.Email); existing != nil {
		writeError(w, http.StatusConflict, "email exists")
		return
	}
	orgID, err := h.Store.CreateOrganization(r.Context(), req.OrgName, slugify(req.OrgName))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create org")
		return
	}
	// Seed the built-in roles for the new org before signing tokens.
	if err := h.Store.EnsureSystemRoles(r.Context(), orgID); err != nil {
		writeError(w, http.StatusInternalServerError, "seed roles")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash password")
		return
	}
	uid, err := h.Store.CreateUser(r.Context(), orgID, req.Email, string(hash), req.Name, models.RoleAdmin, "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create user")
		return
	}
	access, refresh, perms, err := h.signPair(r.Context(), uid, orgID, models.RoleAdmin)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "sign tokens")
		return
	}
	writeJSON(w, http.StatusCreated, tokenResp{
		AccessToken: access, RefreshToken: refresh,
		UserID: uid, OrgID: orgID, Role: models.RoleAdmin, Email: req.Email, Name: req.Name, Permissions: perms,
	})
}

// Login validates credentials.
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad json")
		return
	}
	u, err := h.Store.GetUserByEmail(r.Context(), req.Email)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.Password)); err != nil {
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	access, refresh, perms, err := h.signPair(r.Context(), u.ID, u.OrgID, u.Role)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "sign tokens")
		return
	}
	writeJSON(w, http.StatusOK, tokenResp{
		AccessToken: access, RefreshToken: refresh,
		UserID: u.ID, OrgID: u.OrgID, Role: u.Role, Email: u.Email, Name: u.Name, Permissions: perms,
	})
}

// Refresh exchanges a refresh token for a new access+refresh pair.
func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad json")
		return
	}
	c, err := h.JWT.Parse(req.RefreshToken)
	if err != nil || c.Subject != "refresh" {
		writeError(w, http.StatusUnauthorized, "invalid refresh token")
		return
	}
	// Reload the user so role changes (and the permissions they imply) take
	// effect on the next refresh rather than requiring a full re-login.
	role := c.Role
	email, name := "", ""
	if u, err := h.Store.GetUser(r.Context(), c.UserID); err == nil {
		role, email, name = u.Role, u.Email, u.Name
	}
	access, refresh, perms, err := h.signPair(r.Context(), c.UserID, c.OrgID, role)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "sign tokens")
		return
	}
	writeJSON(w, http.StatusOK, tokenResp{
		AccessToken: access, RefreshToken: refresh,
		UserID: c.UserID, OrgID: c.OrgID, Role: role, Email: email, Name: name, Permissions: perms,
	})
}

// Logout is a stub (stateless JWT).
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Me returns the currently authenticated user plus their effective permissions.
func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r.Context())
	u, err := h.Store.GetUser(r.Context(), uid)
	if err != nil {
		writeError(w, http.StatusNotFound, "user")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": u.ID, "org_id": u.OrgID, "email": u.Email, "name": u.Name,
		"role": u.Role, "avatar": u.Avatar, "created_at": u.CreatedAt, "updated_at": u.UpdatedAt,
		"permissions": h.Store.ResolvePerms(r.Context(), u.OrgID, string(u.Role)),
	})
}

func (h *AuthHandler) signPair(ctx context.Context, userID, orgID int64, role models.Role) (string, string, []string, error) {
	perms := h.Store.ResolvePerms(ctx, orgID, string(role))
	access, err := h.JWT.SignAccess(userID, orgID, role, perms, h.Cfg.JWT.AccessTTL.Duration)
	if err != nil {
		return "", "", nil, err
	}
	refresh, err := h.JWT.SignRefresh(userID, orgID, role, perms, h.Cfg.JWT.RefreshTTL.Duration)
	if err != nil {
		return "", "", nil, err
	}
	return access, refresh, perms, nil
}


