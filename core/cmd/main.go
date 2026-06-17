// HoneyBee-Enhanced core server entry point.
package main

import (
	"context"
	"crypto/tls"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/honeybee-enhanced/core/internal/api"
	"github.com/honeybee-enhanced/core/internal/api/ws"
	"github.com/honeybee-enhanced/core/internal/config"
	"github.com/honeybee-enhanced/core/internal/loganalyzer"
	"github.com/honeybee-enhanced/core/internal/nodeserver"
	"github.com/honeybee-enhanced/core/internal/notify"
	"github.com/honeybee-enhanced/core/internal/potstore"
	"github.com/honeybee-enhanced/core/internal/store"
	"github.com/honeybee-enhanced/core/internal/telegram"
	"github.com/honeybee-enhanced/shared/clog"
)

func main() {
	cfgPath := flag.String("config", findConfig("config.json"), "path to JSON/YAML config")
	flag.Parse()

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		panic(err)
	}

	print(clog.Banner("core", "dev"))
	logger := clog.New(cfg.Log.Level)
	if cfg.JWT.Secret == "change-me" {
		logger.Warn("SECURITY: JWT_SECRET is set to the insecure default 'change-me' — set the JWT_SECRET environment variable before deploying")
	}
	logger.Info("starting honeybee-enhanced core",
		slog.String("http", cfg.Server.HTTPAddr),
		slog.String("node", cfg.Server.NodeAddr))

	rootCtx, cancel := signalCtx()
	defer cancel()

	st, err := store.Open(rootCtx, cfg.Database.DSN, cfg.Database.MaxOpen, cfg.Database.MaxIdle)
	if err != nil {
		logger.Error("open store", slog.Any("err", err))
		os.Exit(1)
	}
	defer st.Close()

	if err := st.Migrate(rootCtx); err != nil {
		logger.Error("migrate", slog.Any("err", err))
		os.Exit(1)
	}
	// Ensure every existing org has the built-in roles seeded (admin/operator/
	// viewer) now that roles are first-class rows backing custom permissions.
	if err := st.SeedSystemRolesAllOrgs(rootCtx); err != nil {
		logger.Warn("seed system roles", slog.Any("err", err))
	}
	if err := st.MarkAllNodesOffline(rootCtx); err != nil {
		logger.Warn("mark nodes offline", slog.Any("err", err))
	}
	if err := st.MarkAllDeploymentsOffline(rootCtx); err != nil {
		logger.Warn("mark deployments offline", slog.Any("err", err))
	}
	if err := st.ResetAllSentTasks(rootCtx); err != nil {
		logger.Warn("reset sent tasks", slog.Any("err", err))
	}

	psRepoURL := cfg.PotStore.RepoURL
	if strings.HasPrefix(psRepoURL, "file://") {
		rel := strings.TrimPrefix(psRepoURL, "file://")
		if !filepath.IsAbs(rel) {
			cfgAbs, _ := filepath.Abs(*cfgPath)
			rel = filepath.Join(filepath.Dir(cfgAbs), rel)
		}
		psRepoURL = "file://" + rel
	}
	psClient := potstore.NewClient(psRepoURL, cfg.PotStore.SyncInterval.Duration, logger)
	psClient.Start(rootCtx)

	var tlsCfg *tls.Config
	if cfg.TLS.Enabled {
		cert, err := tls.LoadX509KeyPair(cfg.TLS.CertFile, cfg.TLS.KeyFile)
		if err != nil {
			logger.Error("load tls cert", slog.Any("err", err))
			os.Exit(1)
		}
		tlsCfg = &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS13}
	}

	// Optional GeoIP enrichment: load the MaxMind GeoLite2-City DB if present.
	// A relative path is resolved against the config file's directory (matching
	// the potstore file:// handling above) so the DB is found regardless of the
	// process working directory. If it can't be opened, lookups return empty and
	// the system runs without geolocation.
	if cfg.Server.GeoDBPath != "" {
		geoPath := cfg.Server.GeoDBPath
		if !filepath.IsAbs(geoPath) {
			cfgAbs, _ := filepath.Abs(*cfgPath)
			geoPath = filepath.Join(filepath.Dir(cfgAbs), geoPath)
		}
		if err := nodeserver.InitGeoIP(geoPath); err != nil {
			logger.Warn("geoip database not loaded — attack map will be empty",
				slog.String("path", geoPath), slog.Any("err", err))
		} else {
			logger.Info("geoip database loaded", slog.String("path", geoPath))
			defer nodeserver.CloseGeoIP()
		}
	}

	hub := ws.NewHub(logger, cfg.Server.AllowedOrigins)
	laClient := loganalyzer.New(cfg.LogAnalyzer, logger)
	if laClient.Enabled() {
		logger.Info("loganalyzer integration enabled",
			slog.String("url", cfg.LogAnalyzer.URL),
			slog.Int("retention_days", cfg.LogAnalyzer.RetentionDays))
	}
	// Telegram notifications: wrap the WS hub so every broadcast signal is also
	// dispatched (fire-and-forget) to subscribed Telegram bots. The wrapper is
	// passed wherever a ws.Broadcaster is needed; the concrete hub is still used
	// for the /ws upgrade handler.
	tgNotifier := notify.New(st, telegram.New(logger), logger)
	st.AuditHook = tgNotifier.AuditHook
	notifyBC := notify.NewBroadcaster(hub, tgNotifier)

	ns := nodeserver.NewServer(nodeserver.Config{
		Addr:      cfg.Server.NodeAddr,
		TLSConfig: tlsCfg,
	}, st, logger)
	ns.SetBroadcaster(notifyBC)
	ns.SetLogAnalyzer(laClient)

	go func() {
		if err := ns.Start(rootCtx); err != nil {
			logger.Error("node server stopped", slog.Any("err", err))
		}
	}()

	router := api.Build(cfg, st, ns, psClient, hub, notifyBC, tgNotifier, laClient, logger)
	srv := &http.Server{
		Addr:              cfg.Server.HTTPAddr,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		logger.Info("http listening", slog.String("addr", cfg.Server.HTTPAddr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("http server", slog.Any("err", err))
		}
	}()

	<-rootCtx.Done()
	logger.Info("shutting down")
	shutCtx, cancelShut := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancelShut()
	_ = srv.Shutdown(shutCtx)
}

func signalCtx() (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(context.Background())
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-ch
		cancel()
	}()
	return ctx, cancel
}

// findConfig walks up from cwd until it finds filename, returning the first
// match. Falls back to the bare filename (original behaviour) if not found.
// This allows running `go run ./cmd` from any subdirectory of the repo.
func findConfig(filename string) string {
	dir, err := os.Getwd()
	if err != nil {
		return filename
	}
	for {
		candidate := filepath.Join(dir, filename)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return filename
}
