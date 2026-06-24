//! Step-by-step SSH + metrics diagnostics for the UI log.

use super::{collect_linux_metrics, connect_session_for, exec_capture};
use crate::store::ServerEntry;
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

pub fn diagnose_connection(entry: &ServerEntry) -> DiagnoseResult {
    let mut steps = Vec::new();
    let addr = format!("{}:{}", entry.host, entry.port);

    let _socket_addr = match addr.to_socket_addrs() {
        Ok(mut addrs) => match addrs.next() {
            Some(a) => {
                step(&mut steps, "Resolve host", true, format!("{addr} → {a}"));
                a
            }
            None => {
                step(
                    &mut steps,
                    "Resolve host",
                    false,
                    format!("no address for {addr}"),
                );
                return DiagnoseResult { ok: false, steps };
            }
        },
        Err(e) => {
            step(&mut steps, "Resolve host", false, e.to_string());
            return DiagnoseResult { ok: false, steps };
        }
    };

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

    match exec_capture(&sess, "command -v bash && command -v awk && command -v df") {
        Ok(out) => {
            let missing: Vec<&str> = ["bash", "awk", "df"]
                .into_iter()
                .filter(|t| !out.contains(t))
                .collect();
            if missing.is_empty() {
                step(&mut steps, "Required tools", true, "bash, awk, df found");
            } else {
                step(
                    &mut steps,
                    "Required tools",
                    false,
                    format!("missing: {}", missing.join(", ")),
                );
                return DiagnoseResult { ok: false, steps };
            }
        }
        Err(e) => {
            step(&mut steps, "Required tools", false, e);
            return DiagnoseResult { ok: false, steps };
        }
    }

    let metrics_start = Instant::now();
    match collect_linux_metrics(&sess, &entry.alias) {
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
