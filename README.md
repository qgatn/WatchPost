# WatchPost

Lightweight desktop monitor for your PC and remote servers. Live CPU, memory, disk, and network stats in a full dashboard and a desktop widget.

Built with [Tauri](https://tauri.app/) (Rust + system webview). Supports macOS and Windows.

## Features

- Local system metrics (CPU, memory, swap, disk, network)
- Compact desktop widget (frameless, sits below other windows)
- Low footprint — no bundled browser, timer-driven sampling
- Remote server monitoring over SSH (planned)

## Requirements

Install these before running setup:

| | macOS | Windows |
|---|-------|---------|
| Node.js 20+ (includes npm) | [nodejs.org](https://nodejs.org/) · `brew install node` | [nodejs.org](https://nodejs.org/) LTS |
| Rust | [rustup.rs](https://rustup.rs/) · `brew install rust` | [rustup.rs](https://rustup.rs/) |
| Native toolchain | `xcode-select --install` | [VS Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — *Desktop development with C++* |
| WebView | included | WebView2 (included on Windows 11) |

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
| `npm run tauri build` | Build release installer for the current OS |

Release artifacts are written to `src-tauri/target/release/bundle/`.

## Project structure

```
src/           Frontend (TypeScript, Vite)
src-tauri/     Rust backend (Tauri, metrics)
scripts/       Platform setup scripts
```

## License

MIT
