//go:build windows

package agent

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

// selfUninstall stops every running pot, writes a PowerShell cleanup script
// that force-kills any remaining child processes (python.exe, twistd.exe etc.)
// running from the install directory, then deletes the install directory and
// removes the scheduled task. The agent process exits so its own files can be
// removed without "file in use" errors.
func (a *Agent) selfUninstall() {
	// Stop every pot we manage so child python.exe/twistd.exe processes die
	// and release their file handles before the cleanup script tries to delete.
	for _, mf := range a.hp.ListInstalled() {
		_ = a.hp.Stop(mf.PotID)
	}
	time.Sleep(2 * time.Second)

	exe, _ := os.Executable()
	binDir := filepath.Dir(exe)

	// PowerShell cleanup script:
	//   1. Stop & remove the scheduled task
	//   2. Force-kill ANY process whose image path is under $BinDir
	//      (catches stray python.exe / twistd.exe / cmd.exe holding files open)
	//   3. Wait briefly so handles are released, then recursively delete
	script := `$ErrorActionPreference = 'SilentlyContinue'
$taskName = "HoneyBeeNode"
$BinDir   = "` + binDir + `"

Stop-ScheduledTask     -TaskName $taskName
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false

# Kill any process running from inside the install directory.
Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($BinDir, [System.StringComparison]::OrdinalIgnoreCase)
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Start-Sleep -Seconds 3
Remove-Item -Recurse -Force $BinDir
`
	tmp := filepath.Join(os.TempDir(), "hb-uninstall.ps1")
	_ = os.WriteFile(tmp, []byte(script), 0o600)
	cmd := exec.Command("powershell", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", tmp)
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000008} // DETACHED_PROCESS
	_ = cmd.Start()
	os.Exit(0)
}
