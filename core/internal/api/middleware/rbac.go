package middleware

import (
	"net/http"

	"github.com/honeybee-enhanced/shared/models"
)

// RequireRole returns middleware that allows the request only if the user role is in allowed.
func RequireRole(allowed ...models.Role) func(http.Handler) http.Handler {
	allowSet := make(map[models.Role]struct{}, len(allowed))
	for _, r := range allowed {
		allowSet[r] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			role := Role(r.Context())
			if _, ok := allowSet[role]; !ok {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireAdmin is shorthand for admin-only routes.
func RequireAdmin(next http.Handler) http.Handler {
	return RequireRole(models.RoleAdmin)(next)
}

// RequireOperator allows admin + operator.
func RequireOperator(next http.Handler) http.Handler {
	return RequireRole(models.RoleAdmin, models.RoleOperator)(next)
}
