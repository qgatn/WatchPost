//! SSH connect, test, and Linux metrics collection.

mod diagnose;
mod linux;
#[cfg(windows)]
mod mobaxterm;

pub use diagnose::{diagnose_connection, DiagnoseResult};

use crate::metrics::Snapshot;
use crate::store::{AuthMethod, ServerEntry, SshClientPrefs, SshClientPreset};
use serde::Serialize;
use ssh2::Session;
use std::fs;
use std::io::Read;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

const LINUX_SCRIPT: &str = include_str!("../../scripts/linux_metrics.sh");
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

fn linux_script_unix() -> String {
    // On Windows checkouts, this file may contain CRLF. Remote bash expects LF.
    LINUX_SCRIPT.replace("\r\n", "\n")
}

#[derive(Serialize)]
pub struct TestResult {
    pub ok: bool,
    pub message: String,
    pub hostname: Option<String>,
    pub os: Option<String>,
    pub latency_ms: u64,
}

#[derive(Serialize)]
pub struct SshLaunchOutput {
    pub launcher: String,
    pub command: String,
}

struct SshInvocation {
    display_cmd: String,
}

fn shell_quote(s: &str) -> String {
    if s.chars()
        .all(|c| c.is_ascii_alphanumeric() || "/._-:@".contains(c))
    {
        return s.to_string();
    }
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Path form safe for embedding in a shell command (OpenSSH accepts `/` on Windows).
fn ssh_shell_path(path: &Path) -> String {
    let s = path.to_string_lossy();
    #[cfg(windows)]
    {
        return s.replace('\\', "/");
    }
    #[cfg(not(windows))]
    {
        s.into_owned()
    }
}

fn build_ssh_invocation(entry: &ServerEntry) -> Result<SshInvocation, String> {
    let user_host = format!("{}@{}", entry.user, entry.host);
    let mut args = vec!["-p".to_string(), entry.port.to_string()];
    if matches!(entry.auth, AuthMethod::KeyFile) {
        let path = entry
            .key_path
            .as_deref()
            .ok_or_else(|| "key file path required".to_string())?;
        let expanded = expand_home(path);
        args.push("-i".to_string());
        args.push(ssh_shell_path(&expanded));
    }
    args.push(user_host.clone());
    let cmd = std::iter::once("ssh".to_string())
        .chain(args.iter().cloned())
        .map(|v| shell_quote(&v))
        .collect::<Vec<_>>()
        .join(" ");
    Ok(SshInvocation {
        display_cmd: cmd,
    })
}

fn resolve_preset(preset: SshClientPreset) -> SshClientPreset {
    match preset {
        SshClientPreset::SystemDefault => {}
        other => return migrate_legacy_preset(other),
    }
    #[cfg(target_os = "macos")]
    {
        SshClientPreset::MacTerminal
    }
    #[cfg(target_os = "windows")]
    {
        SshClientPreset::WindowsPowerShell
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        SshClientPreset::MacTerminal
    }
}

fn migrate_legacy_preset(preset: SshClientPreset) -> SshClientPreset {
    #[cfg(target_os = "macos")]
    {
        return match preset {
            SshClientPreset::MacITerm
            | SshClientPreset::Custom
            | SshClientPreset::WindowsPowerShell
            | SshClientPreset::WindowsTerminal
            | SshClientPreset::MobaXterm
            | SshClientPreset::PuTTY => SshClientPreset::MacTerminal,
            other => other,
        };
    }
    #[cfg(target_os = "windows")]
    {
        return match preset {
            SshClientPreset::WindowsTerminal
            | SshClientPreset::PuTTY
            | SshClientPreset::Custom
            | SshClientPreset::MacTerminal
            | SshClientPreset::MacITerm => SshClientPreset::WindowsPowerShell,
            other => other,
        };
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        preset
    }
}

#[cfg(target_os = "macos")]
fn escape_applescript(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

#[allow(dead_code)]
fn resolve_custom_template(tpl: &str, entry: &ServerEntry, ssh_cmd: &str) -> String {
    let key_path = entry
        .key_path
        .as_deref()
        .map(expand_home)
        .map(|p| ssh_shell_path(&p))
        .unwrap_or_default();
    tpl.replace("{ssh_cmd}", ssh_cmd)
        .replace("{user}", &entry.user)
        .replace("{host}", &entry.host)
        .replace("{port}", &entry.port.to_string())
        .replace("{key_path}", &key_path)
}

pub fn ssh_command_for_entry(entry: &ServerEntry) -> Result<String, String> {
    Ok(build_ssh_invocation(entry)?.display_cmd)
}

#[derive(Serialize)]
pub struct SshClientInfo {
    pub moba_xterm_available: bool,
    pub moba_xterm_path: Option<String>,
    pub moba_xterm_user_configured: bool,
}

pub fn ssh_client_info(prefs: &SshClientPrefs) -> SshClientInfo {
    #[cfg(windows)]
    {
        let user_configured = prefs
            .moba_xterm_path
            .as_deref()
            .is_some_and(|p| !p.trim().is_empty());
        let resolved = mobaxterm::resolve_moba_xterm_path(prefs.moba_xterm_path.as_deref());
        SshClientInfo {
            moba_xterm_available: resolved.is_some(),
            moba_xterm_path: resolved.map(|p| p.to_string_lossy().into_owned()),
            moba_xterm_user_configured: user_configured,
        }
    }
    #[cfg(not(windows))]
    {
        let _ = prefs;
        SshClientInfo {
            moba_xterm_available: false,
            moba_xterm_path: None,
            moba_xterm_user_configured: false,
        }
    }
}

pub fn normalize_ssh_client_prefs(prefs: &mut SshClientPrefs) {
    prefs.preset = resolve_preset(prefs.preset);
    #[cfg(windows)]
    if prefs.preset == SshClientPreset::MobaXterm
        && mobaxterm::resolve_moba_xterm_path(prefs.moba_xterm_path.as_deref()).is_none()
    {
        prefs.preset = SshClientPreset::WindowsPowerShell;
    }
}

pub fn open_ssh_session(entry: &ServerEntry, prefs: &SshClientPrefs) -> Result<SshLaunchOutput, String> {
    let inv = build_ssh_invocation(entry)?;
    let preset = resolve_preset(prefs.preset);

    #[cfg(target_os = "macos")]
    {
        let mut cmd = match preset {
            SshClientPreset::MacTerminal => {
                let mut c = Command::new("osascript");
                let script = format!(
                    "tell application \"Terminal\" to do script \"{}\"",
                    escape_applescript(&inv.display_cmd)
                );
                c.arg("-e").arg(script);
                c.arg("-e")
                    .arg("tell application \"Terminal\" to activate");
                c
            }
            _ => {
                return Err("only Terminal.app is supported on macOS".into());
            }
        };
        cmd.spawn()
            .map_err(|e| format!("failed to launch SSH client: {e}"))?;
        return Ok(SshLaunchOutput {
            launcher: "MacTerminal".into(),
            command: inv.display_cmd,
        });
    }

    #[cfg(target_os = "windows")]
    {
        let mut cmd = match preset {
            SshClientPreset::WindowsPowerShell => {
                let mut c = Command::new("powershell");
                c.arg("-NoExit").arg("-Command").arg(&inv.display_cmd);
                c
            }
            SshClientPreset::MobaXterm => {
                let exe = mobaxterm::resolve_moba_xterm_path(prefs.moba_xterm_path.as_deref())
                    .ok_or_else(|| {
                        String::from(
                            "MobaXterm not found — open Settings → General, click Locate MobaXterm…, or switch to PowerShell.",
                        )
                    })?;
                let mut c = Command::new(exe);
                c.arg("-newtab").arg(&inv.display_cmd);
                c
            }
            _ => {
                return Err("only PowerShell and MobaXterm are supported on Windows".into());
            }
        };
        cmd.spawn()
            .map_err(|e| format!("failed to launch SSH client: {e}"))?;
        return Ok(SshLaunchOutput {
            launcher: format!("{preset:?}"),
            command: inv.display_cmd,
        });
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (preset, prefs);
        Err("Open SSH is currently supported on macOS and Windows only".into())
    }
}

pub(crate) fn connect_session_for(entry: &ServerEntry) -> Result<Session, String> {
    connect_session(entry)
}

fn connect_session(entry: &ServerEntry) -> Result<Session, String> {
    let addr = format!("{}:{}", entry.host, entry.port);
    let socket_addr = addr
        .to_socket_addrs()
        .map_err(|e| format!("resolve {addr}: {e}"))?
        .next()
        .ok_or_else(|| format!("no address for {addr}"))?;
    let tcp = TcpStream::connect_timeout(&socket_addr, CONNECT_TIMEOUT)
        .map_err(|e| format!("connect failed: {e}"))?;
    tcp.set_read_timeout(Some(CONNECT_TIMEOUT))
        .map_err(|e| e.to_string())?;
    tcp.set_write_timeout(Some(CONNECT_TIMEOUT))
        .map_err(|e| e.to_string())?;

    let mut sess = Session::new().map_err(|e| e.to_string())?;
    sess.set_tcp_stream(tcp);
    sess.handshake()
        .map_err(|e| format!("SSH handshake: {e}"))?;

    match entry.auth {
        AuthMethod::Agent => {
            // Prefer disk keys first (same as OpenSSH when the agent is down/empty).
            // On Windows a failed agent call can also poison libssh2's session state.
            if let Err(key_err) = try_default_key_files(&mut sess, &entry.user, &entry.host) {
                if !sess.authenticated() {
                    let mut agent_err = None;
                    if ssh_agent_available() {
                        agent_err = sess.userauth_agent(&entry.user).err();
                    }
                    if !sess.authenticated() {
                        return Err(match agent_err {
                            Some(e) => format!("{key_err}; agent auth also failed: {e}"),
                            None if !ssh_agent_available() => format!(
                                "SSH agent is not running (optional on Windows); {key_err}"
                            ),
                            None => key_err,
                        });
                    }
                }
            }
        }
        AuthMethod::KeyFile => {
            let path = entry
                .key_path
                .as_deref()
                .ok_or_else(|| "key file path required".to_string())?;
            let expanded = expand_home(path);
            auth_with_private_key(&sess, &entry.user, &expanded)
                .map_err(|e| format!("key auth failed: {e}"))?;
        }
    }

    if !sess.authenticated() {
        return Err("authentication failed — is your public key on the server?".into());
    }
    Ok(sess)
}

fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        if let Ok(home) = std::env::var("USERPROFILE") {
            if !home.is_empty() {
                return Some(PathBuf::from(home));
            }
        }
    }
    for var in ["HOME", "USERPROFILE"] {
        if let Ok(home) = std::env::var(var) {
            if !home.is_empty() {
                return Some(PathBuf::from(home));
            }
        }
    }
    None
}

