// Package honeypot manages the lifecycle of installed honeypots on this node.
package honeypot

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/shirou/gopsutil/v3/process"
)

// Manifest describes an installed honeypot recorded on disk.
type Manifest struct {
	PotID        string         `json:"pot_id"`
	HoneypotType string         `json:"honeypot_type"`
	GitURL       string         `json:"git_url"`
	GitBranch    string         `json:"git_branch"`
	InstallDir   string         `json:"install_dir"`
	Entrypoint   string         `json:"entrypoint"`
	Config       map[string]any `json:"config"`
	InstalledAt  time.Time      `json:"installed_at"`
}

type running struct {
	cmd       *exec.Cmd
	pid       int
	startedAt time.Time
}

// Manager tracks installed and running honeypots.
type Manager struct {
	root   string // base data dir
	logger *slog.Logger

	// LogFn is an optional callback invoked for every install/lifecycle log line.
	// Set it after construction (e.g. in main) to stream live logs to core.
	LogFn func(potID, potType, logType, line string)

	mu       sync.Mutex
	manifest map[string]*Manifest // pot_id -> manifest
	procs    map[string]*running  // pot_id -> running process
}

// NewManager creates a Manager rooted at root/honeypots.
func NewManager(root string, logger *slog.Logger) (*Manager, error) {
	base := filepath.Join(root, "honeypots")
	if err := os.MkdirAll(base, 0o755); err != nil {
		return nil, err
	}
	m := &Manager{
		root:     base,
		logger:   logger,
		manifest: make(map[string]*Manifest),
		procs:    make(map[string]*running),
	}
	if err := m.loadAll(); err != nil {
		logger.Warn("loadAll honeypots", slog.Any("err", err))
	}
	return m, nil
}

func (m *Manager) loadAll() error {
	entries, err := os.ReadDir(m.root)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		f := filepath.Join(m.root, e.Name(), "pot_manifest.json")
		b, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var mf Manifest
		if json.Unmarshal(b, &mf) == nil {
			m.manifest[mf.PotID] = &mf
		}
	}
	return nil
}

func (m *Manager) saveManifest(mf *Manifest) error {
	b, _ := json.MarshalIndent(mf, "", "  ")
	return os.WriteFile(filepath.Join(mf.InstallDir, "pot_manifest.json"), b, 0o644)
}

// emitLog calls LogFn (if set) and logs at debug level.
func (m *Manager) emitLog(potID, potType, logType, line string) {
	m.logger.Debug("pot log", slog.String("pot_id", potID), slog.String("log_type", logType))
	if m.LogFn != nil {
		m.LogFn(potID, potType, logType, line)
	}
}

