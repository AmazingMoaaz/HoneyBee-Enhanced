// Package api wires up the chi router.
package api

import (
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimid "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/honeybee-enhanced/core/internal/api/handlers"
	"github.com/honeybee-enhanced/core/internal/api/middleware"
	"github.com/honeybee-enhanced/core/internal/api/ws"
	"github.com/honeybee-enhanced/core/internal/config"
	"github.com/honeybee-enhanced/core/internal/nodeserver"
	"github.com/honeybee-enhanced/core/internal/potstore"
	"github.com/honeybee-enhanced/core/internal/store"
)

// Build constructs the chi router with all routes.
func Build(
	cfg *config.Config,
	st *store.Store,
	ns *nodeserver.Server,
	ps *potstore.Client,
	hub *ws.Hub,
	logger *slog.Logger,
) http.Handler {
	r := chi.NewRouter()

	r.Use(chimid.RequestID)
	r.Use(chimid.RealIP)
	r.Use(chimid.Recoverer)
	r.Use(chimid.Timeout(60 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.Server.AllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	jwtMid := middleware.NewJWTAuth(cfg.JWT.Secret)
	rl := middleware.NewRateLimiter(20, time.Minute)

	authH := handlers.NewAuthHandler(st, jwtMid, cfg)
	nodesH := handlers.NewNodesHandler(st, ns, cfg)
	depsH := handlers.NewDeploymentsHandler(st, ns, ps)
	evtsH := handlers.NewEventsHandler(st)
	sessH := handlers.NewSessionsHandler(st)
	psH := handlers.NewPotStoreHandler(ps)
	usersH := handlers.NewUsersHandler(st)
	cmdH := handlers.NewCommandsHandler(st, ns)

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"ok"}`))
		})

		// Auth (rate-limited, public)
		r.Group(func(r chi.Router) {
			r.Use(rl.Middleware)
			r.Post("/auth/register", authH.Register)
			r.Post("/auth/login", authH.Login)
			r.Post("/auth/refresh", authH.Refresh)
			r.Post("/auth/logout", authH.Logout)
		})

		// Public node-agent binary download — redirects to the GitHub release asset.
		// Query params: ?os=linux|darwin|windows  ?arch=amd64|arm64  (defaults: linux/amd64)
		r.Get("/download/node-agent", func(w http.ResponseWriter, req *http.Request) {
			goos := req.URL.Query().Get("os")
			arch := req.URL.Query().Get("arch")
			if goos == "" {
				goos = "linux"
			}
			if arch == "" {
				arch = "amd64"
			}
			asset := "honeybee-node-" + goos + "-" + arch
			if goos == "windows" {
				asset += ".exe"
			}
			tag := cfg.Node.GitHubReleaseTag
			var assetURL string
			if tag == "" || tag == "latest" {
				assetURL = fmt.Sprintf(
					"https://github.com/%s/releases/latest/download/%s",
					cfg.Node.GitHubRepo, asset)
			} else {
				assetURL = fmt.Sprintf(
					"https://github.com/%s/releases/download/%s/%s",
					cfg.Node.GitHubRepo, tag, asset)
			}
			http.Redirect(w, req, assetURL, http.StatusFound)
		})

		// Install script may use ?token=<raw_node_token> or JWT
		r.Get("/nodes/{id}/install", nodesH.InstallScript)
		r.Get("/nodes/{id}/uninstall", nodesH.UninstallScript)

		// WebSocket (auth via ?token=<jwt> in middleware)
		r.Get("/ws", func(w http.ResponseWriter, req *http.Request) {
			tok := req.URL.Query().Get("token")
			if tok == "" {
				http.Error(w, "missing token", http.StatusUnauthorized)
				return
			}
			c, err := jwtMid.Parse(tok)
			if err != nil || c.Subject != "access" {
				http.Error(w, "invalid token", http.StatusUnauthorized)
				return
			}
			hub.HandleHTTP(w, req, c.OrgID, c.UserID, string(c.Role))
		})

		// Authenticated routes
		r.Group(func(r chi.Router) {
			r.Use(jwtMid.Middleware)

			r.Get("/auth/me", authH.Me)

			// Nodes
			r.Get("/nodes", nodesH.List)
			r.Get("/nodes/{id}", nodesH.Get)
			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireOperator)
				r.Post("/nodes", nodesH.Create)
				r.Delete("/nodes/{id}", nodesH.Delete)
				r.Post("/nodes/{id}/uninstall", nodesH.Uninstall)
				r.Post("/nodes/{id}/regenerate-token", nodesH.RegenerateToken)
				r.Post("/nodes/{id}/command", cmdH.SendNodeCommand)
				r.Post("/nodes/{id}/deployments", depsH.CreateForNode)
			})

			// Deployments
			r.Get("/deployments", depsH.List)
			r.Get("/deployments/{id}/logs", depsH.Logs)
			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireOperator)
				r.Post("/deployments/{id}/start", depsH.Action("start"))
				r.Post("/deployments/{id}/stop", depsH.Action("stop"))
				r.Post("/deployments/{id}/restart", depsH.Action("restart"))
				r.Post("/deployments/{id}/remove", depsH.Action("remove"))
				r.Patch("/deployments/{id}/config", depsH.UpdateConfig)
				r.Post("/deployments/{id}/metrics", depsH.RequestMetrics)
			})

			// Events
			r.Get("/events", evtsH.List)
			r.Get("/events/stats", evtsH.Stats)

			// Sessions
			r.Get("/sessions", sessH.List)
			r.Get("/sessions/{id}", sessH.Get)
			r.Get("/sessions/{id}/replay", sessH.Replay)

			// PotStore
			r.Get("/potstore", psH.List)
			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireAdmin)
				r.Post("/potstore/sync", psH.Sync)
			})

			// Broadcast
			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireOperator)
				r.Post("/broadcast/command", cmdH.Broadcast)
			})

			// Users (admin)
			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireAdmin)
				r.Get("/users", usersH.List)
				r.Post("/users", usersH.Create)
				r.Get("/users/{id}", usersH.Get)
				r.Patch("/users/{id}", usersH.Update)
				r.Delete("/users/{id}", usersH.Delete)
			})
		})
	})

	logger.Info("router built")
	return r
}
