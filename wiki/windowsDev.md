# Windows SSH development notes

Brief log of what we tried while getting remote Linux monitoring working on Windows, what failed, and what shipped.

## Symptom

PowerShell `ssh user@host` worked with the key on disk, but WatchPost’s **Test connection** and metrics polling failed with libssh2 errors such as:

| Code | Typical message | What it meant |
|------|-----------------|---------------|
| **-42** | unable to connect to agent pipe | Windows OpenSSH **ssh-agent** service disabled or stopped; libssh2 tried the agent first |
| **-1** | Unable to extract public key / authentication failed | libssh2 could not load or use the private key file (format, passphrase, or Windows path quirks) |
| **-19** | Unable to sign data | Key signing failed inside libssh2 even when the same key worked in `ssh.exe` |

Setup step 2 only proves a **public** key exists locally — not that the app can authenticate with the matching private key.

Copying the public key to the server **appends** to `authorized_keys` (PowerShell `>>`, or `ssh-copy-id` on macOS). It does not wipe existing keys.

## What we tried

1. **SSH agent first (original design)** — Match Terminal on macOS by using `userauth_agent`. On Windows the agent pipe is often missing; enabling it needs admin (`Set-Service ssh-agent`). Not acceptable for a lightweight app.

2. **libssh2 disk keys only** — Try `~/.ssh/id_ed25519` / `id_rsa` before the agent; read `IdentityFile` from `~/.ssh/config`; pass explicit `.pub` alongside the private key; multiple `userauth_pubkey_file` variants. Improved agent-mode on Mac, but **key-file auth on Windows still failed** with -1 / -19 while CLI worked.

3. **Passphrase UI** — Added optional passphrase field, then removed it: our flow uses keys without a passphrase; prompting adds complexity we do not need.

4. **CRLF in metrics script** — Windows checkouts gave `linux_metrics.sh` CRLF line endings. Remote bash reported `bash: $'\r': command not found`. Fixed by normalizing to LF before sending the heredoc (both libssh2 and `ssh.exe` paths).

## What works (shipped)

### Windows + `key_file` auth → system `ssh.exe`

When a server is saved with `auth: "key_file"` (default when the wizard detects a `*.pub` key), Windows uses the same OpenSSH binary as PowerShell:

- **Test connection** → `test_connection_via_cli`
- **Diagnostics** → `diagnose_via_cli`
- **Metrics polling** → `collect_linux_metrics_via_cli` each cycle

Implementation: `src-tauri/src/ssh/mod.rs` (`run_ssh_cli`, `BatchMode=yes`, `-i` for key path), routed from `src-tauri/src/lib.rs`.

### macOS and Windows **agent** mode → libssh2 in-process

Persistent SSH session for polling; disk keys tried before agent; agent skipped when pipe/socket is absent.

### UI (add-server wizard)

- Checkbox: **Use detected key file automatically (recommended on Windows)** — on by default when a standard `*.pub` path is found.
- Saves `key_file` with the private path (`.pub` minus suffix).
- PowerShell copy command uses the **detected** public key path, not a hardcoded `id_ed25519.pub`.

## Platform split (intentional)

| | macOS | Windows `key_file` | Windows `agent` |
|---|--------|-------------------|-----------------|
| Backend | libssh2 | `ssh.exe` subprocess | libssh2 |
| Agent required | No (keys on disk) | No | Optional |
| Polling | Persistent session | New `ssh` per poll | Persistent session |

## Local dev gotchas (not app bugs)

- **Application Control / os error 4551** when running unsigned debug builds — use `cargo check` in restricted environments; run the built app locally where policy allows.
- **`Chrome_WidgetWin_0` / WebView2** messages on exit — harmless shutdown noise from the embedded browser.

## Key files

- `src-tauri/src/ssh/mod.rs` — auth, CLI backend, CRLF fix
- `src-tauri/src/ssh/diagnose.rs` — step-by-step diagnostics
- `src-tauri/src/lib.rs` — poller routing
- `src/main.ts`, `src/servers.ts` — wizard and setup commands
