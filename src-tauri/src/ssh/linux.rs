//! Parse Linux metrics JSON from `linux_metrics.sh`.

use crate::metrics::{DiskInfo, Snapshot};
use serde::Deserialize;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Deserialize)]
struct LinuxMetrics {
    hostname: String,
    os: String,
    cpu_usage: f32,
    per_core: Vec<f32>,
    cpu_cores: usize,
    physical_cores: usize,
    mem_used: u64,
    mem_total: u64,
    swap_used: u64,
    swap_total: u64,
    net_rx_bps: u64,
    net_tx_bps: u64,
    disks: Vec<DiskInfo>,
    uptime_secs: u64,
    active_users: usize,
}

pub fn parse_linux_metrics(source: &str, raw: &str) -> Result<Snapshot, String> {
    let line = raw
        .lines()
        .map(str::trim)
        .find(|l| l.starts_with('{'))
        .ok_or_else(|| format!("no JSON in metrics output ({} bytes)", raw.len()))?;
    let m: LinuxMetrics = serde_json::from_str(line).map_err(|e| {
        let len = line.len();
        // Take the last ~120 *characters* (not bytes) so we never slice
        // through a multi-byte UTF-8 boundary and panic.
        let tail: String = {
            let chars: Vec<char> = line.chars().collect();
            if chars.len() > 120 {
                let snippet: String = chars[chars.len() - 120..].iter().collect();
                format!("…{snippet}")
            } else {
                line.to_string()
            }
        };
        format!("parse error: {e} — json {len} bytes, tail: {tail}")
    })?;
    let ts_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    Ok(Snapshot {
        source: source.to_string(),
        hostname: m.hostname,
        os: m.os,
        cpu_usage: m.cpu_usage,
        per_core: m.per_core,
        cpu_cores: m.cpu_cores,
        physical_cores: m.physical_cores,
        mem_used: m.mem_used,
        mem_total: m.mem_total,
        swap_used: m.swap_used,
        swap_total: m.swap_total,
        net_rx_bps: m.net_rx_bps,
        net_tx_bps: m.net_tx_bps,
        disks: m.disks,
        uptime_secs: m.uptime_secs,
        active_users: m.active_users,
        ts_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sample_json() {
        let raw = r#"noise
{"hostname":"srv","os":"Linux 6.8","cpu_usage":12.5,"per_core":[10.0,15.0],"cpu_cores":2,"physical_cores":2,"mem_used":1000,"mem_total":2000,"swap_used":0,"swap_total":0,"net_rx_bps":1024,"net_tx_bps":512,"disks":[{"name":"/dev/sda1","mount":"/","total":1000,"available":250}],"uptime_secs":3600,"active_users":1}
"#;
        let snap = parse_linux_metrics("prod", raw).expect("parse");
        assert_eq!(snap.source, "prod");
        assert_eq!(snap.hostname, "srv");
        assert_eq!(snap.cpu_cores, 2);
        assert_eq!(snap.net_rx_bps, 1024);
    }
}
