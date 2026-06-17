package handlers

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"runtime"
	"runtime/debug"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/load"
	"github.com/shirou/gopsutil/v3/mem"

	"github.com/honeybee-enhanced/core/internal/loganalyzer"
	"github.com/honeybee-enhanced/core/internal/nodeserver"
	"github.com/honeybee-enhanced/core/internal/potstore"
	"github.com/honeybee-enhanced/core/internal/store"
)

// SystemHandler exposes diagnostic / health-check endpoints used by the
// "System Check" dashboard page. It reports real host metrics (via gopsutil),
// the Go process runtime, the DB connection pool, and live subsystem checks.
type SystemHandler struct {
	Store      *store.Store
	NodeServer *nodeserver.Server
	LA         *loganalyzer.Client
	PS         *potstore.Client
	StartedAt  time.Time
	Version    string
}

// NewSystemHandler constructs.
func NewSystemHandler(s *store.Store, ns *nodeserver.Server, la *loganalyzer.Client, ps *potstore.Client, version string) *SystemHandler {
	return &SystemHandler{Store: s, NodeServer: ns, LA: la, PS: ps, StartedAt: time.Now(), Version: version}
}

type checkResult struct {
	Name      string `json:"name"`
	OK        bool   `json:"ok"`
	Critical  bool   `json:"critical"` // only critical checks drive the overall status banner
	Detail    string `json:"detail,omitempty"`
	LatencyMs int64  `json:"latency_ms"`
}

