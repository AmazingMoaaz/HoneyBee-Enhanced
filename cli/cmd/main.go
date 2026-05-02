// HoneyBee-Enhanced CLI entry point.
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/honeybee-enhanced/cli/internal/client"
	"github.com/honeybee-enhanced/cli/internal/repl"
)

func main() {
	server := flag.String("server", envOr("HB_SERVER", "http://127.0.0.1:5100"), "core server base URL")
	flag.Parse()

	c := client.New(*server)
	r := repl.New(c)
	if err := r.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "fatal:", err)
		os.Exit(1)
	}
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
