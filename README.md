# WatchPost

Lightweight desktop monitor for your PC and remote servers. Live CPU, memory, disk, and network stats in a full dashboard and a desktop widget.

Built with [Tauri](https://tauri.app/) (Rust + system webview). Supports macOS and Windows.

## Features

- Local system metrics (CPU, memory, swap, disk, network)
- Compact desktop widget (frameless, sits below other windows)
- Remote Linux servers over SSH (agent auth, add-server wizard)
- Low footprint — no bundled browser, timer-driven sampling

## Remote servers (SSH)

WatchPost connects to Linux servers using **SSH public-key authentication** via the system **OpenSSH agent**. Password login is not supported. Install your public key on the server before adding it in the app (`ssh-copy-id` or manual `authorized_keys` entry).

If SSH works in Terminal but WatchPost reports an agent error, see the **[SSH FAQ](wiki/FAQ.md)** (macOS and Windows).

## Requirements

Node.js 20+, Rust, and a native C++ toolchain must be installed before setup. **Step-by-step install instructions (downloads, verify commands, PATH):** **[wiki/Build-from-source.md](wiki/Build-from-source.md)**.

## Getting started

```bash
git clone https://github.com/qgatn/WatchPost.git
cd WatchPost
npm run setup
npm run start
```

**macOS (Homebrew):** if `node` or `npm` is not found, prepend Homebrew to your path:

```bash
export PATH="/opt/homebrew/bin:$PATH"
```

**Windows:** if `npm run setup` fails, run the setup script directly:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
npm run start
```

The first launch compiles Rust dependencies and may take a few minutes.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run setup` | Verify prerequisites and install dependencies |
| `npm run start` | Run in development mode |
| `npm test` | Run test suite |
| `npm run package` | Build release installer for the current OS |
| `npm run release:check` | Tests + production build + package (run before pushing a tag) |
| `npm run icons` | Regenerate all app icons from `app-icon.png` |

## App icon

White lighthouse on graphite (`#1a1a1a`), generated from `src/assets/lighthouse.png`:

- `scripts/make_icon.py` → `app-icon.png`
- `npm run icons` → all platform icons under `src-tauri/icons/`
- `scripts/icon_variants.py` → local previews in `scratchpad/icon-previews/` (optional)

Requires Pillow (`pip install pillow` in a venv).

## Packaging

See **[wiki/RELEASE.md](wiki/RELEASE.md)** for the full release guide (GitHub Actions, tagging, what users download).

Quick start:

```bash
# bump version in src-tauri/tauri.conf.json + package.json, commit, then:
git tag v0.1.0
git push origin main
git push origin v0.1.0
```

GitHub Actions builds **macOS (Apple Silicon + Intel) and Windows** and attaches installers to a **draft** release. Intel Mac builds use the `macos-15-intel` runner (`macos-13` was retired in late 2025).

Local build output: `src-tauri/target/release/bundle/`

Unsigned builds: macOS Gatekeeper and Windows SmartScreen may warn on first run (see wiki).

## Project structure

```
src/           Frontend (TypeScript, Vite)
src-tauri/     Rust backend (Tauri, metrics)
scripts/       Platform setup scripts
wiki/          FAQ and wiki pages (sync to GitHub Wiki if used)
```

## Documentation

| Resource | Description |
|----------|-------------|
| [wiki/Build-from-source.md](wiki/Build-from-source.md) | Install prerequisites and build from source (macOS / Windows) |
| [wiki/FAQ.md](wiki/FAQ.md) | SSH troubleshooting, agent setup (macOS / Windows) |
| [wiki/RELEASE.md](wiki/RELEASE.md) | Tagging, GitHub Actions builds, publishing installers |
| [wiki/Home.md](wiki/Home.md) | Wiki index |

## License

MIT
