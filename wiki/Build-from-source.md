# Build WatchPost from source

Use this when you want to run or package WatchPost locally instead of downloading a GitHub Release — for example when SmartScreen or Gatekeeper blocks an unsigned installer, or you prefer your own build.

## What gets installed

| Tool | macOS | Windows |
|------|-------|---------|
| Node.js 20+ (npm) | ✓ | ✓ |
| Rust (cargo) | ✓ | ✓ |
| C/C++ toolchain | Xcode Command Line Tools | Visual Studio Build Tools (C++) |
| WebView | Built in | WebView2 Runtime |
| Git | Recommended | ✓ (script installs if missing) |

---

## Automated install (recommended)

Run from a clone of the repository (or pass paths — see below).

### macOS (Terminal)

```bash
cd WatchPost
bash scripts/install-prerequisites-macos.sh
npm run setup
npm run start
```

### Windows (PowerShell)

Run **as Administrator** if Visual Studio Build Tools are not already installed (several GB download).

```powershell
cd WatchPost
powershell -ExecutionPolicy Bypass -File scripts/install-prerequisites-windows.ps1
npm run setup
npm run start
```

Run **`npm run setup` in the same PowerShell window** after the prerequisite script finishes — both scripts add Rust/Node to the session PATH. If you open a new terminal instead, `cargo` should still work once rustup has updated your user PATH.

### Script options

Each failed step prints what went wrong and manual fallback links. Re-run after fixing the issue.

**macOS** — `bash scripts/install-prerequisites-macos.sh --help`

| Option / env | Purpose |
|--------------|---------|
| `--brew-prefix PATH` / `WATCHPOST_BREW_PREFIX` | Homebrew location (`/opt/homebrew` or `/usr/local`) |
| `--cargo-home PATH` / `WATCHPOST_CARGO_HOME` | Rust install dir (default `~/.cargo`) |
| `--download-dir PATH` / `WATCHPOST_DOWNLOAD_DIR` | Cache for downloaded installers |
| `--skip-xcode`, `--skip-node`, `--skip-rust` | Skip a component |
| `--check-only` | Verify only; no downloads |

**Windows** — add `-Help` to the script

| Parameter / env | Purpose |
|-----------------|---------|
| `-DownloadDir` / `WATCHPOST_DOWNLOAD_DIR` | Cache (default `%TEMP%\WatchPostInstall`) |
| `-CargoHome` / `WATCHPOST_CARGO_HOME` | Rust install dir |
| `-NodeInstallDir` / `WATCHPOST_NODE_DIR` | Node.js folder if not default |
| `-SkipVS`, `-SkipWebView2`, `-SkipNode`, `-SkipRust`, `-SkipGit` | Skip a component |
| `-CheckOnly` | Verify only |

The scripts try **winget** on Windows and **Homebrew** on macOS when available, then fall back to direct downloads from nodejs.org, rustup.rs, and Microsoft.

**Xcode Command Line Tools** on macOS still require approving an Apple system dialog — the script waits up to 10 minutes and reports if they never appear.

---

## Clone the repository

```bash
git clone https://github.com/qgatn/WatchPost.git
cd WatchPost
```

---

## Project setup

```bash
npm run setup
```

Checks `node`, `npm`, `cargo`, and `rustc`, then runs `npm install`. The setup scripts add `~/.cargo/bin` (or `%USERPROFILE%\.cargo\bin`) to the **current session** so you can continue immediately after installing Rust.

On Windows, if execution policy blocks npm:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
```

---

## Run and package

```bash
npm run start      # dev mode — first compile can take several minutes
npm run package    # installer under src-tauri/target/release/bundle/
```

| OS | Typical output |
|----|----------------|
| Windows | `bundle/nsis/*-setup.exe`, `bundle/msi/*.msi` |
| macOS | `bundle/macos/WatchPost.app`, `bundle/dmg/*.dmg` |

Local builds are **unsigned**. Expect Gatekeeper or SmartScreen prompts. Colleagues need the same OS/architecture and SSH setup for remote servers ([FAQ](FAQ.md)).

Version and author are embedded at build time from `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/app-meta.json`. Keep them in sync:

```bash
node scripts/sync-version.mjs 0.2.1
```

**macOS quarantine** (unsigned local build):

```bash
xattr -dr com.apple.quarantine src-tauri/target/release/bundle/macos/WatchPost.app
```

---

## Manual install

If the scripts cannot run (locked-down corporate PC, no internet, partial installs), install each tool yourself:

| Tool | macOS | Windows |
|------|-------|---------|
| Xcode CLT | `xcode-select --install` | — |
| VS Build Tools | — | [Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) → **Desktop development with C++** |
| WebView2 | — | [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (often preinstalled on Win11) |
| Node.js LTS | [nodejs.org](https://nodejs.org/) | [nodejs.org](https://nodejs.org/) |
| Rust | [rustup.rs](https://rustup.rs/) | [rustup.rs](https://rustup.rs/) (after VS Build Tools) |
| Git | Xcode CLT / [git-scm.com](https://git-scm.com/) | [git-scm.com](https://git-scm.com/download/win) |

Verify in a **new** terminal:

```bash
# macOS
xcode-select -p && clang --version && node --version && cargo --version
```

```powershell
# Windows
where.exe cl; node --version; cargo --version; git --version
```

---

## Troubleshooting

| Symptom | What to do |
|---------|------------|
| Prerequisite script says Rust failed, summary says Rust OK | Re-run `npm run setup` in the **same** window, or open a new terminal — rustup may have installed but PATH was not refreshed yet |
| `npm run setup` reports MISSING cargo/rustc | Run the prerequisite script again, then `npm run setup` without closing the terminal |
| macOS `node: command not found` | `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"` or reinstall Node |
| Windows `link.exe` not found | Reinstall C++ workload, reboot, `rustup default stable-msvc` |
| First Rust compile very slow | Normal — later builds are incremental |
| SSH works in PowerShell, not in WatchPost | [FAQ — SSH](FAQ.md) — agent empty; app also tries default key files in `%USERPROFILE%\.ssh` |
| SmartScreen on your own `.exe` | **More info → Run anyway**, or use `npm run start` without packaging |
| Launch at login does nothing in dev | Autostart registers the packaged `.app` / `.exe` — use `npm run package` and install that build |

---

## Related

- [README](../README.md) — overview
- [RELEASE.md](RELEASE.md) — GitHub Actions installers
- [FAQ.md](FAQ.md) — SSH and remote servers
