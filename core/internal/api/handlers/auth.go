package handlers

import (
	"errors"
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
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash password")
		return
	}
	uid, err := h.Store.CreateUser(r.Context(), orgID, req.Email, string(hash), req.Name, models.RoleAdmin)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create user")
		return
	}
	access, refresh, err := h.signPair(uid, orgID, models.RoleAdmin)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "sign tokens")
		return
	}
	writeJSON(w, http.StatusCreated, tokenResp{
		AccessToken: access, RefreshToken: refresh,
		UserID: uid, OrgID: orgID, Role: models.RoleAdmin, Email: req.Email, Name: req.Name,
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
	access, refresh, err := h.signPair(u.ID, u.OrgID, u.Role)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "sign tokens")
		return
	}
	writeJSON(w, http.StatusOK, tokenResp{
		AccessToken: access, RefreshToken: refresh,
		UserID: u.ID, OrgID: u.OrgID, Role: u.Role, Email: u.Email, Name: u.Name,
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
	access, refresh, err := h.signPair(c.UserID, c.OrgID, c.Role)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "sign tokens")
		return
	}
	writeJSON(w, http.StatusOK, tokenResp{
		AccessToken: access, RefreshToken: refresh,
		UserID: c.UserID, OrgID: c.OrgID, Role: c.Role,
	})
}

// Logout is a stub (stateless JWT).
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Me returns the currently authenticated user.
func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	uid := middleware.UserID(r.Context())
	u, err := h.Store.GetUser(r.Context(), uid)
	if err != nil {
		writeError(w, http.StatusNotFound, "user")
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func (h *AuthHandler) signPair(userID, orgID int64, role models.Role) (string, string, error) {
	access, err := h.JWT.SignAccess(userID, orgID, role, h.Cfg.JWT.AccessTTL)
	if err != nil {
		return "", "", err
	}
	refresh, err := h.JWT.SignRefresh(userID, orgID, role, h.Cfg.JWT.RefreshTTL)
	if err != nil {
		return "", "", err
	}
	return access, refresh, nil
}

// _ avoids unused import
var _ = errors.New
