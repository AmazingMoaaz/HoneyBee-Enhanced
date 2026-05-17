//go:build !windows

package agent

import "os"

// doRestart exits with a non-zero code so the OS service manager
// (systemd with Restart=on-failure) brings the agent back up automatically.
func (a *Agent) doRestart() {
	os.Exit(1)
}
