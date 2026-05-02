// Package honeypot manages the lifecycle of installed honeypots on this node.
package honeypot

import (
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
	RunCmd       []string       `json:"run_cmd,omitempty"`
	Config       map[string]any `json:"config"`
	InstalledAt  time.Time      `json:"installed_at"`
}

// InstallOptions carries optional deployment metadata from the potstore catalog.
type InstallOptions struct {
	// Entrypoint overrides auto-detection when non-empty.
	Entrypoint string
	// InstallCmds is a single command (argv) to run from InstallDir after cloning.
	InstallCmds []string
	// RunCmd is the argv used to launch the pot process; overrides Entrypoint if set.
	RunCmd []string
	// Subdir, if set, is the path inside the cloned repo whose contents become
	// the InstallDir. Used for the honeybee_potstore monorepo where each pot
	// lives in its own top-level folder (HonnyPotter/, WebTrap/, ...).
	Subdir string
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
func (m *Manager) Install(ctx context.Context, potID, hpType, gitURL, branch string, cfg map[string]any, opts *InstallOptions) (*Manifest, error) {
	if opts == nil {
		opts = &InstallOptions{}
	}
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
		streamOutput(pr, func(line string) {
			m.emitLog(potID, hpType, "install.progress", line)
		})
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

	// Flatten subdir if specified (monorepo pots like HonnyPotter, WebTrap).
	if opts.Subdir != "" {
		if err := flattenSubdir(dir, opts.Subdir); err != nil {
			_ = os.RemoveAll(dir)
			m.emitLog(potID, hpType, "install.error", "flatten subdir: "+err.Error())
			return nil, fmt.Errorf("flatten subdir %q: %w", opts.Subdir, err)
		}
		m.emitLog(potID, hpType, "install.progress", "flattened subdir "+opts.Subdir+" into install root")
	}

	// Type-specific post-install setup.
	switch hpType {
	case "cowrie":
		if err := m.postInstallCowrie(ctx, potID, dir, cfg); err != nil {
			_ = os.RemoveAll(dir)
			m.emitLog(potID, hpType, "install.error", err.Error())
			return nil, err
		}
	case "webtrap":
		if err := m.postInstallWebtrap(ctx, potID, dir, cfg); err != nil {
			_ = os.RemoveAll(dir)
			m.emitLog(potID, hpType, "install.error", err.Error())
			return nil, err
		}
	case "honnypotter":
		if err := m.postInstallHonnypotter(ctx, potID, dir, cfg); err != nil {
			_ = os.RemoveAll(dir)
			m.emitLog(potID, hpType, "install.error", err.Error())
			return nil, err
		}
	default:
		// Run generic install commands from potstore catalog, if any.
		if len(opts.InstallCmds) > 0 {
			m.emitLog(potID, hpType, "install.progress", "running install command: "+strings.Join(opts.InstallCmds, " "))
			if err := m.runInstallCmd(ctx, potID, hpType, dir, opts.InstallCmds); err != nil {
				_ = os.RemoveAll(dir)
				m.emitLog(potID, hpType, "install.error", "install command failed: "+err.Error())
				return nil, fmt.Errorf("install cmd: %w", err)
			}
			m.emitLog(potID, hpType, "install.progress", "install command complete")
		}
	}

	// Determine entrypoint: explicit > auto-detect (not used for cowrie which uses twistd).
	entry := opts.Entrypoint
	if entry == "" && hpType != "cowrie" {
		entry = findEntrypoint(dir)
	}
	if entry != "" {
		m.emitLog(potID, hpType, "install.progress", "entrypoint: "+entry)
	} else if len(opts.RunCmd) == 0 && hpType != "cowrie" {
		m.emitLog(potID, hpType, "install.warning", "no entrypoint detected — pot may need manual configuration")
	}

	mf := &Manifest{
		PotID:        potID,
		HoneypotType: hpType,
		GitURL:       gitURL,
		GitBranch:    branch,
		InstallDir:   dir,
		Entrypoint:   entry,
		RunCmd:       opts.RunCmd,
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

	// Pipe stdout+stderr so we can stream to dashboard AND write to pot.log.
	pr, pw := io.Pipe()
	logFile, _ := os.OpenFile(filepath.Join(mf.InstallDir, "pot.log"),
		os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if logFile != nil {
		cmd.Stdout = io.MultiWriter(logFile, pw)
		cmd.Stderr = io.MultiWriter(logFile, pw)
	} else {
		cmd.Stdout = pw
		cmd.Stderr = pw
	}

	if err := cmd.Start(); err != nil {
		_ = pw.Close()
		if logFile != nil {
			_ = logFile.Close()
		}
		m.emitLog(potID, mf.HoneypotType, "start.error", "process start failed: "+err.Error())
		return err
	}

	hpType := mf.HoneypotType
	m.procs[potID] = &running{cmd: cmd, pid: cmd.Process.Pid, startedAt: time.Now().UTC()}
	m.emitLog(potID, mf.HoneypotType, "start.complete", fmt.Sprintf("process started (pid=%d)", cmd.Process.Pid))

	// Stream process output lines to the dashboard in real time.
	// streamDone is closed when all lines have been emitted — we MUST
	// wait for it before emitting process.exit so the dashboard always
	// shows the error output BEFORE the exit event.
	streamDone := make(chan struct{})
	go func() {
		streamOutput(pr, func(line string) {
			m.emitLog(potID, hpType, "process.output", line)
		})
		close(streamDone)
	}()

	// Monitor the process and surface exit/crash in the dashboard.
	go func() {
		waitErr := cmd.Wait()
		_ = pw.Close() // sends EOF to streamOutput goroutine
		<-streamDone   // wait until every output line has been emitted
		if logFile != nil {
			_ = logFile.Close()
		}
		m.mu.Lock()
		delete(m.procs, potID)
		m.mu.Unlock()
		if waitErr != nil {
			m.emitLog(potID, hpType, "process.exit",
				fmt.Sprintf("process exited with error: %v — check process.output lines above or %s",
					waitErr, filepath.Join(mf.InstallDir, "cowrie-debug.log")))
		} else {
			m.emitLog(potID, hpType, "process.exit", "process exited cleanly")
		}
	}()

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
		"start.sh", "run.sh",
		"main.py", "app.py", "honeypot.py",
		"index.php", "standalone.php",
	}
	for _, c := range candidates {
		p := filepath.Join(dir, c)
		if _, err := os.Stat(p); err == nil {
			return c
		}
	}
	return ""
}

// windowsPythonRoots returns directories to glob for python.exe on Windows.
// It does NOT rely on environment variables (which may be missing in service
// processes), and instead uses Go standard-library calls (os.UserHomeDir,
// os.UserCacheDir) plus a fixed list of system-wide locations.
func windowsPythonRoots() []string {
	roots := []string{
		`C:\Program Files`,
		`C:\Program Files (x86)`,
	}

	// os.UserHomeDir() calls the Windows API (GetUserProfileDirectory) and
	// works even when USERPROFILE / LOCALAPPDATA env vars are not set.
	if home, err := os.UserHomeDir(); err == nil {
		// Per-user install: %LOCALAPPDATA%\Programs\Python\...
		localAppData := filepath.Join(home, "AppData", "Local")
		roots = append(roots, localAppData)
		// Roaming install (less common but possible)
		roots = append(roots, filepath.Join(home, "AppData", "Roaming"))
	}

	// Also glob across ALL user profiles on the machine (covers cases where
	// the agent runs under a different account than the one that installed Python).
	if profileMatches, err := filepath.Glob(`C:\Users\*\AppData\Local`); err == nil {
		roots = append(roots, profileMatches...)
	}

	// Also honour env-var based roots if they happen to be set.
	for _, env := range []string{"LOCALAPPDATA", "APPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)"} {
		if v := os.Getenv(env); v != "" {
			roots = append(roots, v)
		}
	}

	return roots
}

// findPythonInterpreter returns the absolute path to a working Python 3
// interpreter, probing PATH candidates first and then well-known install
// locations on Windows (so it works even when the node agent started before
// Python was added to the system PATH).
func findPythonInterpreter(ctx context.Context) (string, error) {
	// PATH-based candidates (preferred — works on all platforms).
	pathCandidates := []string{"python", "python3", "py", "python.exe", "python3.exe"}
	if runtime.GOOS != "windows" {
		pathCandidates = []string{"python3", "python"}
	}

	var absCandidates []string
	for _, c := range pathCandidates {
		if p, err := exec.LookPath(c); err == nil {
			absCandidates = append(absCandidates, p)
		}
	}

	// On Windows, also scan well-known install directories so we find
	// Python even when the agent process inherited a stale PATH.
	if runtime.GOOS == "windows" {
		for _, root := range windowsPythonRoots() {
			// Match e.g. Python311, Python312, Python3, Python39 ...
			if m, _ := filepath.Glob(filepath.Join(root, "Programs", "Python", "Python3*", "python.exe")); len(m) > 0 {
				absCandidates = append(absCandidates, m...)
			}
			if m, _ := filepath.Glob(filepath.Join(root, "Python3*", "python.exe")); len(m) > 0 {
				absCandidates = append(absCandidates, m...)
			}
		}
	}

	seen := map[string]bool{}
	tried := []string{}
	for _, p := range absCandidates {
		if seen[p] {
			continue
		}
		seen[p] = true
		probeCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		err := exec.CommandContext(probeCtx, p, "-c", "import sys; sys.exit(0)").Run()
		cancel()
		if err == nil {
			return p, nil
		}
		tried = append(tried, fmt.Sprintf("%s: %v", p, err))
	}

	if len(tried) == 0 {
		return "", fmt.Errorf("no Python interpreter found — install Python 3 from python.org and add it to PATH")
	}
	return "", fmt.Errorf("found Python executables but none worked [%s] — reinstall Python 3 from python.org", strings.Join(tried, "; "))
}

// postInstallCowrie handles cowrie-specific setup after git clone:
// creates a Python venv, upgrades pip, installs requirements.txt, and
// creates the var/ directories that cowrie expects at runtime.
func (m *Manager) postInstallCowrie(ctx context.Context, potID, dir string, cfg map[string]any) error {
	pythonCmd, err := findPythonInterpreter(ctx)
	if err != nil {
		return err
	}
	m.emitLog(potID, "cowrie", "install.progress", "using Python: "+pythonCmd)

	venvDir := filepath.Join(dir, "cowrie-env")
	m.emitLog(potID, "cowrie", "install.progress", "creating Python virtual environment")
	if err := m.runInstallCmd(ctx, potID, "cowrie", dir, []string{pythonCmd, "-m", "venv", venvDir}); err != nil {
		return fmt.Errorf("create venv: %w", err)
	}

	var pipPath string
	if runtime.GOOS == "windows" {
		pipPath = filepath.Join(venvDir, "Scripts", "pip.exe")
	} else {
		pipPath = filepath.Join(venvDir, "bin", "pip")
	}
	_ = m.runInstallCmd(ctx, potID, "cowrie", dir, []string{pipPath, "install", "--upgrade", "pip"})

	if reqPath := filepath.Join(dir, "requirements.txt"); fileExists(reqPath) {
		m.emitLog(potID, "cowrie", "install.progress", "installing Python requirements (this may take a while)")
		if err := m.runInstallCmd(ctx, potID, "cowrie", dir, []string{pipPath, "install", "-r", reqPath}); err != nil {
			return fmt.Errorf("pip install requirements: %w", err)
		}
	}

	// Install cowrie as an editable package (required — cowrie's __init__.py
	// raises an error if the package is not importable via pip install -e .).
	// SETUPTOOLS_SCM_PRETEND_VERSION is needed because after flattenSubdir the
	// .git dir belongs to the honeybee_potstore monorepo (no cowrie version
	// tags), so setuptools-scm cannot infer the version on its own.
	m.emitLog(potID, "cowrie", "install.progress", "installing cowrie package (pip install -e .)")
	{
		cmd := exec.CommandContext(ctx, pipPath, "install", "-e", ".")
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "SETUPTOOLS_SCM_PRETEND_VERSION=2.9.0")
		pr, pw := io.Pipe()
		cmd.Stdout = pw
		cmd.Stderr = pw
		doneScan := make(chan struct{})
		go func() {
			defer close(doneScan)
			streamOutput(pr, func(line string) { m.emitLog(potID, "cowrie", "install.progress", line) })
		}()
		if err := cmd.Start(); err != nil {
			_ = pw.Close()
			<-doneScan
			return fmt.Errorf("pip install -e . start: %w", err)
		}
		runErr := cmd.Wait()
		_ = pw.Close()
		<-doneScan
		if runErr != nil {
			return fmt.Errorf("pip install -e .: %w", runErr)
		}
	}

	// Runtime directories cowrie expects.
	for _, sub := range []string{
		filepath.Join("var", "log", "cowrie"),
		filepath.Join("var", "lib", "cowrie", "tty"),
		filepath.Join("var", "lib", "cowrie", "downloads"),
		filepath.Join("var", "run", "cowrie"),
	} {
		if err := os.MkdirAll(filepath.Join(dir, sub), 0o755); err != nil {
			return fmt.Errorf("mkdir %s: %w", sub, err)
		}
	}

	// Install the HoneyBee output plugin (forwards every cowrie event over
	// TCP to the local node listener on 9100).
	pluginDir := filepath.Join(dir, "src", "cowrie", "output")
	if err := os.MkdirAll(pluginDir, 0o755); err != nil {
		return fmt.Errorf("mkdir cowrie output dir: %w", err)
	}
	if err := os.WriteFile(filepath.Join(pluginDir, "honeybee.py"), []byte(cowrieHoneybeePlugin), 0o644); err != nil {
		return fmt.Errorf("write honeybee.py: %w", err)
	}

	sshPort := configIntOrDefault(cfg, "ssh_port", 2222)
	telnetPort := configIntOrDefault(cfg, "telnet_port", 2223)
	hostname := configStringOrDefault(cfg, "hostname", "svr04")

	cowrieCfg := fmt.Sprintf(`# Generated by HoneyBee node — overrides cowrie.cfg.dist
[honeypot]
hostname = %s

[ssh]
listen_endpoints = tcp:%d:interface=0.0.0.0
listen_port = %d

[telnet]
enabled = false
listen_endpoints = tcp:%d:interface=0.0.0.0
listen_port = %d

[output_honeybee]
enabled = true
host = 127.0.0.1
port = 9100
pot_id = %s
`, hostname, sshPort, sshPort, telnetPort, telnetPort, potID)

	etcDir := filepath.Join(dir, "etc")
	if err := os.MkdirAll(etcDir, 0o755); err != nil {
		return fmt.Errorf("mkdir etc: %w", err)
	}
	if err := os.WriteFile(filepath.Join(etcDir, "cowrie.cfg"), []byte(cowrieCfg), 0o644); err != nil {
		return fmt.Errorf("write cowrie.cfg: %w", err)
	}
	m.emitLog(potID, "cowrie", "install.progress", "cowrie setup complete (honeybee output plugin enabled)")
	return nil
}

// postInstallWebtrap creates a venv, installs requirements, and writes a
// config.yaml that points the WebTrap forwarder at the local node listener.
func (m *Manager) postInstallWebtrap(ctx context.Context, potID, dir string, cfg map[string]any) error {
	pythonCmd, err := findPythonInterpreter(ctx)
	if err != nil {
		return err
	}
	m.emitLog(potID, "webtrap", "install.progress", "using Python: "+pythonCmd)

	venvDir := filepath.Join(dir, "webtrap-env")
	if err := m.runInstallCmd(ctx, potID, "webtrap", dir, []string{pythonCmd, "-m", "venv", venvDir}); err != nil {
		return fmt.Errorf("create venv: %w", err)
	}
	pipPath := filepath.Join(venvDir, "bin", "pip")
	if runtime.GOOS == "windows" {
		pipPath = filepath.Join(venvDir, "Scripts", "pip.exe")
	}
	_ = m.runInstallCmd(ctx, potID, "webtrap", dir, []string{pipPath, "install", "--upgrade", "pip"})

	if reqPath := filepath.Join(dir, "requirements.txt"); fileExists(reqPath) {
		m.emitLog(potID, "webtrap", "install.progress", "installing Python requirements")
		if err := m.runInstallCmd(ctx, potID, "webtrap", dir, []string{pipPath, "install", "-r", reqPath}); err != nil {
			return fmt.Errorf("pip install: %w", err)
		}
	}

	bindPort := configIntOrDefault(cfg, "http_port", 8088)
	bindHost := configStringOrDefault(cfg, "bind_host", "0.0.0.0")
	canaryUser := configStringOrDefault(cfg, "canary_username", "")
	canaryPass := configStringOrDefault(cfg, "canary_password", "")

	cfgYaml := fmt.Sprintf(`# Generated by HoneyBee node
pot_id: %s
pot_type: webtrap
honeybee_host: 127.0.0.1
honeybee_port: 9100
honeybee_enable: true
bind_host: %s
bind_port: %d
enable_file_log: true
log_file: ./logs/webtrap.log
log_level: INFO
trust_proxy_headers: true
`, potID, bindHost, bindPort)
	if canaryUser != "" {
		cfgYaml += fmt.Sprintf("canary_username: %q\ncanary_password: %q\n", canaryUser, canaryPass)
	}
	if err := os.WriteFile(filepath.Join(dir, "config.yaml"), []byte(cfgYaml), 0o644); err != nil {
		return fmt.Errorf("write config.yaml: %w", err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "logs"), 0o755); err != nil {
		return fmt.Errorf("mkdir logs: %w", err)
	}
	m.emitLog(potID, "webtrap", "install.progress", "webtrap setup complete")
	return nil
}

// postInstallHonnypotter verifies PHP is available and writes a small
// HoneyBee config file consumed by honeybee-forwarder.php at runtime.
func (m *Manager) postInstallHonnypotter(ctx context.Context, potID, dir string, cfg map[string]any) error {
	php, err := exec.LookPath("php")
	if err != nil {
		return fmt.Errorf("PHP not found in PATH — install PHP 7.4+ to run HonnyPotter")
	}
	m.emitLog(potID, "honnypotter", "install.progress", "using PHP: "+php)

	bindPort := configIntOrDefault(cfg, "http_port", 8080)
	bindHost := configStringOrDefault(cfg, "bind_host", "0.0.0.0")

	// Drop a tiny PHP file the forwarder includes to know which pot_id to tag
	// events with and which TCP port to forward to (defaults are fine, but we
	// override pot_id with the deployment's actual ID).
	hbCfg := fmt.Sprintf(`<?php
// Generated by HoneyBee node
return [
    'pot_id'         => %q,
    'honeybee_host'  => '127.0.0.1',
    'honeybee_port'  => 9100,
    'honeybee_enable'=> true,
];
`, potID)
	if err := os.WriteFile(filepath.Join(dir, "honeybee-config.php"), []byte(hbCfg), 0o644); err != nil {
		return fmt.Errorf("write honeybee-config.php: %w", err)
	}
	// Stash bind info on the manifest by mutating cfg map.
	if cfg != nil {
		cfg["bind_host"] = bindHost
		cfg["bind_port"] = bindPort
	}
	m.emitLog(potID, "honnypotter", "install.progress", "honnypotter setup complete")
	return nil
}

// flattenSubdir moves the contents of dir/sub/* into dir/, then removes dir/sub.
// Used after `git clone` of a monorepo where the actual pot lives in a subfolder.
func flattenSubdir(dir, sub string) error {
	src := filepath.Join(dir, sub)
	st, err := os.Stat(src)
	if err != nil {
		return fmt.Errorf("subdir %q not found after clone: %w", sub, err)
	}
	if !st.IsDir() {
		return fmt.Errorf("subdir %q is not a directory", sub)
	}
	// Use a temp staging name in case sub == "." or shares a name with a sibling.
	staging := filepath.Join(filepath.Dir(dir), filepath.Base(dir)+"_staging_"+filepath.Base(sub))
	if err := os.Rename(src, staging); err != nil {
		return err
	}
	// Wipe everything else in dir, then move staging contents back.
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		_ = os.RemoveAll(filepath.Join(dir, e.Name()))
	}
	stagingEntries, err := os.ReadDir(staging)
	if err != nil {
		return err
	}
	for _, e := range stagingEntries {
		if err := os.Rename(filepath.Join(staging, e.Name()), filepath.Join(dir, e.Name())); err != nil {
			return err
		}
	}
	return os.RemoveAll(staging)
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func configIntOrDefault(cfg map[string]any, key string, def int) int {
	if cfg == nil {
		return def
	}
	switch v := cfg[key].(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case string:
		var i int
		if _, err := fmt.Sscanf(v, "%d", &i); err == nil {
			return i
		}
	}
	return def
}

func configStringOrDefault(cfg map[string]any, key, def string) string {
	if cfg == nil {
		return def
	}
	if v, ok := cfg[key].(string); ok && v != "" {
		return v
	}
	return def
}

// cowrieHoneybeePlugin is the Python source for the cowrie output plugin that
// forwards every event over a TCP JSON-line socket to the local node listener.
const cowrieHoneybeePlugin = `# Auto-generated by HoneyBee node. Do not edit.
# Forwards each cowrie event as one JSON line to the local node listener.
import json
import socket
import threading
import queue
import time
from twisted.python import log
import cowrie.core.output
from cowrie.core.config import CowrieConfig


class Output(cowrie.core.output.Output):
    def start(self):
        self.host = CowrieConfig.get("output_honeybee", "host", fallback="127.0.0.1")
        self.port = CowrieConfig.getint("output_honeybee", "port", fallback=9100)
        self.pot_id = CowrieConfig.get("output_honeybee", "pot_id", fallback="cowrie")
        self._q = queue.Queue(maxsize=4096)
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._worker, name="honeybee-fwd", daemon=True)
        self._t.start()
        log.msg("honeybee output: forwarding to %s:%d as pot_id=%s" % (self.host, self.port, self.pot_id))

    def stop(self):
        self._stop.set()
        try:
            self._q.put_nowait(None)
        except queue.Full:
            pass

    def write(self, event):
        try:
            event = dict(event)
            event["pot_id"] = self.pot_id
            event["pot_type"] = "cowrie"
            self._q.put_nowait(event)
        except (queue.Full, Exception):
            pass

    def _worker(self):
        backoff = 1.0
        while not self._stop.is_set():
            try:
                ev = self._q.get(timeout=1.0)
            except queue.Empty:
                continue
            if ev is None:
                return
            try:
                payload = (json.dumps(ev, default=str) + "\n").encode("utf-8")
                with socket.create_connection((self.host, self.port), timeout=5.0) as s:
                    s.sendall(payload)
                backoff = 1.0
            except OSError:
                time.sleep(min(backoff, 10.0))
                backoff = min(backoff * 2.0, 10.0)
`


// runInstallCmd runs a single install command (argv slice) from dir, streaming output via LogFn.
func (m *Manager) runInstallCmd(ctx context.Context, potID, hpType, dir string, args []string) error {
	if len(args) == 0 {
		return nil
	}
	cmd := exec.CommandContext(ctx, args[0], args[1:]...)
	cmd.Dir = dir
	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw
	doneScan := make(chan struct{})
	go func() {
		defer close(doneScan)
		streamOutput(pr, func(line string) {
			m.emitLog(potID, hpType, "install.progress", line)
		})
	}()
	if err := cmd.Start(); err != nil {
		_ = pw.Close()
		<-doneScan
		return fmt.Errorf("start %s: %w", args[0], err)
	}
	runErr := cmd.Wait()
	_ = pw.Close()
	<-doneScan
	return runErr
}

func buildCommand(mf *Manifest) (*exec.Cmd, error) {
	// Cowrie: run via the venv python.exe directly (NOT via twistd.exe).
	//
	// Why not twistd.exe?
	//   On Windows, twistd.exe is a pip-generated console-script launcher.
	//   When its stdout/stderr are attached to a Go io.Pipe (not a real TTY),
	//   the native launcher wrapper can silently swallow output — even with
	//   PYTHONUNBUFFERED=1 — because the env var propagation through the
	//   wrapper is unreliable on Windows service accounts.
	//
	// By running python.exe -u <launcher.py> we guarantee:
	//   - stdout/stderr are our pipe handles from the very first byte
	//   - -u is applied at the interpreter level (most reliable unbuffered mode)
	//   - any import error appears in process.output before the process exits
	if mf.HoneypotType == "cowrie" {
		venvDir := filepath.Join(mf.InstallDir, "cowrie-env")

		// Locate venv python.
		var pythonExe string
		if runtime.GOOS == "windows" {
			pythonExe = filepath.Join(venvDir, "Scripts", "python.exe")
		} else {
			pythonExe = filepath.Join(venvDir, "bin", "python3")
			if _, err := os.Stat(pythonExe); err != nil {
				pythonExe = filepath.Join(venvDir, "bin", "python")
			}
		}
		if _, err := os.Stat(pythonExe); err != nil {
			return nil, fmt.Errorf("Python not found in cowrie venv (%s) — venv setup may have failed", pythonExe)
		}

		// Generate (or regenerate) the launcher script every time so it
		// always reflects the current install directory.
		launcherPath := filepath.Join(mf.InstallDir, "cowrie-launch.py")
		debugLog := filepath.ToSlash(filepath.Join(mf.InstallDir, "cowrie-debug.log"))
		srcDir := filepath.ToSlash(filepath.Join(mf.InstallDir, "src"))
		pidFile := filepath.ToSlash(filepath.Join(mf.InstallDir, "var", "run", "cowrie", "twistd.pid"))

		// The launcher:
		//  - writes every step to BOTH stdout (captured by our pipe) AND
		//    cowrie-debug.log (survives pipe failures, readable directly)
		//  - wraps every import in try/except so the actual error is always visible
		//  - does NOT specify --reactor so twisted picks the platform default
		launcher := fmt.Sprintf(`# HoneyBee cowrie launcher — auto-generated, do not edit.
import sys, os, traceback, datetime

_dbg = open(%q, 'w', buffering=1, encoding='utf-8')

def _w(msg):
    ts = datetime.datetime.now().strftime('%%H:%%M:%%S.%%f')
    line = f'[{ts}] {msg}'
    print(line, flush=True)
    _dbg.write(line + '\n')
    _dbg.flush()

_w(f'launcher started | Python {sys.version} | exe={sys.executable}')
_w(f'CWD={os.getcwd()}')
sys.path.insert(0, %q)
_w(f'sys.path[0]={sys.path[0]}')

try:
    import cowrie
    _w(f'import cowrie OK ({cowrie.__file__})')
except Exception as e:
    _w(f'IMPORT ERROR cowrie: {e}')
    _dbg.write(traceback.format_exc())
    traceback.print_exc()
    sys.exit(1)

try:
    from twisted.scripts.twistd import run
    _w('import twisted.scripts.twistd OK')
except Exception as e:
    _w(f'IMPORT ERROR twisted.scripts.twistd: {e}')
    _dbg.write(traceback.format_exc())
    traceback.print_exc()
    sys.exit(1)

_pidfile = %q
sys.argv = ['twistd', '-n', '--pidfile=' + _pidfile, 'cowrie']
_w(f'calling run() | sys.argv={sys.argv}')
_dbg.flush()

try:
    run()
except SystemExit as e:
    _w(f'SystemExit: {e.code}')
    sys.exit(e.code)
except Exception as e:
    _w(f'run() exception: {e}')
    _dbg.write(traceback.format_exc())
    traceback.print_exc()
    sys.exit(1)
`, debugLog, srcDir, pidFile)

		if err := os.WriteFile(launcherPath, []byte(launcher), 0o644); err != nil {
			return nil, fmt.Errorf("write cowrie launcher: %w", err)
		}

		cmd := exec.Command(pythonExe, "-u", launcherPath)
		cmd.Env = append(os.Environ(), "PYTHONIOENCODING=utf-8")
		return cmd, nil
	}

	// WebTrap: launch via venv python -u standalone.py.
	if mf.HoneypotType == "webtrap" {
		venvDir := filepath.Join(mf.InstallDir, "webtrap-env")
		pythonExe := filepath.Join(venvDir, "bin", "python3")
		if runtime.GOOS == "windows" {
			pythonExe = filepath.Join(venvDir, "Scripts", "python.exe")
		}
		if !fileExists(pythonExe) {
			return nil, fmt.Errorf("Python not found in webtrap venv (%s) — venv setup may have failed", pythonExe)
		}
		entry := mf.Entrypoint
		if entry == "" {
			entry = "standalone.py"
		}
		cmd := exec.Command(pythonExe, "-u", filepath.Join(mf.InstallDir, entry))
		cmd.Env = append(os.Environ(), "PYTHONIOENCODING=utf-8", "PYTHONUNBUFFERED=1")
		return cmd, nil
	}

	// HonnyPotter: PHP built-in webserver hosting standalone.php.
	if mf.HoneypotType == "honnypotter" {
		php, err := exec.LookPath("php")
		if err != nil {
			return nil, fmt.Errorf("PHP not found in PATH — install PHP 7.4+ to run HonnyPotter")
		}
		bindHost := configStringOrDefault(mf.Config, "bind_host", "0.0.0.0")
		bindPort := configIntOrDefault(mf.Config, "bind_port", 8080)
		entry := mf.Entrypoint
		if entry == "" {
			entry = "standalone.php"
		}
		// php -S host:port -t <docroot> <router>
		cmd := exec.Command(php,
			"-S", fmt.Sprintf("%s:%d", bindHost, bindPort),
			"-t", mf.InstallDir,
			filepath.Join(mf.InstallDir, entry),
		)
		return cmd, nil
	}

	// RunCmd takes precedence over Entrypoint for other types.
	if len(mf.RunCmd) > 0 {
		exe, err := exec.LookPath(mf.RunCmd[0])
		if err != nil {
			// Not in PATH — try relative to InstallDir.
			rel := filepath.Join(mf.InstallDir, mf.RunCmd[0])
			if _, statErr := os.Stat(rel); statErr == nil {
				exe = rel
			} else {
				return nil, fmt.Errorf("run_cmd executable %q not found in PATH or install dir", mf.RunCmd[0])
			}
		}
		return exec.Command(exe, mf.RunCmd[1:]...), nil
	}
	// Fall back to Entrypoint-based detection.
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

// streamOutput reads from r and calls emitFn for each clean line.
// It handles \r as a "carriage return to start of line" (like a terminal), so
// git's progress output — which uses \r to overwrite the same terminal line —
// produces one final clean log entry per stage instead of hundreds of intermediates.
func streamOutput(r io.Reader, emitFn func(string)) {
	const bufSize = 32 * 1024
	buf := make([]byte, bufSize)
	var cur strings.Builder
	for {
		n, readErr := r.Read(buf)
		for _, b := range buf[:n] {
			switch b {
			case '\r':
				// Carriage return: next write overwrites from column 0.
				// Discard what we have so far — we only want the final state.
				cur.Reset()
			case '\n':
				if line := strings.TrimRight(cur.String(), " \t"); line != "" {
					emitFn(line)
				}
				cur.Reset()
			default:
				cur.WriteByte(b)
			}
		}
		if readErr != nil {
			break
		}
	}
	// Flush any unterminated final line (no trailing \n).
	if line := strings.TrimRight(cur.String(), " \t"); line != "" {
		emitFn(line)
	}
}
