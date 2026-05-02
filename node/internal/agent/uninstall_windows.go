//go:build windows

package agent

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

// selfUninstall writes a PS1 cleanup script and exits; the script removes all node files.
func (a *Agent) selfUninstall() {
	time.Sleep(500 * time.Millisecond)
	exe, _ := os.Executable()
	script := `$taskName = "HoneyBeeNode"
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Remove-Item -Recurse -Force "` + filepath.Dir(exe) + `" -ErrorAction SilentlyContinue
`
	tmp := filepath.Join(os.TempDir(), "hb-uninstall.ps1")
	_ = os.WriteFile(tmp, []byte(script), 0o600)
	cmd := exec.Command("powershell", "-NonInteractive", "-WindowStyle", "Hidden", "-File", tmp)
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000008} // DETACHED_PROCESS
	_ = cmd.Start()
	os.Exit(0)
}