// Install clones a honeypot repo and writes a manifest.
func (m *Manager) Install(ctx context.Context, potID, hpType, gitURL, branch string, cfg map[string]any) (*Manifest, error) {
	dir := filepath.Join(m.root, potID)
	if _, err := os.Stat(dir); err == nil {
		return nil, errors.New("already installed")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	m.emitLog(potID, hpType, "install.start", fmt.Sprintf("installing %s from %s", hpType, gitURL))
	args := []string{"clone", "--depth=1", "--progress"}
	if branch != "" {
		args = append(args, "--branch", branch)
	}
	args = append(args, gitURL, dir)
	cmd := exec.CommandContext(ctx, "git", args...)
	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw

	doneScan := make(chan struct{})
	go func() {
		defer close(doneScan)
		sc := bufio.NewScanner(pr)
		for sc.Scan() {
			line := strings.TrimRight(sc.Text(), "\r\t ")
			if line != "" {
				m.emitLog(potID, hpType, "install.progress", line)
			}
		}
	}()

	if err := cmd.Start(); err != nil {
		_ = pw.Close()
		<-doneScan
		_ = os.RemoveAll(dir)
		m.emitLog(potID, hpType, "install.error", "failed to start git: "+err.Error())
		return nil, fmt.Errorf("git clone start: %w", err)
	}
	cloneErr := cmd.Wait()
	_ = pw.Close()
	<-doneScan

	if cloneErr != nil {
		_ = os.RemoveAll(dir)
		m.emitLog(potID, hpType, "install.error", "git clone failed: "+cloneErr.Error())
		return nil, fmt.Errorf("git clone: %w", cloneErr)
	}
	m.emitLog(potID, hpType, "install.progress", "git clone complete")

	entry := findEntrypoint(dir)
	if entry != "" {
		m.emitLog(potID, hpType, "install.progress", "entrypoint found: "+entry)
	} else {
		m.emitLog(potID, hpType, "install.warning", "no entrypoint detected — pot may need manual configuration")
	}

	mf := &Manifest{
		PotID:        potID,
		HoneypotType: hpType,
		GitURL:       gitURL,
		GitBranch:    branch,
		InstallDir:   dir,
		Entrypoint:   entry,
		Config:       cfg,
		InstalledAt:  time.Now().UTC(),
	}
	if err := m.saveManifest(mf); err != nil {
		return nil, err
	}
	m.mu.Lock()
	m.manifest[potID] = mf
	m.mu.Unlock()
	m.emitLog(potID, hpType, "install.complete", "installation complete")
	return mf, nil
}

// Start launches the honeypot process.
func (m *Manager) Start(ctx context.Context, potID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.procs[potID]; ok {
		return errors.New("already running")
	}
	mf, ok := m.manifest[potID]
	if !ok {
		return errors.New("not installed")
	}
	m.emitLog(potID, mf.HoneypotType, "start.progress", "launching honeypot process")
	cmd, err := buildCommand(mf)
	if err != nil {
		m.emitLog(potID, mf.HoneypotType, "start.error", "build command failed: "+err.Error())
		return err
	}
	cmd.Dir = mf.InstallDir
	logFile, err := os.OpenFile(filepath.Join(mf.InstallDir, "pot.log"),
		os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err == nil {
		cmd.Stdout = logFile
		cmd.Stderr = logFile
	}
	if err := cmd.Start(); err != nil {
		m.emitLog(potID, mf.HoneypotType, "start.error", "process start failed: "+err.Error())
		return err
	}
	m.procs[potID] = &running{cmd: cmd, pid: cmd.Process.Pid, startedAt: time.Now().UTC()}
	go func() { _ = cmd.Wait() }()
	m.emitLog(potID, mf.HoneypotType, "start.complete", fmt.Sprintf("process started (pid=%d)", cmd.Process.Pid))
	return nil
}

// Stop sends SIGTERM, waits up to 10s, then SIGKILL.
func (m *Manager) Stop(potID string) error {
	m.mu.Lock()
	r, ok := m.procs[potID]
	mf := m.manifest[potID]
	if !ok {
		m.mu.Unlock()
		return errors.New("not running")
	}
	delete(m.procs, potID)
	m.mu.Unlock()
	hpType := ""
	if mf != nil {
		hpType = mf.HoneypotType
	}
	m.emitLog(potID, hpType, "stop.info", "stopping honeypot")
	if runtime.GOOS == "windows" {
		_ = r.cmd.Process.Kill()
	} else {
		_ = r.cmd.Process.Signal(syscall.SIGTERM)
		done := make(chan struct{})
		go func() { _, _ = r.cmd.Process.Wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			_ = r.cmd.Process.Kill()
		}
	}
	m.emitLog(potID, hpType, "stop.complete", "honeypot stopped")
	return nil
}

// Restart stops then starts.
func (m *Manager) Restart(ctx context.Context, potID string) error {
	_ = m.Stop(potID)
	time.Sleep(500 * time.Millisecond)
	return m.Start(ctx, potID)
}

// Remove stops and deletes the install directory.
func (m *Manager) Remove(potID string) error {
	_ = m.Stop(potID)
	m.mu.Lock()
	mf, ok := m.manifest[potID]
	if !ok {
		m.mu.Unlock()
		return errors.New("not installed")
	}
	hpType := mf.HoneypotType
	delete(m.manifest, potID)
	m.mu.Unlock()
	m.emitLog(potID, hpType, "remove.info", "removing honeypot files")
	err := os.RemoveAll(mf.InstallDir)
	if err == nil {
		m.emitLog(potID, hpType, "remove.complete", "honeypot removed")
	}
	return err
}

// IsRunning reports whether a pot has a tracked running process.
func (m *Manager) IsRunning(potID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.procs[potID]
	return ok
}

// Info returns manifest + status.
func (m *Manager) Info(potID string) (map[string]any, error) {
	m.mu.Lock()
	mf, ok := m.manifest[potID]
	r := m.procs[potID]
	m.mu.Unlock()
	if !ok {
		return nil, errors.New("not installed")
	}
	out := map[string]any{
		"manifest": mf,
		"running":  r != nil,
	}
	if r != nil {
		out["pid"] = r.pid
		out["started_at"] = r.startedAt
		out["uptime_sec"] = time.Since(r.startedAt).Seconds()
	}
	return out, nil
}

// Metrics returns CPU/mem usage of the pot process.
func (m *Manager) Metrics(potID string) (map[string]any, error) {
	m.mu.Lock()
	r, ok := m.procs[potID]
	m.mu.Unlock()
	if !ok {
		return nil, errors.New("not running")
	}
	p, err := process.NewProcess(int32(r.pid))
	if err != nil {
		return nil, err
	}
	cpu, _ := p.CPUPercent()
	mem, _ := p.MemoryInfo()
	out := map[string]any{"pid": r.pid, "cpu_percent": cpu}
	if mem != nil {
		out["mem_rss_bytes"] = mem.RSS
	}
	return out, nil
}

// ListInstalled returns all manifests.
func (m *Manager) ListInstalled() []*Manifest {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*Manifest, 0, len(m.manifest))
	for _, mf := range m.manifest {
		out = append(out, mf)
	}
	return out
}

func findEntrypoint(dir string) string {
	candidates := []string{
		"start.sh", "run.sh", "bin/cowrie", "src/cowrie/cli.py",
		"main.py", "app.py", "honeypot.py", "index.php", "standalone.php",
	}
	for _, c := range candidates {
		p := filepath.Join(dir, c)
		if _, err := os.Stat(p); err == nil {
			return c
		}
	}
	return ""
}

func buildCommand(mf *Manifest) (*exec.Cmd, error) {
	full := filepath.Join(mf.InstallDir, mf.Entrypoint)
	switch {
	case mf.Entrypoint == "":
		return nil, errors.New("no entrypoint")
	case hasSuffix(mf.Entrypoint, ".py"):
		py := lookupExe("python3", "python", "py")
		if py == "" {
			return nil, errors.New("python not found")
		}
		return exec.Command(py, full), nil
	case hasSuffix(mf.Entrypoint, ".php"):
		php := lookupExe("php")
		if php == "" {
			return nil, errors.New("php not found")
		}
		return exec.Command(php, "-S", "0.0.0.0:8080", full), nil
	case hasSuffix(mf.Entrypoint, ".sh"):
		if runtime.GOOS == "windows" {
			bash := lookupExe("bash")
			if bash == "" {
				return nil, errors.New("bash not found")
			}
			return exec.Command(bash, full), nil
		}
		return exec.Command("/bin/sh", full), nil
	default:
		return exec.Command(full), nil
	}
}

func hasSuffix(s, suf string) bool {
	return len(s) >= len(suf) && s[len(s)-len(suf):] == suf
}

func lookupExe(names ...string) string {
	for _, n := range names {
		if p, err := exec.LookPath(n); err == nil {
			return p
		}
	}
	return ""
}