/// True when an OpenSSH agent socket/pipe is present (same signals the CLI uses).
fn ssh_agent_available() -> bool {
    #[cfg(windows)]
    {
        return Path::new(r"\\.\pipe\openssh-ssh-agent").exists();
    }
    #[cfg(not(windows))]
    {
        std::env::var("SSH_AUTH_SOCK")
            .ok()
            .filter(|s| !s.is_empty())
            .map(|s| Path::new(&s).exists())
            .unwrap_or(false)
    }
}

fn expand_home(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

fn default_private_key_paths() -> Vec<PathBuf> {
    let Some(home) = home_dir() else {
        return Vec::new();
    };
    let ssh = home.join(".ssh");
    ["id_ed25519", "id_rsa"]
        .into_iter()
        .map(|name| ssh.join(name))
        .collect()
}

fn host_pattern_matches(pattern: &str, host: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    pattern.eq_ignore_ascii_case(host)
}

fn ssh_config_identity_paths(host: &str) -> Vec<PathBuf> {
    let Some(home) = home_dir() else {
        return Vec::new();
    };
    let config = home.join(".ssh").join("config");
    let Ok(raw) = fs::read_to_string(config) else {
        return Vec::new();
    };
    let mut in_matching_host = false;
    let mut paths = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let lower = trimmed.to_ascii_lowercase();
        if lower.starts_with("host ") {
            in_matching_host = trimmed
                .split_whitespace()
                .skip(1)
                .any(|p| host_pattern_matches(p, host));
            continue;
        }
        if in_matching_host && lower.starts_with("identityfile ") {
            if let Some(v) = trimmed.split_whitespace().nth(1) {
                paths.push(expand_home(v.trim_matches('"')));
            }
        }
    }
    paths
}

