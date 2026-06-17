// Package middleware contains HTTP middleware (auth, rbac, ratelimit, cors).
package middleware

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/honeybee-enhanced/shared/models"
)

type ctxKey string

const (
	ctxUserID ctxKey = "uid"
	ctxOrgID  ctxKey = "oid"
	ctxRole   ctxKey = "role"
	ctxPerms  ctxKey = "perms"
)

// Claims is the JWT claims structure.
type Claims struct {
	UserID int64       `json:"uid"`
	OrgID  int64       `json:"oid"`
	Role   models.Role `json:"role"`
	Perms  []string    `json:"perms,omitempty"`
	jwt.RegisteredClaims
}

// JWTAuth validates the bearer token and stores claims in context.
type JWTAuth struct {
	Secret []byte
}

// NewJWTAuth constructs middleware.
func NewJWTAuth(secret string) *JWTAuth {
	return &JWTAuth{Secret: []byte(secret)}
}

// SignAccess signs a short-lived access token carrying the user's permissions.
func (j *JWTAuth) SignAccess(userID, orgID int64, role models.Role, perms []string, ttl time.Duration) (string, error) {
	return j.sign(userID, orgID, role, perms, ttl, "access")
}

// SignRefresh signs a long-lived refresh token.
func (j *JWTAuth) SignRefresh(userID, orgID int64, role models.Role, perms []string, ttl time.Duration) (string, error) {
	return j.sign(userID, orgID, role, perms, ttl, "refresh")
}

func (j *JWTAuth) sign(userID, orgID int64, role models.Role, perms []string, ttl time.Duration, sub string) (string, error) {
	c := Claims{
		UserID: userID,
		OrgID:  orgID,
		Role:   role,
		Perms:  perms,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   sub,
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(j.Secret)
}

// Parse validates a token string and returns the claims.
func (j *JWTAuth) Parse(tokenStr string) (*Claims, error) {
	tok, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("bad signing method")
		}
		return j.Secret, nil
	})
	if err != nil {
		return nil, err
	}
	c, ok := tok.Claims.(*Claims)
	if !ok || !tok.Valid {
		return nil, errors.New("invalid claims")
	}
	return c, nil
}

// Middleware enforces JWT presence and validity on protected routes.
func (j *JWTAuth) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := extractToken(r)
		if token == "" {
			http.Error(w, "missing token", http.StatusUnauthorized)
			return
		}
		c, err := j.Parse(token)
		if err != nil {
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}
		if c.Subject != "access" {
			http.Error(w, "wrong token type", http.StatusUnauthorized)
			return
		}
		ctx := WithClaims(r.Context(), c)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func extractToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	return r.URL.Query().Get("token")
}

// WithClaims stores claims in a context.
func WithClaims(ctx context.Context, c *Claims) context.Context {
	ctx = context.WithValue(ctx, ctxUserID, c.UserID)
	ctx = context.WithValue(ctx, ctxOrgID, c.OrgID)
	ctx = context.WithValue(ctx, ctxRole, c.Role)
	ctx = context.WithValue(ctx, ctxPerms, c.Perms)
	return ctx
}

// UserID returns the authenticated user ID.
func UserID(ctx context.Context) int64 { v, _ := ctx.Value(ctxUserID).(int64); return v }

// OrgID returns the authenticated org ID.
func OrgID(ctx context.Context) int64 { v, _ := ctx.Value(ctxOrgID).(int64); return v }

// Role returns the user role.
func Role(ctx context.Context) models.Role { v, _ := ctx.Value(ctxRole).(models.Role); return v }

// Perms returns the permission keys carried by the access token.
func Perms(ctx context.Context) []string { v, _ := ctx.Value(ctxPerms).([]string); return v }

// HasPerm reports whether the request is allowed to perform perm. The built-in
// admin role implicitly holds every permission.
func HasPerm(ctx context.Context, perm string) bool {
	if Role(ctx) == models.RoleAdmin {
		return true
	}
	for _, p := range Perms(ctx) {
		if p == perm {
			return true
		}
	}
	return false
}
