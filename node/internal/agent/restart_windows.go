//go:build windows

package agent

import (
	"os"
	"os/exec"
	"syscall"
)

// doRestart re-executes the current binary with the same arguments so the
// agent comes back up without relying on Task Scheduler to trigger a restart
// (Task Scheduler only retries on launch failures, not process exits).
func (a *Agent) doRestart() {
	exe, err := os.Executable()
	if err != nil {
		os.Exit(1)
		return
	}

	cmd := exec.Command(exe, os.Args[1:]...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
	}

	if err := cmd.Start(); err != nil {
		// Fallback: let Task Scheduler pick it up on next trigger
		os.Exit(1)
		return
	}

	// Detach cleanly; the new process will reconnect on its own.
	os.Exit(0)
}
