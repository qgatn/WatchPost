# Releasing WatchPost

WatchPost ships installers for **macOS**, **Windows**, and **Linux** via GitHub Releases. Builds run on GitHub's servers — you do not need a Windows machine locally.

## One-time setup

1. Push this repository to GitHub (if not already).
2. Ensure **Actions** are enabled: repo **Settings → Actions → General → Allow all actions**.
3. No extra secrets are required for unsigned builds (`GITHUB_TOKEN` is provided automatically).

Optional later (for signed/notarized builds):

| Secret | Platform | Purpose |
|--------|----------|---------|
| `APPLE_CERTIFICATE` | macOS | Base64 `.p12` signing cert |
| `APPLE_CERTIFICATE_PASSWORD` | macOS | Cert password |
| `APPLE_SIGNING_IDENTITY` | macOS | e.g. `Developer ID Application: …` |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | macOS | Notarization |
| `TAURI_SIGNING_PRIVATE_KEY` | Windows | Code signing (optional) |

See [Tauri — Windows Code Signing](https://v2.tauri.app/distribute/sign/windows/) and [macOS Code Signing](https://v2.tauri.app/distribute/sign/macos/).

## Cut a release

1. **Bump the version** in `src-tauri/tauri.conf.json` and `package.json` (keep them in sync).

2. **Commit** the version bump on `main`.

3. **Tag and push:**

   ```bash
   git tag v0.1.0
   git push origin main
   git push origin v0.1.0
   ```

4. **Watch the workflow:** GitHub → **Actions** → **Release**. Four jobs run in parallel (macOS arm64, macOS x64, Windows, Linux).

5. **Publish the draft:** When all jobs finish, open **Releases** → the new **draft** release → review attached files → **Publish release**.

## What users download

| Platform | Typical file |
|----------|----------------|
| macOS (Apple Silicon) | `.dmg` with `aarch64` in the name |
| macOS (Intel) | `.dmg` with `x64` in the name |
| Windows | `.msi` and/or `.exe` (NSIS) |
| Linux | `.deb`, `.AppImage`, or `.rpm` |

## Unsigned builds (default)

Installers are **not code-signed**. Users may see:

- **macOS:** Gatekeeper block → right-click the app → **Open**, or remove quarantine:  
  `xattr -dr com.apple.quarantine /Applications/WatchPost.app`
- **Windows:** SmartScreen → **More info** → **Run anyway**

## Manual build (local)

Build only for the OS you are on:

```bash
npm run package
```

Artifacts: `src-tauri/target/release/bundle/`

## Trigger a build without a tag

Actions → **Release** → **Run workflow** (manual `workflow_dispatch`).
