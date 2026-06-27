# Build WatchPost from source

Most people don't need this — grab a prebuilt installer from the [Releases page](https://github.com/qgatn/WatchPost/releases) instead.

Build from source when you'd rather compile it yourself, or when an unsigned installer is blocked by SmartScreen (Windows) or Gatekeeper (macOS).

Repository: **https://github.com/qgatn/WatchPost**

---

## 1. Install the prerequisites

WatchPost is a [Tauri](https://tauri.app/) app, so you need Node.js, Rust, and a C/C++ toolchain. Install them from the official sources below — they're better maintained than any script we could ship.

| Tool | macOS | Windows |
|------|-------|---------|
| **Node.js** (LTS, includes npm) | [nodejs.org](https://nodejs.org/) | [nodejs.org](https://nodejs.org/) |
| **Rust** (cargo, rustc) | [rustup.rs](https://rustup.rs/) | [rustup.rs](https://rustup.rs/) — install **after** the C++ tools below |
| **C/C++ toolchain** | Xcode Command Line Tools: `xcode-select --install` | [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) → check **Desktop development with C++** |
| **WebView** | Built into macOS | [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (preinstalled on Windows 11) |
| **Git** | Xcode CLT or [git-scm.com](https://git-scm.com/) | [git-scm.com](https://git-scm.com/download/win) |

> **Windows order matters:** install the Visual Studio C++ Build Tools first, then Rust — `rustup` picks the MSVC toolchain automatically once the compiler is present.

Open a **new** terminal after installing, then verify:

```bash
# macOS
xcode-select -p && clang --version && node --version && cargo --version
```

```powershell
# Windows (PowerShell)
where.exe cl; node --version; cargo --version; git --version
```

If any command is "not found", that tool isn't on your PATH yet — reopen the terminal, or reinstall it.

---

## 2. Clone and set up

```bash
git clone https://github.com/qgatn/WatchPost.git
cd WatchPost
npm run setup
```

`npm run setup` checks that `node`, `npm`, `cargo`, and `rustc` are available, then runs `npm install`. It also adds `~/.cargo/bin` (or `%USERPROFILE%\.cargo\bin`) to the current session so you can keep going right after installing Rust.

If PowerShell blocks the script:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
```

---

## 3. Run and package

```bash
npm run start      # dev mode — the first Rust compile can take several minutes
npm run package    # build an installer under src-tauri/target/release/bundle/
```

| OS | Installer output |
|----|------------------|
| Windows | `bundle/nsis/*-setup.exe`, `bundle/msi/*.msi` |
| macOS | `bundle/macos/WatchPost.app`, `bundle/dmg/*.dmg` |

Local builds are **unsigned**, so expect a Gatekeeper or SmartScreen prompt the first time. To run an unsigned macOS build:

```bash
xattr -dr com.apple.quarantine src-tauri/target/release/bundle/macos/WatchPost.app
```

The version and author are baked in at build time from `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/app-meta.json`. Keep the version numbers in sync with:

```bash
node scripts/sync-version.mjs 0.2.2
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `npm run setup` says cargo/rustc are missing | Reopen the terminal after installing Rust — `rustup` updates PATH for *new* shells |
| macOS `node: command not found` | `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"`, or reinstall Node |
| Windows `link.exe` / `cl` not found | Reinstall the C++ Build Tools workload, reboot, then `rustup default stable-msvc` |
| First Rust compile is very slow | Normal — later builds are incremental and much faster |
| SmartScreen flags your own `.exe` | **More info → Run anyway**, or just use `npm run start` without packaging |
| Launch at login does nothing in dev | Autostart registers the *packaged* app — use `npm run package` and install that build |
| SSH works in your terminal but not in WatchPost | See [FAQ — SSH](FAQ.md) |

---

## Related

- [README](https://github.com/qgatn/WatchPost/blob/main/README.md) — overview
- [FAQ](FAQ.md) — SSH and remote servers
- [Releasing](RELEASE.md) — how official installers are built
