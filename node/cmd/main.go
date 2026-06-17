// HoneyBee-Enhanced node agent entry point.
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/honeybee-enhanced/node/internal/agent"
	"github.com/honeybee-enhanced/node/internal/config"
	"github.com/honeybee-enhanced/node/internal/eventfwd"
	"github.com/honeybee-enhanced/node/internal/honeypot"
	"github.com/honeybee-enhanced/node/internal/session"
	"github.com/honeybee-enhanced/shared/clog"
)

// Version is set at build time via -ldflags "-X main.Version=v1.2.3".
var Version = "dev"

func main() {
	cfgPath := flag.String("config", "configs/node.yaml", "path to YAML config")
	flag.Parse()

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		panic(err)
	}
	print(clog.Banner("node", Version))
	logger := clog.New(cfg.Log.Level)
	logger.Info("starting honeybee-enhanced node",
		slog.String("version", Version),
		slog.String("server", cfg.Server.Address),
		slog.String("name", cfg.Node.Name))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, os.Interrupt, syscall.SIGTERM)
	go func() { <-ch; cancel() }()

	hp, err := honeypot.NewManager(cfg.Node.DataDir, logger)
	if err != nil {
		logger.Error("honeypot manager", slog.Any("err", err))
		os.Exit(1)
	}
	a := agent.New(cfg, logger, hp)
	hp.LogFn = a.SendPotLog
	hp.ExitFn = a.SendPotStatus

	go func() {
		ef := eventfwd.New(cfg.EventFwd.Listen, logger, a)
		if err := ef.Start(ctx); err != nil {
			logger.Warn("eventfwd stopped", slog.Any("err", err))
		}
	}()
	go func() {
		cap := session.New(cfg.Session.CowrieTTYDir, logger, a)
		if err := cap.Start(ctx); err != nil {
			logger.Warn("session capture", slog.Any("err", err))
		}
	}()

	if err := a.Run(ctx); err != nil && ctx.Err() == nil {
		logger.Error("agent stopped", slog.Any("err", err))
	}
}
