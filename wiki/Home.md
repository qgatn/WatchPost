# WatchPost Wiki

## Pages

| Page | Contents |
|------|----------|
| [Build from source](Build-from-source) | Prerequisites, clone, `npm run setup`, package locally |
| [FAQ](FAQ) | SSH agent setup, key files, and error codes (macOS / Windows) |
| [Windows SSH dev](windowsDev) | What we tried on Windows, libssh2 vs `ssh.exe`, shipped behavior |
| [Releasing](RELEASE) | GitHub Actions, version bump, tags |

## In the app

- **Settings** (⚙ in the main window): **General** (about, launch at login), **Widget** (position and metrics), **Servers** (add / remove SSH hosts)
- **+ Add server** — same wizard as Settings → Servers
- **Diagnostics** — live poller log and full SSH check (remote source only)

After prerequisites: [repository README](https://github.com/qgatn/WatchPost/blob/main/README.md).
