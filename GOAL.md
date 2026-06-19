# NodeWatch — Project Goal (North Star)

> A single, ultra-lightweight cross-platform app to monitor many servers (and your own
> PC) at a glance — like having `btop` for all your machines, plus a desktop widget.

This file is the **source of truth for what we're building**. If we ever drift, come
back here. Keep it short and honest.

## The problem we're solving

- I run many servers that other people also use.
- I monitor them with `btop` (CPU, Mem, GPU, Net, Disk, active users).
- Today I open MobaXterm and SSH into each server one by one — tedious and heavy.

## What NodeWatch must do (core goals)

1. **Cross-platform** — works on **Windows and macOS**.
2. **Very lightweight** — low RAM and near-zero idle CPU. This is *crucial* and beats
   every other "nice to have".
3. **Desktop widget mode** — a frameless, borderless, always-on-top mini panel that sits
   on the desktop (NOT a sandboxed OS widget). Toggles into a full app window.
4. **Connect to servers over SSH** — no software installed on the servers ("pure SSH").
   Servers may be **mixed OS**: Linux, macOS, and Windows (OpenSSH).
5. **`btop`-style view** — CPU, Memory, Network, Disk, and active users per server.
6. **Monitor the local PC** too (Windows or macOS).
7. **Alerts** — clearly show a warning/error in the widget and app when a server crashes,
   becomes unresponsive, or unexpectedly disconnects (with auto-reconnect).
8. **Intuitive connection UX** — adding/connecting to a server must be dead simple.

## Explicit priorities & decisions (locked in)

- **Framework:** Tauri (Rust backend + system webview). Chosen for low footprint.
- **Connectivity:** Pure SSH (zero server-side install). Persistent sessions, not
  reconnect-per-poll, to stay light.
- **Remote OS:** Mixed — auto-detect Linux / macOS / Windows and use the right commands.
- **GPU:** Low priority for now. Ship CPU/Mem/Net/Disk/users first; GPU later
  (NVIDIA first via `nvidia-smi`, best-effort for others).
- **Widget:** Frameless/transparent/always-on-top window — not WidgetKit / Win11 board
  (those can't run SSH).

## Non-goals (for now)

- No true OS-native widget (sandbox can't do SSH/background polling).
- No bundled Chromium / Electron (too heavy).
- No mandatory server-side agent or exporter install.
- Broad multi-vendor GPU support is deferred.

## Definition of "done enough" for v1

- Add a server with host/user/key in a couple of clicks, see live CPU/Mem/Net/Disk +
  users updating, in both the full window and the widget, with a clear alert when a
  connection drops — all while staying light on resources.