fn candidate_private_key_paths(host: &str) -> Vec<PathBuf> {
    let mut out = default_private_key_paths();
    for path in ssh_config_identity_paths(host) {
        if !out.iter().any(|existing| existing == &path) {
            out.push(path);
        }
    }
    out
}

fn public_key_for_private(private: &Path) -> Option<PathBuf> {
    let name = private.file_name()?.to_str()?;
    let parent = private.parent()?;
    Some(parent.join(format!("{name}.pub")))
}

/// Heuristic: OpenSSH / PEM keys with a passphrase are marked ENCRYPTED in the file.
fn private_key_likely_encrypted(path: &Path) -> bool {
    let Ok(head) = fs::read_to_string(path) else {
        return false;
    };
    let sample: String = head.chars().take(512).collect();
    sample.contains("ENCRYPTED")
}

fn format_key_auth_error(err: &ssh2::Error, private: &Path) -> String {
    let msg = err.to_string();
    if private_key_likely_encrypted(private) {
        return format!(
            "{msg} — this key has a passphrase; WatchPost cannot prompt for it. \
             Run ssh-add in PowerShell (requires ssh-agent), or recreate the key without a passphrase"
        );
    }
    if err.code() == ssh2::ErrorCode::Session(-1) {
        return format!(
            "{msg} — libssh2 could not use this key file (often a passphrase or unreadable key format). \
             Try: ssh-add, or ssh-keygen -p -f \"{}\" to remove the passphrase",
            private.display()
        );
    }
    if err.code() == ssh2::ErrorCode::Session(-19) {
        return format!(
            "{msg} — key signing failed for this file. \
             Try a non-passphrase key, or switch this server to SSH agent mode"
        );
    }
    msg
}

