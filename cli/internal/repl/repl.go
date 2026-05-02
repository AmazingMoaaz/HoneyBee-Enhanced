// Package repl is the interactive REPL for the honeybee CLI.
package repl

import (
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"strconv"
	"strings"

	"github.com/chzyer/readline"
	"github.com/honeybee-enhanced/cli/internal/client"
)

// REPL is the read-eval-print loop.
type REPL struct {
	c *client.Client
}

// New constructs a REPL.
func New(c *client.Client) *REPL { return &REPL{c: c} }

// Run starts the loop until EOF or `exit`.
func (r *REPL) Run() error {
	rl, err := readline.New("honeybee> ")
	if err != nil {
		return err
	}
	defer rl.Close()

	fmt.Println("HoneyBee-Enhanced CLI. Type `help` for commands, `exit` to quit.")
	for {
		line, err := rl.Readline()
		if err == io.EOF || err == readline.ErrInterrupt {
			return nil
		}
		if err != nil {
			return err
		}
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		args := splitArgs(line)
		if len(args) == 0 {
			continue
		}
		if args[0] == "exit" || args[0] == "quit" {
			return nil
		}
		if err := r.dispatch(args); err != nil {
			fmt.Println("error:", err)
		}
	}
}

func (r *REPL) dispatch(args []string) error {
	switch args[0] {
	case "help":
		printHelp()
		return nil
	case "login":
		if len(args) < 3 {
			return fmt.Errorf("usage: login <email> <password>")
		}
		if err := r.c.Login(args[1], args[2]); err != nil {
			return err
		}
		fmt.Println("logged in")
		return nil
	case "nodes":
		return r.nodes(args[1:])
	case "node":
		return r.node(args[1:])
	case "events":
		return r.events(args[1:])
	case "sessions":
		return r.sessions(args[1:])
	case "potstore":
		return r.potstore(args[1:])
	case "broadcast":
		return r.broadcast(args[1:])
	case "users":
		return r.users(args[1:])
	default:
		return fmt.Errorf("unknown command: %s (try `help`)", args[0])
	}
}

func (r *REPL) nodes(args []string) error {
	if len(args) == 0 {
		args = []string{"list"}
	}
	switch args[0] {
	case "list":
		var out any
		if err := r.c.Get("/api/v1/nodes", &out); err != nil {
			return err
		}
		return printJSON(out)
	case "create":
		if len(args) < 2 {
			return fmt.Errorf("usage: nodes create <name>")
		}
		var out any
		if err := r.c.Post("/api/v1/nodes", map[string]string{"name": args[1]}, &out); err != nil {
			return err
		}
		return printJSON(out)
	case "delete":
		if len(args) < 2 {
			return fmt.Errorf("usage: nodes delete <id>")
		}
		var out any
		if err := r.c.Delete("/api/v1/nodes/"+args[1], &out); err != nil {
			return err
		}
		return printJSON(out)
	case "get":
		if len(args) < 2 {
			return fmt.Errorf("usage: nodes get <id>")
		}
		var out any
		if err := r.c.Get("/api/v1/nodes/"+args[1], &out); err != nil {
			return err
		}
		return printJSON(out)
	}
	return fmt.Errorf("unknown nodes subcommand: %s", args[0])
}

func (r *REPL) node(args []string) error {
	if len(args) < 2 {
		return fmt.Errorf("usage: node <id> <subcommand> [args]")
	}
	id := args[0]
	if _, err := strconv.ParseInt(id, 10, 64); err != nil {
		return fmt.Errorf("node id must be int")
	}
	sub := args[1]
	rest := args[2:]
	switch sub {
	case "list-pots":
		return r.nodeCommand(id, "get_installed_pots", nil)
	case "install-pot":
		if len(rest) < 2 {
			return fmt.Errorf("usage: node <id> install-pot <pot_id> <honeypot_type> [auto_start]")
		}
		body := map[string]any{
			"pot_id":        rest[0],
			"honeypot_type": rest[1],
		}
		if len(rest) >= 3 {
			body["auto_start"] = rest[2] == "true" || rest[2] == "1"
		}
		var out any
		if err := r.c.Post("/api/v1/nodes/"+id+"/deployments", body, &out); err != nil {
			return err
		}
		return printJSON(out)
	case "start-pot", "stop-pot", "restart-pot", "remove-pot", "pot-info", "pot-metrics":
		if len(rest) < 1 {
			return fmt.Errorf("usage: node <id> %s <pot_id>", sub)
		}
		cmd := map[string]string{
			"start-pot":   "start_pot",
			"stop-pot":    "stop_pot",
			"restart-pot": "restart_pot",
			"remove-pot":  "remove_pot",
			"pot-info":    "get_pot_info",
			"pot-metrics": "get_pot_metrics",
		}[sub]
		return r.nodeCommand(id, cmd, map[string]any{"pot_id": rest[0]})
	case "pot-status":
		if len(rest) < 1 {
			return fmt.Errorf("usage: node <id> pot-status <pot_id>")
		}
		return r.nodeCommand(id, "get_pot_info", map[string]any{"pot_id": rest[0]})
	case "pot-logs":
		if len(rest) < 1 {
			return fmt.Errorf("usage: node <id> pot-logs <deployment_id>")
		}
		var out any
		if err := r.c.Get("/api/v1/deployments/"+rest[0]+"/logs?limit=50", &out); err != nil {
			return err
		}
		return printJSON(out)
	case "restart":
		return r.nodeCommand(id, "restart_node", nil)
	}
	return fmt.Errorf("unknown node subcommand: %s", sub)
}

