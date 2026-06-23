# FAQ

## SSH and remote servers

### Authentication model

WatchPost uses **SSH public-key authentication** through the **OpenSSH agent**. It does not accept passwords or pasted private keys.

Install your **public key** on the server first (`ssh-copy-id` or `authorized_keys`). The private key stays on your PC.

Password auth may be added later; key-based auth via the agent is the supported path today.

---

### Two steps on your PC (not just the server)

| Step | What | Where |
|------|------|--------|
| 1 | **Public** key on the server | `authorized_keys` (one-time) |
| 2 | **Private** key in the **OpenSSH agent** | `ssh-add` on your machine |

PowerShell `ssh` can work after step 1 alone because it may read `~/.ssh/id_ed25519` from disk. **WatchPost uses the agent only.** Copying the `.pub` file to the server is not enough unless the matching private key is loaded.

Check before testing in the app:

```bash
ssh-add -l    # macOS / Linux / Git Bash
```

```powershell
ssh-add -l    # Windows OpenSSH
```

If this reports **no identities**, run `ssh-add` (see platform sections below), then restart WatchPost.

---

### Terminal works; WatchPost does not

| | Terminal (`ssh`) | WatchPost |
|---|------------------|-----------|
| Auth | Agent and/or key files on disk | **Agent only** |
| Process | Your shell | Desktop app (Dock, Start menu, installer) |
| Windows pipe | `\\.\pipe\openssh-ssh-agent` | Same (not PuTTY/Pageant) |

Typical case: the key file exists, terminal login works, but the agent holds no identities. The CLI falls back to the file; WatchPost does not.

---

### Error codes in diagnostics

WatchPost uses `ssh2` (libssh2). Negative numbers in `[Session(-NN)]` mark the failure stage.

| Code | Stage | Meaning | Fix |
|------|-------|---------|-----|
| **-34** | Auth | No keys in agent (or agent unreachable) | `ssh-add`, confirm `ssh-add -l`, restart app |
| **-43** | Handshake | TCP started but SSH exchange failed | Host/port/firewall/VPN; not a missing server key |

Example **-34**:

```text
agent auth failed: [Session(-34)] no identities found in the ssh agent
```

Example **-43**:

```text
SSH handshake: [Session(-43)] ...
```

`-43` is not “wrong password.” If `ssh -p PORT user@host` works from the same PC, retry WatchPost or open **Diagnostics** for the full message.

**Authentication failed** after a successful handshake means the server rejected keys — check `authorized_keys` **and** `ssh-add -l` on your PC.

---

### macOS agent setup

**1. Key pair**

```bash
ls ~/.ssh/id_ed25519 ~/.ssh/id_ed25519.pub
ssh-keygen -t ed25519 -C "your-email@example.com"   # if missing
```

**2. Load into agent**

```bash
ssh-add --apple-use-keychain ~/.ssh/id_ed25519
ssh-add -l
```

**3. Public key on server**

```bash
ssh-copy-id -p PORT user@host
ssh -p PORT user@host
```

**4. Restart WatchPost** after `ssh-add`.

Dev builds launched from the same Terminal session after `ssh-add` can help isolate environment issues. Packaged `.app` builds rely on Keychain + agent only.

---

### Windows agent setup

WatchPost uses the **OpenSSH Authentication Agent** (`ssh-agent`), often **disabled by default**. Not PuTTY, Pageant, or Git Credential Manager alone.

**1. Enable the service** (PowerShell as Administrator, once)

```powershell
Get-Service ssh-agent
Set-Service ssh-agent -StartupType Automatic
Start-Service ssh-agent
```

**2. Load private key**

```powershell
ssh-add $env:USERPROFILE\.ssh\id_ed25519
ssh-add -l
```

**3. Confirm OpenSSH client**

```powershell
Get-Command ssh    # prefer C:\Windows\System32\OpenSSH\ssh.exe
ssh -p PORT user@host
```

**4. Restart WatchPost** — fully quit (widget + main) before retesting.

| Situation | Result |
|-----------|--------|
| Public key on server, never `ssh-add` | Terminal may work; WatchPost **-34** |
| PuTTY / Pageant only | Keys not visible to WatchPost |
| `ssh-agent` stopped | Agent errors |
| Handshake **-43** | Network/firewall, not agent |

---

### Dev build vs installed app

Same authentication model. A Terminal-launched dev build may inherit shell environment; an installed app uses only the system agent. Users who never run `ssh-add` (or have Windows agent disabled) see agent errors in the installed app even when terminal `ssh` works.

---

### Add-server wizard fields

Use the same host, port, and user that work in Terminal.

| Field | Example |
|-------|---------|
| Alias | `prod-web` (display name, max 15 chars) |
| Host | IP or hostname |
| Port | `22` or custom |
| User | SSH account |

Setup-step commands run on the **machine running WatchPost**, except where they target the server explicitly.

---

### Test passes; metrics do not update

**Test connection** runs `uname` and `hostname` only. Ongoing stats use a bash metrics script (~1s, needs `bash`, `awk`, `df`, `/proc` on Linux).

Open **Diagnostics** (remote source selected) or **Run full diagnostics** in the wizard. Common causes: missing server tools, script stderr, or dropped connection after the initial test.

---

### Authentication failed (checklist)

1. Public key in `~/.ssh/authorized_keys` on the server.
2. Server permissions: `~/.ssh` `700`, `authorized_keys` `600`.
3. `ssh -p PORT user@host` from the same machine, no password prompt.
4. `ssh-add -l` lists a key before testing in WatchPost.

---

### Roadmap

A WatchPost-generated key (installed on servers as a normal public key) is under consideration to reduce agent dependency on installed builds. Until then, load your existing key into the agent.