fn auth_with_private_key(
    sess: &Session,
    user: &str,
    private: &Path,
) -> Result<(), String> {
    let pub_key = public_key_for_private(private).filter(|p| p.exists());
    let mut last_err: Option<ssh2::Error> = None;

    // Try a few libssh2-compatible variants. Some Windows/OpenSSH key combinations
    // fail one form but succeed another, while OpenSSH CLI still works.
    for (pub_path, key_passphrase) in [
        (pub_key.as_deref(), None),
        (None, None),
        (pub_key.as_deref(), Some("")),
        (None, Some("")),
    ] {
        match sess.userauth_pubkey_file(user, pub_path, private, key_passphrase) {
            Ok(()) if sess.authenticated() => return Ok(()),
            Ok(()) => {
                return Err(
                    "server rejected the key — is the matching .pub in authorized_keys on the server?"
                        .into(),
                );
            }
            Err(e) => last_err = Some(e),
        }
    }

    match last_err {
        Some(e) => Err(format_key_auth_error(&e, private)),
        None => Err("server rejected the key".into()),
    }
}

/// OpenSSH CLI reads default key files when the agent is empty; match that on Windows.
fn try_default_key_files(
    sess: &mut Session,
    user: &str,
    host: &str,
) -> Result<(), String> {
    let paths = candidate_private_key_paths(host);
    let mut found_key = false;
    let mut last_err: Option<String> = None;

    for path in paths {
        if !path.exists() {
            continue;
        }
        found_key = true;
        match auth_with_private_key(sess, user, &path) {
            Ok(()) => return Ok(()),
            Err(e) => last_err = Some(e),
        }
    }

    if !found_key {
        return Err(
            "no default private key at ~/.ssh/id_ed25519 or id_rsa — run ssh-keygen, then install the .pub on the server"
                .into(),
        );
    }

    let detail = last_err.unwrap_or_else(|| "server rejected the key".into());
    Err(format!("could not sign in with default key file ({detail})"))
}

// Guard against a runaway/malicious remote dumping unbounded output into memory.
const MAX_STDOUT_BYTES: usize = 4 * 1024 * 1024;

fn read_channel_stdout(channel: &mut ssh2::Channel) -> Result<String, String> {
    let _ = channel.handle_extended_data(ssh2::ExtendedData::Ignore);

    // Accumulate raw bytes and decode once at the end. Decoding per-chunk can
    // split a multi-byte UTF-8 sequence across reads and corrupt the output.
    let mut out: Vec<u8> = Vec::new();
    let mut buf = [0u8; 16384];
    loop {
        let mut got = false;
        loop {
            match channel.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    got = true;
                    if out.len() + n > MAX_STDOUT_BYTES {
                        return Err(format!("remote output exceeded {} bytes", MAX_STDOUT_BYTES));
                    }
                    out.extend_from_slice(&buf[..n]);
                }
                Err(e) => return Err(format!("read stdout: {e}")),
            }
        }
        if channel.eof() {
            break;
        }
        if !got {
            thread::sleep(Duration::from_millis(20));
        }
    }
    Ok(String::from_utf8_lossy(&out).into_owned())
}

