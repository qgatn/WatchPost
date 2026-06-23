# Releasing WatchPost

Installers for **macOS** and **Windows** are built on GitHub Actions — you do not need a Windows machine to ship a Windows build.

## One-time setup

1. Push the repository to GitHub.
2. **Settings → Actions → General** — allow Actions.
3. No secrets required for unsigned builds (`GITHUB_TOKEN` is automatic).

Optional signing secrets (macOS notarization, Windows code signing) are documented in [Tauri distribute guides](https://v2.tauri.app/distribute/sign/macos/).

## Cut a release

**0. Verify locally**

```bash
npm run release:check
```

Runs tests, frontend build, and `tauri build` on your current OS.

**1. Bump version** in all three (must match):

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

Tag format: `v0.2.0` ↔ in-build `0.2.0`. The Rust build fails if `tauri.conf.json` and `Cargo.toml` disagree.

**2. Commit** on `main`.

**3. Tag and push**

```bash
git tag v0.2.0
git push origin main
git push origin v0.2.0
```

**4. Actions → Release** — three jobs (macOS arm64, macOS Intel, Windows).

**5. Releases** — open the **draft**, review artifacts, **Publish release**.

Pushing the same tag again does nothing; move the tag if you need to rebuild.

## What users download

| Platform | Artifact |
|----------|----------|
| macOS Apple Silicon | `.dmg` (`aarch64`) |
| macOS Intel | `.dmg` (`x64`) |
| Windows | `.msi` and/or NSIS `.exe` |

## Unsigned builds (default)

- **macOS:** Gatekeeper — right-click → **Open**, or `xattr -dr com.apple.quarantine /Applications/WatchPost.app`
- **Windows:** SmartScreen — **More info → Run anyway**

## Local package

```bash
npm run package
```

Output: `src-tauri/target/release/bundle/`. See [Build from source](Build-from-source) for sharing unsigned builds with colleagues.

## Manual workflow run

Actions → **Release** → **Run workflow** — builds without a tag (release name follows the branch; prefer tagged releases for versioned drops).
