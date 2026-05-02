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

	// Type-specific post-install setup.
	switch hpType {
	case "cowrie":
		if err := m.postInstallCowrie(ctx, potID, dir); err != nil {
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
func (m *Manager) postInstallCowrie(ctx context.Context, potID, dir string) error {
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

	// Upgrade pip (ignore errors — non-fatal)
	_ = m.runInstallCmd(ctx, potID, "cowrie", dir, []string{pipPath, "install", "--upgrade", "pip"})

	// Install requirements if present
	reqPath := filepath.Join(dir, "requirements.txt")
	if _, err := os.Stat(reqPath); err == nil {
		m.emitLog(potID, "cowrie", "install.progress", "installing Python requirements (this may take a while)")
		if err := m.runInstallCmd(ctx, potID, "cowrie", dir, []string{pipPath, "install", "-r", reqPath}); err != nil {
			return fmt.Errorf("pip install requirements: %w", err)
		}
	}

	// Create directories cowrie needs at runtime
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

	// Write etc/cowrie.cfg so cowrie binds to 0.0.0.0:2222 (not just localhost).
	// cowrie reads etc/cowrie.cfg.dist first as defaults, then etc/cowrie.cfg
	// as overrides — so we only need to specify what we want to change.
	cowrieCfg := `[honeypot]
hostname = svr04

[ssh]
listen_addr = 0.0.0.0
listen_port = 2222

[telnet]
enabled = false
listen_addr = 0.0.0.0
listen_port = 2223
`
	etcDir := filepath.Join(dir, "etc")
	if err := os.MkdirAll(etcDir, 0o755); err != nil {
		return fmt.Errorf("mkdir etc: %w", err)
	}
	if err := os.WriteFile(filepath.Join(etcDir, "cowrie.cfg"), []byte(cowrieCfg), 0o644); err != nil {
		return fmt.Errorf("write cowrie.cfg: %w", err)
	}
	m.emitLog(potID, "cowrie", "install.progress", "cowrie setup complete")
	return nil
}

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
