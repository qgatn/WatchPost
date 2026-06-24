//! SSH connect, test, and Linux metrics collection.

mod diagnose;
mod linux;

pub use diagnose::DiagnoseResult;

use crate::metrics::Snapshot;
use crate::store::{AuthMethod, ServerEntry};
use serde::Serialize;
use ssh2::Session;
use std::fs;
use std::io::Read;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

const LINUX_SCRIPT: &str = include_str!("../../scripts/linux_metrics.sh");
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Serialize)]
pub struct TestResult {
    pub ok: bool,
    pub message: String,
    pub hostname: Option<String>,
    pub os: Option<String>,
    pub latency_ms: u64,
}

pub fn connect_session_for(entry: &ServerEntry) -> Result<Session, String> {
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
            let agent_err = sess.userauth_agent(&entry.user).err();
            if !sess.authenticated() {
                try_default_key_files(&mut sess, &entry.user).map_err(
                    |key_err| match agent_err {
                        Some(e) => format!("agent auth failed: {e}; {key_err}"),
                        None => key_err,
                    },
                )?;
            }
        }
        AuthMethod::KeyFile => {
            let path = entry
                .key_path
                .as_deref()
                .ok_or_else(|| "key file path required".to_string())?;
            let expanded = expand_home(path);
            sess.userauth_pubkey_file(&entry.user, None, Path::new(&expanded), None)
                .map_err(|e| format!("key auth failed: {e}"))?;
        }
    }

    if !sess.authenticated() {
        return Err("authentication failed — is your public key on the server?".into());
    }
    Ok(sess)
}

fn home_dir() -> Option<String> {
    for var in ["HOME", "USERPROFILE"] {
        if let Ok(home) = std::env::var(var) {
            if !home.is_empty() {
                return Some(home);
            }
        }
    }
    None
}

fn expand_home(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = home_dir() {
            return format!("{home}/{rest}");
        }
    }
    path.to_string()
}

fn default_private_key_paths() -> Vec<String> {
    let Some(home) = home_dir() else {
        return Vec::new();
    };
    let ssh = format!("{home}/.ssh");
    ["id_ed25519", "id_rsa"]
        .into_iter()
        .map(|name| format!("{ssh}/{name}"))
        .collect()
}

/// OpenSSH CLI reads default key files when the agent is empty; match that on Windows.
fn try_default_key_files(sess: &mut Session, user: &str) -> Result<(), String> {
    for path in default_private_key_paths() {
        if !Path::new(&path).exists() {
            continue;
        }
        if sess
            .userauth_pubkey_file(user, None, Path::new(&path), None)
            .is_ok()
            && sess.authenticated()
        {
            return Ok(());
        }
    }
    Err(
        "no key in SSH agent and no default key file (~/.ssh/id_ed25519 or id_rsa) — run ssh-add or add a key"
            .into(),
    )
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
    let cmd = format!("bash -s <<'WATCHPOST_EOF'\n{LINUX_SCRIPT}\nWATCHPOST_EOF");
    let out = exec_capture(sess, &cmd)?;
    linux::parse_linux_metrics(source, &out)
}

pub fn diagnose_connection(entry: &ServerEntry) -> DiagnoseResult {
    diagnose::diagnose_connection(entry)
}

pub fn read_local_public_key() -> Option<(String, String)> {
    let home = home_dir()?;
    for name in ["id_ed25519.pub", "id_rsa.pub"] {
        let path = format!("{home}/.ssh/{name}");
        if let Ok(content) = fs::read_to_string(&path) {
            let trimmed = content.trim().to_string();
            if !trimmed.is_empty() {
                return Some((path, trimmed));
            }
        }
    }
    None
}
