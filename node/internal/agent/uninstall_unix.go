//go:build !windows

package agent

import (
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// selfUninstall writes a shell cleanup script and exits; the script removes all node files.
func (a *Agent) selfUninstall() {
	time.Sleep(500 * time.Millisecond)
	binDir := a.cfg.Node.DataDir
	if binDir == "" {
		exe, _ := os.Executable()
		binDir = filepath.Dir(exe)
	}
	script := `#!/bin/sh
sleep 2
systemctl --user stop honeybee-node 2>/dev/null || true
systemctl --user disable honeybee-node 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/honeybee-node.service"
systemctl --user daemon-reload 2>/dev/null || true
sudo systemctl stop honeybee-node 2>/dev/null || true
sudo systemctl disable honeybee-node 2>/dev/null || true
sudo rm -f /etc/systemd/system/honeybee-node.service
sudo systemctl daemon-reload 2>/dev/null || true
sudo rm -f /usr/local/bin/hb-node 2>/dev/null || true
rm -rf "` + binDir + `"
`
	tmp := filepath.Join(os.TempDir(), "hb-uninstall.sh")
	_ = os.WriteFile(tmp, []byte(script), 0o700)
	cmd := exec.Command("/bin/sh", tmp)
	_ = cmd.Start()
	os.Exit(0)
}