fn read_channel_stderr(channel: &mut ssh2::Channel) -> String {
    let mut out = String::new();
    let mut buf = [0u8; 4096];
    loop {
        match channel.stderr().read(&mut buf) {
            Ok(0) => break,
            Ok(n) => out.push_str(&String::from_utf8_lossy(&buf[..n])),
            Err(_) => break,
        }
    }
    out
}

fn exec_capture(sess: &Session, cmd: &str) -> Result<String, String> {
    let mut channel = sess
        .channel_session()
        .map_err(|e| format!("channel: {e}"))?;
    channel.exec(cmd).map_err(|e| format!("exec: {e}"))?;
    let stdout = read_channel_stdout(&mut channel)?;
    let stderr = read_channel_stderr(&mut channel);
    channel.wait_eof().map_err(|e| e.to_string())?;
    channel.wait_close().map_err(|e| e.to_string())?;
    let exit = channel.exit_status().map_err(|e| e.to_string())?;
    if exit != 0 {
        let err = stderr.trim();
        let out = stdout.trim();
        let detail = match (out.is_empty(), err.is_empty()) {
            (false, false) => format!("stdout: {out}\nstderr: {err}"),
            (false, true) => out.to_string(),
            (true, false) => err.to_string(),
            (true, true) => format!("exit code {exit}"),
        };
        return Err(format!("command exited {exit}: {detail}"));
    }
    Ok(stdout)
}

pub fn test_connection(entry: &ServerEntry) -> TestResult {
    #[cfg(windows)]
    if matches!(entry.auth, AuthMethod::KeyFile) {
        return test_connection_via_cli(entry);
    }
    test_connection_libssh2(entry)
}

fn test_connection_libssh2(entry: &ServerEntry) -> TestResult {
    let start = Instant::now();
    match connect_session(entry) {
        Ok(sess) => {
            let out = match exec_capture(&sess, "uname -srm; hostname") {
                Ok(o) => o,
                Err(e) => {
                    return TestResult {
                        ok: false,
                        message: e,
                        hostname: None,
                        os: None,
                        latency_ms: start.elapsed().as_millis() as u64,
                    };
                }
            };
            let mut lines: Vec<&str> = out
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .collect();
            let hostname = lines.pop().map(|s| s.to_string());
            let os = lines.first().map(|s| s.to_string());
            TestResult {
                ok: true,
                message: "connected".into(),
                hostname,
                os,
                latency_ms: start.elapsed().as_millis() as u64,
            }
        }
        Err(e) => TestResult {
            ok: false,
            message: e,
            hostname: None,
            os: None,
            latency_ms: start.elapsed().as_millis() as u64,
        },
    }
}

pub fn collect_linux_metrics(sess: &Session, source: &str) -> Result<Snapshot, String> {
    let script = linux_script_unix();
    let cmd = format!("bash -s <<'WATCHPOST_EOF'\n{script}\nWATCHPOST_EOF");
    let out = exec_capture(sess, &cmd)?;
    linux::parse_linux_metrics(source, &out)
}