// Check runs the suite of system diagnostics and returns a structured report.
//
//	GET /api/v1/system/check
func (h *SystemHandler) Check(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	checks := []checkResult{}

	// 1. Database connectivity
	t := time.Now()
	dbErr := h.Store.DB.PingContext(ctx)
	checks = append(checks, checkResult{
		Name:      "database",
		OK:        dbErr == nil,
		Critical:  true,
		Detail:    errMsg(dbErr, "MySQL connection healthy"),
		LatencyMs: time.Since(t).Milliseconds(),
	})

	// 2. Node gateway (TCP server tracking live agent connections)
	connected := 0
	if h.NodeServer != nil {
		connected = h.NodeServer.ConnectedCount()
	}
	checks = append(checks, checkResult{
		Name:     "node_gateway",
		OK:       true,
		Critical: true,
		Detail:   fmt.Sprintf("Online · %d live node connection(s)", connected),
	})

	// 3. Real host metrics (gopsutil)
	hostInfo := gatherHost()

	// 4. Disk + memory threshold checks derived from the real host metrics
	if dp, ok := hostInfo["disk_pct"].(float64); ok {
		checks = append(checks, checkResult{
			Name:   "disk_space",
			OK:     dp < 90,
			Detail: fmt.Sprintf("%.0f%% used · %s free on %v", dp, humanBytes(diff(hostInfo["disk_total"], hostInfo["disk_used"])), hostInfo["disk_path"]),
		})
	}
	if mp, ok := hostInfo["mem_pct"].(float64); ok {
		checks = append(checks, checkResult{
			Name:   "memory",
			OK:     mp < 90,
			Detail: fmt.Sprintf("%.0f%% used · %s of %s", mp, humanBytes(hostInfo["mem_used"]), humanBytes(hostInfo["mem_total"])),
		})
	}

	// 5. Log Analyzer integration
	if h.LA != nil && h.LA.Enabled() {
		lt := time.Now()
		laErr := h.LA.Health(ctx)
		checks = append(checks, checkResult{
			Name:      "log_analyzer",
			OK:        laErr == nil,
			Detail:    errMsg(laErr, "Integration reachable"),
			LatencyMs: time.Since(lt).Milliseconds(),
		})
	} else {
		checks = append(checks, checkResult{Name: "log_analyzer", OK: true, Detail: "Not configured (optional)"})
	}

	// 6. PotStore catalog freshness
	if h.PS != nil {
		last := h.PS.LastUpdated()
		if last.IsZero() {
			checks = append(checks, checkResult{Name: "potstore", OK: false, Detail: "Catalog has not synced yet"})
		} else {
			checks = append(checks, checkResult{Name: "potstore", OK: true, Detail: fmt.Sprintf("Catalog synced %s ago", time.Since(last).Round(time.Second))})
		}
	}

	// Inventory counts
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

	// Go runtime + DB connection pool
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	pool := h.Store.DB.Stats()

	// Only critical checks (database, node gateway) drive the overall banner.
	// Disk/memory/log-analyzer/potstore are advisory: they surface per-card as
	// warnings without flagging the whole platform as down.
	overallOK := true
	for _, c := range checks {
		if c.Critical && !c.OK {
			overallOK = false
			break
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       overallOK,
		"checks":   checks,
		"version":  h.Version,
		"build":    buildInfo(),
		"uptime_s": int64(time.Since(h.StartedAt).Seconds()),
		"host":     hostInfo,
		"runtime": map[string]any{
			"go_version":    runtime.Version(),
			"goroutines":    runtime.NumGoroutine(),
			"cpu_count":     runtime.NumCPU(),
			"heap_alloc_mb": ms.HeapAlloc / (1024 * 1024),
			"sys_mb":        ms.Sys / (1024 * 1024),
			"num_gc":        ms.NumGC,
		},
		"db_pool": map[string]any{
			"open":       pool.OpenConnections,
			"in_use":     pool.InUse,
			"idle":       pool.Idle,
			"max_open":   pool.MaxOpenConnections,
			"wait_count": pool.WaitCount,
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

// gatherHost collects real host metrics. Every field is best-effort: a probe
// that errors (e.g. load average on Windows) is simply omitted rather than
// failing the whole report.
func gatherHost() map[string]any {
	out := map[string]any{}

	if hi, err := host.Info(); err == nil && hi != nil {
		out["hostname"] = hi.Hostname
		out["os"] = hi.OS
		out["platform"] = hi.Platform
		out["platform_version"] = hi.PlatformVersion
		out["kernel_version"] = hi.KernelVersion
		out["arch"] = hi.KernelArch
		out["uptime_s"] = hi.Uptime
		out["procs"] = hi.Procs
	}
	if ci, err := cpu.Info(); err == nil && len(ci) > 0 {
		out["cpu_model"] = ci[0].ModelName
	}
	out["cpu_cores"] = runtime.NumCPU()
	if pct, err := cpu.Percent(150*time.Millisecond, false); err == nil && len(pct) > 0 {
		out["cpu_pct"] = round1(pct[0])
	}
	if vm, err := mem.VirtualMemory(); err == nil && vm != nil {
		out["mem_total"] = vm.Total
		out["mem_used"] = vm.Used
		out["mem_pct"] = round1(vm.UsedPercent)
	}
	dpath := "/"
	if runtime.GOOS == "windows" {
		dpath = "C:\\"
	}
	du, err := disk.Usage(dpath)
	if err != nil || du == nil {
		du, _ = disk.Usage(".")
	}
	if du != nil {
		out["disk_path"] = du.Path
		out["disk_total"] = du.Total
		out["disk_used"] = du.Used
		out["disk_pct"] = round1(du.UsedPercent)
	}
	// load.Avg is meaningful on Unix-like systems; on Windows gopsutil returns
	// a zeroed stat with nil error, so skip it there rather than show "0/0/0".
	if runtime.GOOS != "windows" {
		if la, err := load.Avg(); err == nil && la != nil {
			out["load1"] = round2(la.Load1)
			out["load5"] = round2(la.Load5)
			out["load15"] = round2(la.Load15)
		}
	}
	return out
}

// buildInfo surfaces the compiled-in VCS revision/time when available (set by
// `go build` on a git checkout) plus the Go toolchain version.
func buildInfo() map[string]any {
	out := map[string]any{"go": runtime.Version()}
	if bi, ok := debug.ReadBuildInfo(); ok {
		for _, s := range bi.Settings {
			switch s.Key {
			case "vcs.revision":
				rev := s.Value
				if len(rev) > 12 {
					rev = rev[:12]
				}
				out["revision"] = rev
			case "vcs.time":
				out["time"] = s.Value
			case "vcs.modified":
				out["dirty"] = s.Value == "true"
			}
		}
	}
	return out
}

func round1(f float64) float64 { return math.Round(f*10) / 10 }
func round2(f float64) float64 { return math.Round(f*100) / 100 }

// diff returns a-b for byte-count values stored as any (uint64).
func diff(a, b any) uint64 {
	au, bu := toU64(a), toU64(b)
	if bu > au {
		return 0
	}
	return au - bu
}
func toU64(v any) uint64 {
	switch n := v.(type) {
	case uint64:
		return n
	case int64:
		if n < 0 {
			return 0
		}
		return uint64(n)
	case float64:
		return uint64(n)
	default:
		return 0
	}
}

// humanBytes formats a byte count (stored as any) into a compact human string.
func humanBytes(v any) string {
	b := float64(toU64(v))
	units := []string{"B", "KB", "MB", "GB", "TB", "PB"}
	i := 0
	for b >= 1024 && i < len(units)-1 {
		b /= 1024
		i++
	}
	return fmt.Sprintf("%.1f %s", b, units[i])
}

func errMsg(err error, ok string) string {
	if err == nil {
		return ok
	}
	return err.Error()
}
