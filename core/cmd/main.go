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
	"github.com/honeybee-enhanced/core/internal/nodeserver"
	"github.com/honeybee-enhanced/core/internal/potstore"
	"github.com/honeybee-enhanced/core/internal/store"
)

func main() {
	cfgPath := flag.String("config", "config.json", "path to JSON/YAML config")
	flag.Parse()

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		panic(err)
	}

	logger := newLogger(cfg.Log.Level)
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
	if err := st.MarkAllNodesOffline(rootCtx); err != nil {
		logger.Warn("mark nodes offline", slog.Any("err", err))
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

	hub := ws.NewHub(logger, cfg.Server.AllowedOrigins)
	ns := nodeserver.NewServer(nodeserver.Config{
		Addr:      cfg.Server.NodeAddr,
		TLSConfig: tlsCfg,
	}, st, logger)
	ns.SetBroadcaster(hub)

	go func() {
		if err := ns.Start(rootCtx); err != nil {
			logger.Error("node server stopped", slog.Any("err", err))
		}
	}()

	router := api.Build(cfg, st, ns, psClient, hub, logger)
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

func newLogger(level string) *slog.Logger {
	var l slog.Level
	switch level {
	case "debug":
		l = slog.LevelDebug
	case "warn":
		l = slog.LevelWarn
	case "error":
		l = slog.LevelError
	default:
		l = slog.LevelInfo
	}
	return slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: l}))
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
