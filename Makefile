# HoneyBee-Enhanced — top-level Makefile.
# Usage: make help

SHELL := /bin/sh

.PHONY: help build core node cli shared dashboard test up down logs clean

help:
	@echo "Targets:"
	@echo "  build       - Build core, node, cli (Go) and dashboard (Vite)"
	@echo "  core        - go build ./... in core"
	@echo "  node        - go build ./... in node"
	@echo "  cli         - go build ./... in cli"
	@echo "  dashboard   - npm install && npm run build in dashboard"
	@echo "  test        - go test ./... in all Go modules"
	@echo "  up          - docker compose up -d"
	@echo "  down        - docker compose down"
	@echo "  logs        - docker compose logs -f"
	@echo "  clean       - remove build artifacts"

build: core node cli dashboard

core:
	cd core && go build ./...

node:
	cd node && go build ./...

cli:
	cd cli && go build -o ../bin/honeybee-cli ./cmd

dashboard:
	cd dashboard && npm install && npm run build

test:
	cd shared && go test ./...
	cd core && go test ./...
	cd node && go test ./...
	cd cli && go test ./...

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f

clean:
	rm -rf bin dashboard/dist
	cd core && go clean
	cd node && go clean
	cd cli && go clean
