# FAQ

## SSH and remote servers

### How does WatchPost authenticate over SSH?

WatchPost uses **SSH public-key authentication** via the **OpenSSH agent**. It does not accept passwords or pasted private keys.

You must install your **public key** on the server beforehand (for example with `ssh-copy-id` or by appending to `~/.ssh/authorized_keys`). The private key remains on your computer.

---

### SSH works in my terminal but WatchPost reports an agent error. Why?

The OpenSSH client (`ssh`) and WatchPost do not load keys the same way.

| | Terminal (`ssh`) | WatchPost |
|---|------------------|-----------|
| Authentication | Agent, or key files on disk | Agent only |
| Typical launch | Shell with `SSH_AUTH_SOCK` set | Desktop app (Dock, Start menu, installer) |

A common case: your key exists at `~/.ssh/id_ed25519`, Terminal login succeeds, but the **agent holds no identities**. The CLI falls back to the key file; WatchPost does not.

The error usually appears as:

```text
agent auth failed: [Session(-34)] no identities found in the ssh agent
```

---

### How do I fix this on macOS?

**1. Confirm you have a key**

```bash
ls ~/.ssh/id_ed25519 ~/.ssh/id_ed25519.pub
```

If missing, create one:

```bash
ssh-keygen -t ed25519 -C "your-email@example.com"
```

**2. Load the key into the agent**

```bash
ssh-add --apple-use-keychain ~/.ssh/id_ed25519
ssh-add -l
```

The second command should list your key. If it reports that the agent has no identities, WatchPost will fail until this step succeeds.

**3. Install the public key on the server**

```bash
ssh-copy-id -p PORT user@host
```

**4. Verify outside WatchPost**

```bash
ssh -p PORT user@host
```

**5. Restart WatchPost**

If you are running a development build, launching from the same Terminal session after `ssh-add` can help isolate environment issues:

```bash
npm run start
```

For a packaged `.app`, a normal restart after `ssh-add` is sufficient when the key is stored in Keychain via `--apple-use-keychain`.

---

### How do I fix this on Windows?

Windows uses the **OpenSSH Authentication Agent** service. It is often disabled by default.

**1. Enable and start the agent** (PowerShell as Administrator, once per machine)

```powershell
Get-Service ssh-agent
Set-Service ssh-agent -StartupType Automatic
Start-Service ssh-agent
```

**2. Load your key**

```powershell
ssh-add $env:USERPROFILE\.ssh\id_ed25519
ssh-add -l
```

**3. Test SSH**

```powershell
ssh -p PORT user@host
```

**4. Restart WatchPost**

Keys loaded only in PuTTY/Pageant are **not** visible to WatchPost. It uses the Windows OpenSSH agent, not third-party agents.

---

### Will the packaged app behave differently from a dev build?

The authentication model is the same. The difference is how the process starts.

- **Dev build from Terminal** — may inherit shell environment variables, including access to an already-populated agent.
- **Installed app** (Dock, Applications folder, Start menu) — relies on the system agent only; no shell inheritance.

Users who never run `ssh-add` (or who have the Windows agent disabled) are more likely to see agent errors in the installed app, even when `ssh` in a terminal works.

---

### Do I put my private key into WatchPost?

No. Never paste or import a private key into the application.

Only the **public** key belongs on the server. WatchPost reads credentials from the system SSH agent on your machine.

---

### What belongs in the add-server wizard?

Use the same host, port, and username that work in Terminal.

| Field | Example |
|-------|---------|
| Alias | Display name in WatchPost (e.g. `prod-web`) |
| Host | IP or hostname |
| Port | Usually `22`; use your custom port if applicable |
| User | SSH account on the server |

The setup step shows commands to generate a key (if needed) and install the public key on the server. Copy those commands into your terminal on the **machine running WatchPost**, not on the remote server (except where the command explicitly targets the server).

---

### Test connection fails with "authentication failed"

Check in order:

1. Public key is in the server user's `~/.ssh/authorized_keys`.
2. Permissions on the server: `~/.ssh` is `700`, `authorized_keys` is `600`.
3. `ssh -p PORT user@host` works from the same machine as WatchPost, without a password prompt.
4. On macOS/Windows, `ssh-add -l` lists at least one key before testing in WatchPost.

---

### Test connection succeeds but metrics do not update

WatchPost’s **Test connection** only runs `uname` and `hostname`. Ongoing stats use a separate metrics script (~1 second, needs `bash`, `awk`, `df`, and `/proc`).

In the app, open **Diagnostics** (top bar when a remote server is selected) or **Run full diagnostics** in the add-server wizard. The log shows which step failed and the error text from the server.

Common causes:

- Missing tools on the server (`awk`, `df`, `procps`)
- Metrics script error (stderr now included in the message)
- Connection dropped after the initial test

---


### Why doesn't WatchPost use password authentication?

Password auth is less suitable for a background monitor: credentials would need secure storage, rotation is harder, and many servers disable password login. Key-based auth via the agent matches standard server-hardening practice.

Password and custom key-file options may be added in a later release.

---

### Planned improvements

We are evaluating a dedicated WatchPost key (generated by the app, installed on the server as a normal public key) to reduce dependence on the system agent, particularly for installed builds on macOS and Windows. Until then, loading your key into the agent remains the supported path.
