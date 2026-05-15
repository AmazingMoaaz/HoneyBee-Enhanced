# HoneyBee Enhanced

cd C:\Users\noorb\Desktop\Graduation_project\HoneyBee\core\cmd
go run main.go -config ..\..\config.json

A multi-tenant honeypot orchestration platform — combines the proven
honeypot-portfolio approach (cowrie + custom pots) of [HoneyBee] with the
durable task queue / WebSocket / multi-org architecture of [HoneyPots].

## Architecture

```
                           +-------------+
                           |   MySQL 8   |
                           +------+------+
                                  |
                +-----------------+-----------------+
                |                                   |
        TCP :9001 (nodes)                 HTTP :5100 + WS
        +--------+--------+               +---------+----------+
        |   honeybee-core (Go)             ◀── REST + JWT      |
        |   - node TCP server              ◀── WS hub          |
        |   - HTTP REST + chi              ◀── potstore poller |
        +-----+--+--------+----+           +--------------------+
              ^  |        ^    |
              |  |        |    |  TaskAssign (durable queue)
   PotEvent / |  |  ws    |    |
   SessionData|  |  push  |    v
              |  |        |  +---------+
              |  v        |  |  Node   |   honeybee-node (Go)
        +-----+----+      +--+--+------+   - dial → auth → loop
        |  Cowrie / php / | eventfwd  |   - honeypot.Manager
        |  custom pots    |  :9100    |   - cowrie .tty capture
        +-----------------+-----------+
                                              ▲
                                              | xterm.js replay
                                  +-----------+----------+
                                  |  React + Vite + TS    |
                                  |  Dashboard (Tailwind) |
                                  +----------------------+
                                              ▲
                                              |
                                  +-----------+----------+
                                  |  honeybee-cli (Go)   |
                                  +----------------------+
```

## Modules

| Path         | Purpose                                                    |
| ------------ | ---------------------------------------------------------- |
| `shared/`    | Wire protocol (`v4` envelope) + DTO models                 |
| `core/`      | Control-plane: HTTP API, WS hub, node TCP, potstore client |
| `node/`      | Per-host agent: TCP client, honeypot lifecycle, capture    |
| `cli/`       | Interactive REPL over the REST API                         |
| `dashboard/` | React/Vite SPA with xterm.js session replay                |

## Quickstart (Docker)

```bash
docker compose up -d --build
# Dashboard: http://localhost:5300
# API:       http://localhost:5100/api/v1/health
```

Register a new org from the dashboard. The first user becomes admin.
After creating a node from the UI, copy the one-shot token and start a
node agent locally:

```bash
HB_SERVER_ADDR=127.0.0.1:9001 HB_NODE_TOKEN=<token> \
  ./bin/honeybee-node --config node/configs/node.yaml
```

## Local development

```bash
# 1) backend
make core node cli

# 2) dashboard
cd dashboard && npm install && npm run dev    # http://localhost:5300
```

`vite.config.ts` proxies `/api` → `http://localhost:5100` so login works
out of the box.

## Auth & roles

- JWT HS256 access (15m) + refresh (7d), via `Authorization: Bearer <jwt>`
  or `?token=<jwt>` for WS / install scripts.
- Roles: `admin` (everything), `operator` (deploy & control pots),
  `viewer` (read-only).

## Protocol v4

All node ↔ core frames use a 4-byte big-endian length prefix followed by
JSON `{"version":4,"type":"...","timestamp":"...","payload":{...}}`.
See [`shared/protocol/messages.go`](shared/protocol/messages.go).

## Task queue durability

- New task: `pending`. Sent to a connected node: `sent`.
- Node disconnects: all `sent` tasks for that node revert to `pending`.
- Node reconnects: all `pending` tasks for it are flushed in order.

## License

This combined work follows the licenses of its source projects. See
upstream repositories for details.

[HoneyBee]: ../HoneyBee
[HoneyPots]: ../HoneyPots
