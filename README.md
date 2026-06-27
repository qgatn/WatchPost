# WatchPost

Lightweight desktop monitor for your PC and remote Linux servers — live CPU, memory, disk, and network in a dashboard and a desktop widget.

Built with [Tauri](https://tauri.app/) (Rust + system webview). Runs on macOS and Windows.

**Project home:** https://github.com/qgatn/WatchPost

## Features

- **Local metrics** — CPU, memory, disk, network, and active users for your PC
- **Desktop widget** — frameless strip with configurable stack position, metrics, and display style
- **Remote Linux servers** — SSH monitoring with add-server wizard and diagnostics (no agent on the server)
- **Settings** — General (about, launch at login), Widget preferences, and server management (add / remove)
- **Launch at login** — optional autostart on Windows and macOS; open the app or widget only
- **Low footprint** — timer-driven sampling, no bundled browser

## Install

Grab a prebuilt installer for macOS or Windows from the **[Releases page](https://github.com/qgatn/WatchPost/releases)**. Installers are unsigned, so the first launch may show a Gatekeeper (macOS) or SmartScreen (Windows) prompt — choose to open/run anyway.

## Build from source

Prefer to compile it yourself? You'll need Node.js, Rust, and a C/C++ toolchain (see the [build guide](wiki/Build-from-source.md) for official download links).

```bash
git clone https://github.com/qgatn/WatchPost.git
cd WatchPost
npm run setup    # checks your toolchain, then installs dependencies
npm run start    # dev mode (the first Rust compile takes a few minutes)
```

Full prerequisites and troubleshooting: **[wiki/Build-from-source.md](wiki/Build-from-source.md)**.

Setting up SSH for remote servers: **[wiki/FAQ.md](wiki/FAQ.md)**.

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
| `npm run setup` | Verify your toolchain and install npm dependencies |
| `npm run start` | Run in development mode |
| `npm test` | Run test suite |
| `npm run package` | Build a release installer for this OS |
| `npm run release:check` | Tests + production build (before tagging) |

## Documentation

| Page | Contents |
|------|----------|
| [Build from source](wiki/Build-from-source.md) | Prerequisites, clone, build, package locally |
| [FAQ](wiki/FAQ.md) | SSH and agent troubleshooting |
| [Release](wiki/RELEASE.md) | GitHub Actions, tagging, publishing installers |
| [Wiki index](wiki/Home.md) | All wiki pages |

## License

MIT