func (r *REPL) nodeCommand(nodeID, command string, payload map[string]any) error {
	var out any
	body := map[string]any{"command": command, "payload": payload}
	if err := r.c.Post("/api/v1/nodes/"+nodeID+"/command", body, &out); err != nil {
		return err
	}
	return printJSON(out)
}

func (r *REPL) events(args []string) error {
	if len(args) == 0 {
		args = []string{"list"}
	}
	switch args[0] {
	case "list":
		q := url.Values{}
		q.Set("limit", "50")
		var out any
		if err := r.c.GetWithQuery("/api/v1/events", q, &out); err != nil {
			return err
		}
		return printJSON(out)
	case "stats":
		var out any
		if err := r.c.Get("/api/v1/events/stats", &out); err != nil {
			return err
		}
		return printJSON(out)
	}
	return fmt.Errorf("unknown events subcommand: %s", args[0])
}

func (r *REPL) sessions(args []string) error {
	if len(args) == 0 {
		args = []string{"list"}
	}
	if args[0] == "list" {
		var out any
		if err := r.c.Get("/api/v1/sessions?limit=50", &out); err != nil {
			return err
		}
		return printJSON(out)
	}
	return fmt.Errorf("unknown sessions subcommand: %s", args[0])
}

func (r *REPL) potstore(args []string) error {
	if len(args) == 0 {
		args = []string{"list"}
	}
	if args[0] == "list" {
		var out any
		if err := r.c.Get("/api/v1/potstore", &out); err != nil {
			return err
		}
		return printJSON(out)
	}
	if args[0] == "sync" {
		var out any
		if err := r.c.Post("/api/v1/potstore/sync", nil, &out); err != nil {
			return err
		}
		return printJSON(out)
	}
	return fmt.Errorf("unknown potstore subcommand: %s", args[0])
}

func (r *REPL) broadcast(args []string) error {
	if len(args) < 2 {
		return fmt.Errorf("usage: broadcast <command> <pot_id?>")
	}
	body := map[string]any{"command": args[0], "payload": map[string]any{}}
	if len(args) >= 2 {
		body["payload"] = map[string]any{"pot_id": args[1]}
	}
	var out any
	if err := r.c.Post("/api/v1/broadcast/command", body, &out); err != nil {
		return err
	}
	return printJSON(out)
}

func (r *REPL) users(args []string) error {
	if len(args) == 0 {
		args = []string{"list"}
	}
	switch args[0] {
	case "list":
		var out any
		if err := r.c.Get("/api/v1/users", &out); err != nil {
			return err
		}
		return printJSON(out)
	case "create":
		if len(args) < 4 {
			return fmt.Errorf("usage: users create <email> <password> <role> [name]")
		}
		body := map[string]any{
			"email":    args[1],
			"password": args[2],
			"role":     args[3],
		}
		if len(args) >= 5 {
			body["name"] = args[4]
		}
		var out any
		if err := r.c.Post("/api/v1/users", body, &out); err != nil {
			return err
		}
		return printJSON(out)
	case "delete":
		if len(args) < 2 {
			return fmt.Errorf("usage: users delete <id>")
		}
		var out any
		if err := r.c.Delete("/api/v1/users/"+args[1], &out); err != nil {
			return err
		}
		return printJSON(out)
	}
	return fmt.Errorf("unknown users subcommand: %s", args[0])
}

func printJSON(v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(b))
	return nil
}

func printHelp() {
	fmt.Println(`Commands:
  login <email> <password>
  nodes list | get <id> | create <name> | delete <id>
  node <id> list-pots | install-pot <pot_id> <type> [auto_start]
  node <id> start-pot|stop-pot|restart-pot|remove-pot|pot-info|pot-metrics|pot-status <pot_id>
  node <id> pot-logs <deployment_id>
  node <id> restart
  events list | stats
  sessions list
  potstore list | sync
  broadcast <command> [pot_id]
  users list | create <email> <password> <role> [name] | delete <id>
  help | exit`)
}

// splitArgs splits an input line into tokens, supporting double-quoted args.
func splitArgs(s string) []string {
	var out []string
	var cur strings.Builder
	inQ := false
	for _, r := range s {
		switch {
		case r == '"':
			inQ = !inQ
		case r == ' ' && !inQ:
			if cur.Len() > 0 {
				out = append(out, cur.String())
				cur.Reset()
			}
		default:
			cur.WriteRune(r)
		}
	}
	if cur.Len() > 0 {
		out = append(out, cur.String())
	}
	return out
}
