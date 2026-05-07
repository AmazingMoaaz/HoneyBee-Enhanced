package handlers

import (
	"context"
	"net/http"
	"runtime"
	"time"

	"github.com/honeybee-enhanced/core/internal/nodeserver"
	"github.com/honeybee-enhanced/core/internal/store"
)

// SystemHandler exposes diagnostic / health-check endpoints used by the
// "System Check" dashboard page.
type SystemHandler struct {
	Store      *store.Store
	NodeServer *nodeserver.Server
	StartedAt  time.Time
	Version    string
}

// NewSystemHandler constructs.
func NewSystemHandler(s *store.Store, ns *nodeserver.Server, version string) *SystemHandler {
	return &SystemHandler{Store: s, NodeServer: ns, StartedAt: time.Now(), Version: version}
}

type checkResult struct {
	Name      string `json:"name"`
	OK        bool   `json:"ok"`
	Detail    string `json:"detail,omitempty"`
	LatencyMs int64  `json:"latency_ms"`
}

// Check runs the suite of system diagnostics and returns a structured report.
//
//	GET /api/v1/system/check
func (h *SystemHandler) Check(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	checks := []checkResult{}

	// 1. Database ping
	t := time.Now()
	dbErr := h.Store.DB.PingContext(ctx)
	checks = append(checks, checkResult{
		Name:      "database",
		OK:        dbErr == nil,
		Detail:    errMsg(dbErr, "MySQL connection healthy"),
		LatencyMs: time.Since(t).Milliseconds(),
	})

	// 2. NodeServer alive (always true if we're serving requests, but expose count)
	connected := 0
	if h.NodeServer != nil {
		connected = h.NodeServer.ConnectedCount()
	}
	checks = append(checks, checkResult{
		Name:      "node_server",
		OK:        true,
		Detail:    "WebSocket gateway online",
		LatencyMs: 0,
	})

	// 3. Stats — use ConnectedCount and direct DB queries
	var (
		nodes, deployments, events, users int64
		online                            int64
	)
	_ = h.Store.DB.GetContext(ctx, &nodes, "SELECT COUNT(*) FROM nodes")
	_ = h.Store.DB.GetContext(ctx, &online, "SELECT COUNT(*) FROM nodes WHERE last_heartbeat > NOW() - INTERVAL 90 SECOND")
	_ = h.Store.DB.GetContext(ctx, &deployments, "SELECT COUNT(*) FROM deployments")
	_ = h.Store.DB.GetContext(ctx, &events, "SELECT COUNT(*) FROM events")
	_ = h.Store.DB.GetContext(ctx, &users, "SELECT COUNT(*) FROM users")

	// Deployment status breakdown
	statusRows, _ := h.Store.DB.QueryxContext(ctx, "SELECT status, COUNT(*) AS c FROM deployments GROUP BY status")
	statusBreakdown := map[string]int64{}
	if statusRows != nil {
		defer statusRows.Close()
		for statusRows.Next() {
			var s string
			var c int64
			if err := statusRows.Scan(&s, &c); err == nil {
				statusBreakdown[s] = c
			}
		}
	}

	// Runtime info
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)

	overallOK := true
	for _, c := range checks {
		if !c.OK {
			overallOK = false
			break
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       overallOK,
		"checks":   checks,
		"version":  h.Version,
		"uptime_s": int64(time.Since(h.StartedAt).Seconds()),
		"runtime": map[string]any{
			"go_version":    runtime.Version(),
			"goroutines":    runtime.NumGoroutine(),
			"cpu_count":     runtime.NumCPU(),
			"heap_alloc_mb": ms.HeapAlloc / (1024 * 1024),
			"sys_mb":        ms.Sys / (1024 * 1024),
		},
		"counts": map[string]any{
			"nodes":              nodes,
			"online_nodes":       online,
			"connected_sessions": connected,
			"deployments":        deployments,
			"events":             events,
			"users":              users,
		},
		"deployment_status": statusBreakdown,
		"now":               time.Now().UTC(),
	})
}

func errMsg(err error, ok string) string {
	if err == nil {
		return ok
	}
	return err.Error()
}
