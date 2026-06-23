# Build WatchPost from source

Use this guide when you want to run or package WatchPost on **your own machine** instead of downloading a GitHub Release installer. This is the recommended path when:

- Windows SmartScreen or corporate security blocks downloaded `.exe` / `.msi` files
- macOS Gatekeeper blocks an unsigned `.dmg` from Releases
- You prefer a local build you compiled yourself

You need **four things** before WatchPost can compile:

| Tool | macOS | Windows |
|------|-------|---------|
| Node.js 20+ (includes npm) | Required | Required |
| Rust (includes cargo) | Required | Required |
| Native C/C++ toolchain | Xcode Command Line Tools | Visual Studio Build Tools (C++) |
| WebView | Built into macOS | WebView2 Runtime |

Install them in the order shown below for your OS, then [clone and build WatchPost](#clone-and-build).

---

## macOS

### 1. Xcode Command Line Tools

Tauri links native code; Rust on macOS needs Apple's compiler toolchain.

**Install**

1. Open **Terminal** (Applications → Utilities → Terminal).
2. Run:

   ```bash
   xcode-select --install
   ```

3. A dialog appears — click **Install** and accept the license. Download is ~1 GB; wait until it finishes.

**If you already have full Xcode** from the App Store, you can skip the dialog step, but the command line tools must still be selected:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

**Verify**

```bash
xcode-select -p
```

Expected: a path such as `/Library/Developer/CommandLineTools` or `/Applications/Xcode.app/Contents/Developer`.

```bash
clang --version
```

Expected: a line starting with `Apple clang version …`.

**PATH:** No manual PATH change needed for the command line tools.

---

### 2. Node.js (includes npm)

WatchPost uses Node for the frontend build and Tauri CLI.

**Download**

1. Open [https://nodejs.org/](https://nodejs.org/)
2. Download the **LTS** macOS installer (`.pkg`) — **20.x or newer** (22 LTS is fine).

**Install**

1. Open the downloaded `.pkg`.
2. Click through the wizard (defaults are fine).
3. The installer adds `node` and `npm` to your PATH automatically.

**Verify** — open a **new** Terminal window:

```bash
node --version
npm --version
```

Expected: `v20.x.x` or higher for Node; `10.x.x` or similar for npm.

**PATH (only if commands are not found)**

- **Apple Silicon (M1/M2/M3):** Homebrew and some installers put binaries under `/opt/homebrew/bin`. Add this to your shell profile (`~/.zshrc` on modern macOS):

  ```bash
  export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"
  ```

  Then run `source ~/.zshrc` or open a new terminal.

- **Intel Mac:** Node from nodejs.org is usually on PATH already. If not, check `/usr/local/bin`.

**Alternative (Homebrew)**

```bash
brew install node
```

Then verify with `node --version` and `npm --version` as above.

---

### 3. Rust (includes cargo)

**Download and install**

1. Open [https://rustup.rs/](https://rustup.rs/)
2. Copy the install command shown on the page, or run in Terminal:

   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

3. When prompted:
   - **Default installation** — press **Enter** (recommended).
   - It installs to `~/.cargo` and `~/.rustup`.

4. **Important:** rustup updates your shell profile (`~/.zshrc` or `~/.bash_profile`) to add `~/.cargo/bin` to PATH. Either:
   - Open a **new** Terminal window, or
   - Run: `source "$HOME/.cargo/env"`

**Verify**

```bash
rustc --version
cargo --version
```

Expected: `rustc 1.xx.x` and `cargo 1.xx.x` (any recent stable is fine).

**PATH (only if `cargo` is not found)**

Add to `~/.zshrc`:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
```

Then `source ~/.zshrc`.

---

### macOS quick checklist

Run all of these in a **new** Terminal. Every line should succeed:

```bash
xcode-select -p
clang --version
node --version    # v20+
npm --version
rustc --version
cargo --version
```

---

## Windows

Use **PowerShell** or **Windows Terminal** for the commands below. After each installer, **close and reopen** the terminal so PATH updates take effect.

### 1. Visual Studio Build Tools (C++)

Rust on Windows compiles with the **MSVC** toolchain. Install this **before** Rust.

**Download**

1. Open [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
2. Click **Download Build Tools**.
3. Run `vs_BuildTools.exe` (or similar name from the download).

**Install**

1. In the Visual Studio Installer, select the workload:
   - **Desktop development with C++**
2. On the right-hand **Installation details** panel, ensure these are checked (names may vary slightly by VS version):
   - **MSVC** v143 (or latest) **C++ x64/x86 build tools**
   - **Windows 10 SDK** or **Windows 11 SDK** (either is fine)
3. Click **Install**. This is several GB; allow time to finish.
4. Reboot if the installer asks you to.

**Verify**

Open a **new** PowerShell window:

```powershell
where.exe cl
```

Expected: a path under `Program Files\Microsoft Visual Studio\...` (e.g. `...\VC\Tools\MSVC\...\bin\Hostx64\x64\cl.exe`).

If `where.exe cl` finds nothing, open **"x64 Native Tools Command Prompt for VS 2022"** from the Start menu and run `where cl` there. For WatchPost you normally want `cl` on the default PATH after a full reboot; if not, reinstall the C++ workload or reboot once.

**PATH:** The installer configures MSVC paths via the Visual Studio environment. You usually do **not** add `cl.exe` to PATH manually.

---

### 2. WebView2 Runtime

Tauri on Windows uses Microsoft Edge WebView2 to render the UI.

**Windows 11:** Usually **already installed**. Skip to verify.

**Windows 10 or unsure**

1. Open [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)
2. Under **Evergreen Standalone Installer**, download **x64**.
3. Run the installer (defaults are fine).

**Verify**

- **Settings → Apps → Installed apps** — search for **Microsoft Edge WebView2 Runtime**, or
- Check that this folder exists:

  ```powershell
  Test-Path "C:\Program Files (x86)\Microsoft\EdgeWebView\Application"
  ```

  Expected: `True`.

**PATH:** Not applicable.

---

### 3. Node.js (includes npm)

**Download**

1. Open [https://nodejs.org/](https://nodejs.org/)
2. Download **LTS** for Windows (**.msi** installer).

**Install**

1. Run the `.msi`.
2. Accept the license.
3. Leave **"Add to PATH"** enabled (default).
4. Optional: check **"Automatically install necessary tools"** only if you want Chocolatey-related extras — **not required** if you already installed VS Build Tools above.
5. Finish the wizard.

**Verify** — new PowerShell:

```powershell
node --version
npm --version
```

Expected: `v20.x.x` or higher; npm `10.x.x` or similar.

**PATH (only if commands are not found)**

1. **Settings → System → About → Advanced system settings → Environment Variables**
2. Under **User** or **System** variables, find **Path**.
3. Confirm an entry like `C:\Program Files\nodejs\` exists.
4. If missing, add it, click OK, and open a **new** terminal.

---

### 4. Rust (includes cargo)

Install **after** Visual Studio Build Tools.

**Download**

1. Open [https://rustup.rs/](https://rustup.rs/)
2. Download and run **`rustup-init.exe`**.

**Install**

1. When the installer starts, it may detect MSVC — you should see a message that the **MSVC toolchain** is available.
2. Choose **1) Proceed with installation (default)** and press Enter.
3. Wait until it finishes.
4. Close and reopen PowerShell.

**Verify**

```powershell
rustc --version
cargo --version
```

Expected: `rustc 1.xx.x` and `cargo 1.xx.x`.

**PATH (only if `cargo` is not found)**

Rustup adds `%USERPROFILE%\.cargo\bin` to your user PATH. To check:

```powershell
$env:Path -split ';' | Select-String cargo
```

If missing, add manually:

1. **Environment Variables** (same as Node above).
2. Under **User** → **Path** → **New** → `%USERPROFILE%\.cargo\bin`
3. OK, then open a **new** terminal.

---

### 5. Git (to clone the repository)

If you do not have Git:

1. [https://git-scm.com/download/win](https://git-scm.com/download/win)
2. Run the installer (defaults are fine; **Git from the command line** is recommended).

**Verify**

```powershell
git --version
```

---

### Windows quick checklist

New PowerShell window; every command should succeed:

```powershell
where.exe cl
node --version    # v20+
npm --version
rustc --version
cargo --version
git --version
```

WebView2: folder check or visible in Installed apps (see above).

---

## Clone and build

When the checklist passes on your OS:

### 1. Get the source

```bash
git clone https://github.com/qgatn/WatchPost.git
cd WatchPost
```

(Use your fork URL if you work from a fork.)

### 2. Run project setup

This installs npm dependencies and checks tools again.

**macOS / Linux**

```bash
npm run setup
```

**Windows** (if `npm run setup` fails on execution policy):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
```

You should see green OK / checkmarks for Node, npm, cargo, and rustc.

### 3. Run the app (development)

```bash
npm run start
```

The **first** run compiles Rust crates and can take several minutes. Later starts are faster.

### 4. Build a release installer (optional)

```bash
npm run package
```

This does **not** silently install WatchPost on your machine. It **creates installer files** in `src-tauri/target/release/bundle/` that you run yourself — or zip and share with colleagues.

#### What you get (by OS)

| OS | What `npm run package` produces | How to run / share |
|----|-------------------------------|---------------------|
| **Windows** | **NSIS setup `.exe`** in `bundle/nsis/` (e.g. `WatchPost_0.1.0_x64-setup.exe`) | Double-click the setup `.exe` to install, **or** send that file to a colleague on Windows (same CPU: x64) |
| **Windows** | **`.msi`** in `bundle/msi/` (alternative installer) | Same idea — run or share the `.msi` |
| **macOS** | **`WatchPost.app`** in `bundle/macos/` | Drag to Applications, or zip the `.app` for another Mac user |
| **macOS** | **`.dmg`** in `bundle/dmg/` | Share the `.dmg` — standard Mac install flow |

There is also a raw binary (`target/release/watchpost.exe` on Windows, or the executable inside `.app` on macOS). Prefer the **setup `.exe` / `.dmg`** when sharing; installers handle WebView2 checks (Windows) and bundle resources correctly.

#### Sharing a build with colleagues

Yes — you can share your locally built installer:

1. Build on **the same OS** your colleague uses (Windows installer from Windows, Mac from Mac).
2. Match **CPU architecture** (x64 vs Apple Silicon — an arm64 Mac build will not run on Intel Mac without Rosetta in some cases; Windows builds are usually x64).
3. Send the **`bundle/nsis/*-setup.exe`** (Windows) or **`bundle/dmg/*.dmg`** (macOS).
4. Tell them to expect **SmartScreen / Gatekeeper** warnings — local builds are **unsigned** (see [FAQ](FAQ.md)). They use **More info → Run anyway** (Windows) or right-click → **Open** (macOS).
5. They still need **SSH agent setup** on their machine to use remote servers ([FAQ](FAQ.md)).

`npm run start` (dev mode) does **not** produce a shareable installer — only `npm run package` does.

#### Version and author inside the build

Every `npm run package` embeds:

| What | Where |
|------|--------|
| **Version** (e.g. `0.1.0`) | `src-tauri/tauri.conf.json` + `package.json` + `Cargo.toml` (keep in sync) |
| **Author** | `src-tauri/app-meta.json` → **Onasis Melchior** |
| **`ABOUT.md`** | Generated at build time in `src-tauri/gen/ABOUT.md`, bundled inside the app (version, build UTC timestamp, author) |
| **Windows installer metadata** | Copyright / publisher from `tauri.conf.json` bundle section |

After installing or unpacking, colleagues can open **`ABOUT.md`** from the app resources folder (e.g. `WatchPost.app/Contents/Resources/gen/ABOUT.md` on macOS, or `resources/gen/ABOUT.md` beside the installed app on Windows) to see which version they have.

To bump the version for the next release, edit **`version`** in all three: `src-tauri/tauri.conf.json`, `package.json`, and `src-tauri/Cargo.toml`. The build fails if `tauri.conf.json` and `Cargo.toml` disagree.

You can run the app directly from the bundle folder — no GitHub Release required.

**macOS tip (unsigned local build):** If macOS blocks opening the app, right-click **WatchPost.app → Open**, or remove quarantine:

```bash
xattr -dr com.apple.quarantine src-tauri/target/release/bundle/macos/WatchPost.app
```

Optional ad-hoc sign (no Apple Developer account):

```bash
codesign --force --deep --sign - src-tauri/target/release/bundle/macos/WatchPost.app
```

---

## Troubleshooting

### `npm run setup` says a tool is MISSING

Install that tool using the sections above, **close the terminal**, open a new one, and run setup again. See the **PATH** notes under Node.js and Rust in your OS section if a command is still not found.

### macOS: `node: command not found` after installing Node

Add Homebrew or node path to `~/.zshrc` (see **PATH** under [Node.js](#2-nodejs-includes-npm) above).

### Windows: build fails with `link.exe` not found or MSVC errors

Reinstall **Desktop development with C++** in Visual Studio Build Tools, reboot, then in a new PowerShell:

```powershell
rustup default stable-msvc
```

### Windows: SmartScreen still warns on your locally built `.exe`

That can happen on locked-down PCs. Running via `npm run start` (dev mode) avoids the packaged installer entirely. For packaged builds, use **More info → Run anyway** or ask IT to allow the binary path you built under your user folder.

### Rust compile is very slow the first time

Normal. `cargo` downloads and compiles dependencies once; subsequent builds are incremental.

### SSH / agent issues after the app runs

See **[FAQ — SSH and remote servers](FAQ.md)** (especially *I put my public key on the server*, *Windows*, and *error codes -34 / -43*). Common case on Windows: PowerShell `ssh` works but WatchPost fails until you run `ssh-add` and start the `ssh-agent` service.

---

## Related

- [README](../README.md) — project overview and script reference
- [RELEASE.md](RELEASE.md) — GitHub Actions installers for users who prefer downloads
- [FAQ](FAQ.md) — SSH and remote server setup
