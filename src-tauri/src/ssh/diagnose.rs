//! Step-by-step SSH + metrics diagnostics for the UI log.

use super::{collect_linux_metrics, connect_session_for, exec_capture};
#[cfg(windows)]
use super::{collect_linux_metrics_via_cli, test_connection_via_cli};
use crate::store::ServerEntry;
#[cfg(windows)]
use crate::store::AuthMethod;
use serde::Serialize;
use std::net::ToSocketAddrs;
use std::time::Instant;

#[derive(Serialize, Clone)]
pub struct DiagnoseStep {
    pub step: String,
    pub ok: bool,
    pub detail: String,
}

#[derive(Serialize, Clone)]
pub struct DiagnoseResult {
    pub ok: bool,
    pub steps: Vec<DiagnoseStep>,
}

fn step(steps: &mut Vec<DiagnoseStep>, name: &str, ok: bool, detail: impl Into<String>) {
    steps.push(DiagnoseStep {
        step: name.into(),
        ok,
        detail: detail.into(),
    });
}

fn resolve_host_step(steps: &mut Vec<DiagnoseStep>, host: &str, port: u16) -> bool {
    let addr = format!("{host}:{port}");
    match addr.to_socket_addrs() {
        Ok(mut addrs) => match addrs.next() {
            Some(a) => {
                step(steps, "Resolve host", true, format!("{addr} → {a}"));
                true
            }
            None => {
                step(
                    steps,
                    "Resolve host",
                    false,
                    format!("no address for {addr}"),
                );
                false
            }
        },
        Err(e) => {
            step(steps, "Resolve host", false, e.to_string());
            false
        }
    }
}

fn check_required_tools_step(steps: &mut Vec<DiagnoseStep>, out: Result<String, String>) -> bool {
    match out {
        Ok(out) => {
            let missing: Vec<&str> = ["bash", "awk", "df"]
                .into_iter()
                .filter(|t| !out.contains(t))
                .collect();
            if missing.is_empty() {
                step(steps, "Required tools", true, "bash, awk, df found");
                true
            } else {
                step(
                    steps,
                    "Required tools",
                    false,
                    format!("missing: {}", missing.join(", ")),
                );
                false
            }
        }
        Err(e) => {
            step(steps, "Required tools", false, e);
            false
        }
    }
}

fn finish_metrics_step(
    mut steps: Vec<DiagnoseStep>,
    metrics_start: Instant,
    result: Result<crate::metrics::Snapshot, String>,
) -> DiagnoseResult {
    match result {
        Ok(snap) => {
            step(
                &mut steps,
                "Metrics script + parse",
                true,
                format!(
                    "{} · CPU {:.0}% · {} cores · {} ms",
                    snap.hostname,
                    snap.cpu_usage,
                    snap.per_core.len(),
                    metrics_start.elapsed().as_millis()
                ),
            );
            DiagnoseResult { ok: true, steps }
        }
        Err(e) => {
            step(&mut steps, "Metrics script + parse", false, e);
            DiagnoseResult { ok: false, steps }
        }
    }
}

pub fn diagnose_connection(entry: &ServerEntry) -> DiagnoseResult {
    #[cfg(windows)]
    if matches!(entry.auth, AuthMethod::KeyFile) {
        return diagnose_via_cli(entry);
    }

    let mut steps = Vec::new();
    if !resolve_host_step(&mut steps, &entry.host, entry.port) {
        return DiagnoseResult { ok: false, steps };
    }

    let start = Instant::now();
    let sess = match connect_session_for(entry) {
        Ok(s) => {
            step(
                &mut steps,
                "SSH connect + auth",
                true,
                format!("authenticated in {} ms", start.elapsed().as_millis()),
            );
            s
        }
        Err(e) => {
            step(&mut steps, "SSH connect + auth", false, e);
            return DiagnoseResult { ok: false, steps };
        }
    };

    match exec_capture(&sess, "uname -srm; hostname") {
        Ok(out) => {
            let preview: String = out.lines().take(3).collect::<Vec<_>>().join(" · ");
            step(&mut steps, "Remote probe", true, preview);
        }
        Err(e) => {
            step(&mut steps, "Remote probe", false, e);
            return DiagnoseResult { ok: false, steps };
        }
    }

    if !check_required_tools_step(
        &mut steps,
        exec_capture(&sess, "command -v bash && command -v awk && command -v df"),
    ) {
        return DiagnoseResult { ok: false, steps };
    }

    let metrics_start = Instant::now();
    finish_metrics_step(
        steps,
        metrics_start,
        collect_linux_metrics(&sess, &entry.alias),
    )
}

#[cfg(windows)]
fn diagnose_via_cli(entry: &ServerEntry) -> DiagnoseResult {
    let mut steps = Vec::new();
    if !resolve_host_step(&mut steps, &entry.host, entry.port) {
        return DiagnoseResult { ok: false, steps };
    }

    let test = test_connection_via_cli(entry);
    if !test.ok {
        step(&mut steps, "SSH connect + auth", false, test.message);
        return DiagnoseResult { ok: false, steps };
    }
    step(
        &mut steps,
        "SSH connect + auth",
        true,
        format!("authenticated in {} ms", test.latency_ms),
    );
    let preview = [test.os.as_deref(), test.hostname.as_deref()]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" · ");
    if !preview.is_empty() {
        step(&mut steps, "Remote probe", true, preview);
    }

    if !check_required_tools_step(
        &mut steps,
        super::run_ssh_cli(entry, "command -v bash && command -v awk && command -v df"),
    ) {
        return DiagnoseResult { ok: false, steps };
    }

    let metrics_start = Instant::now();
    finish_metrics_step(
        steps,
        metrics_start,
        collect_linux_metrics_via_cli(entry, &entry.alias),
    )
}