#[cfg(windows)]
pub(super) fn run_ssh_cli(entry: &ServerEntry, remote_cmd: &str) -> Result<String, String> {
    let target = format!("{}@{}", entry.user, entry.host);
    let mut cmd = Command::new("ssh");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // GUI apps spawn a visible console on every ssh.exe call unless this is set.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.arg("-p")
        .arg(entry.port.to_string())
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ConnectTimeout=10");
    if matches!(entry.auth, AuthMethod::KeyFile) {
        if let Some(path) = entry.key_path.as_deref().map(expand_home) {
            cmd.arg("-i").arg(path);
        }
    }
    cmd.arg(target).arg(remote_cmd);
    let out = cmd.output().map_err(|e| format!("ssh launch failed: {e}"))?;
    if !out.status.success() {
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let detail = match (stdout.is_empty(), stderr.is_empty()) {
            (false, false) => format!("stdout: {stdout}\nstderr: {stderr}"),
            (false, true) => stdout,
            (true, false) => stderr,
            (true, true) => format!("exit {}", out.status),
        };
        return Err(format!("ssh command failed: {detail}"));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(windows)]
pub fn test_connection_via_cli(entry: &ServerEntry) -> TestResult {
    let start = Instant::now();
    match run_ssh_cli(entry, "uname -srm; hostname") {
        Ok(out) => {
            let mut lines: Vec<&str> = out
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .collect();
            let hostname = lines.pop().map(|s| s.to_string());
            let os = lines.first().map(|s| s.to_string());
            TestResult {
                ok: true,
                message: "connected (ssh.exe backend)".into(),
                hostname,
                os,
                latency_ms: start.elapsed().as_millis() as u64,
            }
        }
        Err(e) => TestResult {
            ok: false,
            message: e,
            hostname: None,
            os: None,
            latency_ms: start.elapsed().as_millis() as u64,
        },
    }
}

#[cfg(windows)]
pub fn collect_linux_metrics_via_cli(entry: &ServerEntry, source: &str) -> Result<Snapshot, String> {
    let script = linux_script_unix();
    let cmd = format!("bash -s <<'WATCHPOST_EOF'\n{script}\nWATCHPOST_EOF");
    let out = run_ssh_cli(entry, &cmd)?;
    linux::parse_linux_metrics(source, &out)
}

pub fn read_local_public_key() -> Option<(String, String)> {
    let home = home_dir()?;
    for name in ["id_ed25519.pub", "id_rsa.pub"] {
        let path = home.join(".ssh").join(name);
        if let Ok(content) = fs::read_to_string(&path) {
            let trimmed = content.trim().to_string();
            if !trimmed.is_empty() {
                return Some((path.display().to_string(), trimmed));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::AuthMethod;

    fn sample_entry(auth: AuthMethod, key_path: Option<&str>) -> ServerEntry {
        ServerEntry {
            id: "1".into(),
            alias: "prod".into(),
            host: "example.com".into(),
            port: 2202,
            user: "deploy".into(),
            auth,
            key_path: key_path.map(|s| s.to_string()),
        }
    }

    #[test]
    fn default_key_paths_use_ssh_subdir() {
        let paths = default_private_key_paths();
        if paths.is_empty() {
            return;
        }
        for path in paths {
            assert!(
                path.to_string_lossy().contains(".ssh"),
                "expected .ssh in {}",
                path.display()
            );
        }
    }

    #[test]
    fn expand_home_leaves_absolute_paths() {
        assert_eq!(
            expand_home(r"C:\Users\me\.ssh\id_ed25519"),
            PathBuf::from(r"C:\Users\me\.ssh\id_ed25519")
        );
    }

    #[test]
    fn build_ssh_invocation_omits_i_for_agent() {
        let entry = sample_entry(AuthMethod::Agent, None);
        let inv = build_ssh_invocation(&entry).expect("invocation");
        assert!(inv.display_cmd.contains("ssh -p 2202"));
        assert!(inv.display_cmd.contains("deploy@example.com"));
        assert!(!inv.display_cmd.contains(" -i "));
    }

    #[test]
    fn build_ssh_invocation_adds_i_for_key_file() {
        let entry = sample_entry(AuthMethod::KeyFile, Some("~/keys/id_ed25519"));
        let inv = build_ssh_invocation(&entry).expect("invocation");
        assert!(inv.display_cmd.contains(" -i "));
        assert!(inv.display_cmd.contains("ssh "));
        assert!(inv.display_cmd.contains("deploy@example.com"));
    }

    #[test]
    fn build_ssh_invocation_uses_forward_slashes_for_windows_key_paths() {
        let entry = ServerEntry {
            id: "1".into(),
            alias: "prod".into(),
            host: "example.com".into(),
            port: 22,
            user: "deploy".into(),
            auth: AuthMethod::KeyFile,
            key_path: Some(r"C:\Users\me\.ssh\id_ed25519".into()),
        };
        let inv = build_ssh_invocation(&entry).expect("invocation");
        assert!(inv.display_cmd.contains("-i C:/Users/me/.ssh/id_ed25519"));
        assert!(!inv.display_cmd.contains('\\'));
    }

    #[test]
    fn custom_template_replaces_placeholders() {
        let entry = sample_entry(AuthMethod::Agent, None);
        let out = resolve_custom_template(
            "tool {user}@{host}:{port} :: {ssh_cmd} :: {key_path}",
            &entry,
            "ssh -p 2202 deploy@example.com",
        );
        assert!(out.contains("tool deploy@example.com:2202"));
        assert!(out.contains("ssh -p 2202 deploy@example.com"));
    }
}
