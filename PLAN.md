# NodeWatch — Build Plan & Architecture

See `GOAL.md` for the "why". This file is the "how" and the roadmap.

## High-level architecture

```
+-------------------------------------------------------------+
|  NodeWatch (Tauri app)                                      |
|                                                             |
|  Frontend (system webview)        Backend (Rust)            |
|  - Main window (btop-style grid)  - Local metrics (sysinfo) |
|  - Widget window (frameless)      - SSH client (ssh2/russh) |
|  - Charts on <canvas>             - Per-OS command tables   |
|  - Connection manager UI          - Poll scheduler          |
|        ^                          - Alert/heartbeat engine  |
|        | small JSON deltas        - Secure cred storage     |
|        +-----------(Tauri IPC)----------+                   |
+-------------------------------------------------------------+
            |  SSH (persistent sessions)
            v
   [ Linux servers ]  [ macOS servers ]  [ Windows servers ]
```

### Why these pieces
- **Rust does the heavy lifting** (SSH, parsing, polling). UI only renders small JSON.
- **Persistent SSH session per host**: open once, re-run cheap commands on a timer.
  Avoids reconnect cost — the single biggest factor for staying lightweight.
- **Adaptive polling**: faster when window focused, slower for widget-only/idle, paused
  on sleep.

## Module breakdown (Rust backend)

- `metrics/local.rs` — local CPU/Mem/Net/Disk via `sysinfo`.
- `metrics/model.rs` — shared `Snapshot` struct serialized to the UI.
- `ssh/session.rs` — connect, auth (key/agent/password), keepalive, reconnect+backoff.
- `ssh/collector.rs` — run command set, parse stdout into `Snapshot`.
- `ssh/os_detect.rs` — detect remote OS (`uname` / fallback to PowerShell probe).
- `ssh/commands/{linux,macos,windows}.rs` — per-OS command + parser tables.
- `scheduler.rs` — per-host poll loop, rate control.
- `alerts.rs` — heartbeat/timeout -> status (Ok/Warn/Stale/Disconnected), thresholds.
- `store.rs` — saved servers + secrets (OS keychain via `keyring` crate).

## Per-OS remote command tables (pure SSH)

| Metric  | Linux                    | macOS                      | Windows (PowerShell)            |
|---------|--------------------------|----------------------------|---------------------------------|
| CPU     | `/proc/stat`             | `top -l1` / `iostat`       | `Get-Counter` / CIM             |
| Memory  | `/proc/meminfo`          | `vm_stat` + `sysctl`       | CIM `Win32_OperatingSystem`     |
| Disk    | `df -P`                  | `df -k`                    | `Get-PSDrive` / CIM             |
| Network | `/proc/net/dev`          | `netstat -ib`              | `Get-NetAdapterStatistics`      |
| Users   | `who`                    | `who`                      | `query user` / `quser`          |
| OS det. | `uname -s`               | `uname -s`                 | falls through to PowerShell     |

Approach: send a single batched command, parse two samples ~1s apart for rates.

## Frontend

- Plain TypeScript + Vite (no heavy framework) to keep it light. Charts drawn directly
  on `<canvas>` (no chart lib).
- Two windows defined in `tauri.conf.json`:
  - `main` — full grid, connection manager.
  - `widget` — `decorations:false`, `transparent:true`, `alwaysOnTop`, `skipTaskbar`,
    small, draggable, remembers position.
- Color-coded status badges; red banner on disconnect/crash.

## Roadmap (milestones)

- [x] **M0 — Setup**: docs, git, toolchain (Node + Rust), Tauri scaffold.
- [ ] **M1 — Local prototype**: show local CPU/Mem/Net/Disk live in the main window.
- [ ] **M2 — Widget window**: frameless transparent always-on-top mini panel + toggle.
- [ ] **M3 — SSH (Linux)**: add a server, connect, live metrics from one Linux host.
- [ ] **M4 — Alerts**: heartbeat, disconnect/crash detection, auto-reconnect, banners.
- [ ] **M5 — Multi-OS remote**: macOS + Windows command tables + OS auto-detect.
- [ ] **M6 — Connection UX**: nice add/edit server flow, secure credential storage.
- [ ] **M7 — Polish & perf**: adaptive polling, sleep handling, footprint audit.
- [ ] **M8 — (Later) GPU**: NVIDIA via `nvidia-smi`, best-effort others.

## Performance guardrails (keep checking)

- Idle RAM target: keep it small (system webview, no Chromium).
- Idle CPU between polls: ~0%. No busy loops; timer-driven.
- One SSH session per host; reuse it. Backoff on failure.
- Only diffed/aggregated JSON crosses IPC.

## Open questions / to revisit

- SSH library: `ssh2` (libssh2, C dep) vs pure-Rust `russh`. Lean `russh` for portability.
- Windows-over-SSH parsing is the most fragile; validate early in M5.
- Jump hosts / bastions and MobaXterm session import — nice-to-have later.
