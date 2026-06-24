# Releasing WatchPost

Windows installers are built on GitHub Actions — you do not need a Windows machine to ship a release. macOS CI can be added later when signing is set up.

## One-time setup

1. Push the repository to GitHub.
2. **Settings → Actions → General** — allow Actions.
3. No secrets required for unsigned builds (`GITHUB_TOKEN` is automatic).

Optional signing secrets (Windows code signing, macOS notarization) are documented in [Tauri distribute guides](https://v2.tauri.app/distribute/sign/windows/).

## Cut a release

**0. Verify locally**

```bash
npm run release:check
```

Runs tests, frontend build, and `tauri build` on your current OS.

**1. Bump version** in the repo (must match the tag you will push):

```bash
node scripts/sync-version.mjs 0.2.1
```

This updates `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` together. On tag push, CI runs the same script from the git tag so the built installer always matches `v0.2.1` → `0.2.1` in the app.

**2. Commit** on `main`.

**3. Tag and push** (use plain semver tags — no `-rc` prerelease suffixes):

```bash
git tag v0.2.1
git push origin main
git push origin v0.2.1
```

**4. Actions → Release** — one Windows job (`.msi` + NSIS `.exe`).

**5. Releases** — open the **draft**, confirm the installer version in **Settings → General → About**, then **Publish release**.

Pushing the same tag again does nothing; delete and recreate the tag if you need to rebuild.

## What users download

| Platform | Artifact | CI |
|----------|----------|-----|
| Windows | `.msi` and/or NSIS `.exe` | ✓ |
| macOS | `.dmg` | Local `npm run package` for now |

## Why a tag might not match the installer version

The **git tag name does not change the app by itself**. The embedded version comes from `tauri.conf.json` (and must match `Cargo.toml` / `package.json`). If you tag `v0.2.1` without bumping those files first, the installer can still show an older number.

CI fixes this on tagged builds by running `scripts/sync-version.mjs` from `github.ref_name` before `tauri build`. Locally, run the sync script before you commit and tag.

## Unsigned builds (default)

- **Windows:** SmartScreen — **More info → Run anyway**
- **macOS (local package):** Gatekeeper — right-click → **Open**, or `xattr -dr com.apple.quarantine /Applications/WatchPost.app`

## Local package

```bash
npm run package
```

Output: `src-tauri/target/release/bundle/`. See [Build from source](Build-from-source) for sharing unsigned builds with colleagues.

## Manual workflow run

Actions → **Release** → **Run workflow** — builds without syncing from a tag (uses whatever version is in the repo). Prefer tagged releases for versioned drops.
