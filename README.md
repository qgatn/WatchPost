# WatchPost

Lightweight desktop monitor for your PC and remote Linux servers — live CPU, memory, disk, and network in a dashboard and a desktop widget.

Built with [Tauri](https://tauri.app/) (Rust + system webview). macOS and Windows.

## Features

- **Local metrics** — CPU, memory, disk, network, and active users for your PC
- **Desktop widget** — frameless strip with configurable stack position, metrics, and display style
- **Remote Linux servers** — SSH monitoring with add-server wizard and diagnostics (no agent on the server)
- **Settings** — General (about, launch at login), Widget preferences, and server management (add / remove)
- **Launch at login** — optional autostart on Windows and macOS; open the app or widget only
- **Low footprint** — timer-driven sampling, no bundled browser

## Quick start

```bash
git clone https://github.com/qgatn/WatchPost.git
cd WatchPost
```

**First time on this machine** — install build tools, then project dependencies:

| Platform | Prerequisites (downloads from the internet) | Project setup |
|----------|---------------------------------------------|---------------|
| macOS | `bash scripts/install-prerequisites-macos.sh` | `npm run setup` |
| Windows | `powershell -ExecutionPolicy Bypass -File scripts/install-prerequisites-windows.ps1` | `npm run setup` |

Either platform can use `npm run install-deps` instead of the platform script (requires Node already, so use the shell script on a fresh machine).

```bash
npm run start    # development mode (first run compiles Rust — several minutes)
```

Full detail, path options, and manual fallback: **[wiki/Build-from-source.md](wiki/Build-from-source.md)**.

SSH setup for remote servers: **[wiki/FAQ.md](wiki/FAQ.md)**.

## Using the app

| Action | Where |
|--------|--------|
| Switch source (Local / server) | Top bar dropdown |
| Add SSH server | **+ Add server** or **Settings → Servers** |
| Remove SSH server | **Settings → Servers → Remove** |
| Widget options | **Settings → Widget** |
| Launch at login | **Settings → General** |
| About / version | **Settings → General** |
| Diagnostics | **Diagnostics** (when a remote server is selected) |

## Commands

| Command | Description |
|---------|-------------|
| `npm run install-deps` | Install OS prerequisites (Node, Rust, compilers) |
| `npm run setup` | Verify tools and install npm dependencies |
| `npm run start` | Run in development mode |
| `npm test` | Run test suite |
| `npm run package` | Build a release installer for this OS |
| `npm run release:check` | Tests + production build (before tagging) |

## Documentation

| Page | Contents |
|------|----------|
| [Build from source](wiki/Build-from-source.md) | Prerequisite scripts, clone, build, share installers |
| [FAQ](wiki/FAQ.md) | SSH and agent troubleshooting |
| [Release](wiki/RELEASE.md) | GitHub Actions, tagging, publishing installers |
| [Wiki index](wiki/Home.md) | All wiki pages |

## License

MIT
