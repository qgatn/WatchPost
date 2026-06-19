//! Local machine metrics collection (M1).
//!
//! Kept deliberately small: we sample with `sysinfo`, compute a few derived
//! values (CPU %, network rates), and hand a compact `Snapshot` to the UI.

use serde::Serialize;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use sysinfo::{Disks, Networks, System};

#[derive(Serialize, Clone)]
pub struct DiskInfo {
    pub name: String,
    pub mount: String,
    pub total: u64,
    pub available: u64,
}

/// A single point-in-time snapshot of the local machine.
/// All byte values are raw bytes; the UI formats them.
#[derive(Serialize, Clone)]
pub struct Snapshot {
    pub source: String, // "local" for now; later a server id/host
    pub hostname: String,
    pub os: String,
    pub cpu_usage: f32,      // overall %, 0..100
    pub per_core: Vec<f32>,  // per-core %
    pub mem_used: u64,
    pub mem_total: u64,
    pub swap_used: u64,
    pub swap_total: u64,
    pub net_rx_bps: u64, // bytes/sec received (across all interfaces)
    pub net_tx_bps: u64, // bytes/sec transmitted
    pub disks: Vec<DiskInfo>,
    pub uptime_secs: u64,
    pub ts_ms: u128,
}

/// Stateful sampler. Holds the `System` between ticks so CPU and network
/// deltas are accurate, and tracks the last sample time to convert byte
/// counters into per-second rates.
pub struct LocalSampler {
    sys: System,
    networks: Networks,
    disks: Disks,
    last_tick: Option<Instant>,
}

impl LocalSampler {
    pub fn new() -> Self {
        let mut sys = System::new();
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        Self {
            sys,
            networks: Networks::new_with_refreshed_list(),
            disks: Disks::new_with_refreshed_list(),
            last_tick: None,
        }
    }

    /// Take a fresh sample. Should be called on a timer (e.g. every ~1s).
    pub fn sample(&mut self) -> Snapshot {
        self.sys.refresh_cpu_usage();
        self.sys.refresh_memory();
        self.networks.refresh(true);
        self.disks.refresh(true);

        let now = Instant::now();
        let elapsed = self
            .last_tick
            .map(|t| now.duration_since(t))
            .unwrap_or(Duration::from_secs(1))
            .as_secs_f64()
            .max(0.001);
        self.last_tick = Some(now);

        // Network: `received()`/`transmitted()` are deltas since last refresh,
        // so divide by elapsed seconds to get a rate.
        let (mut rx, mut tx) = (0u64, 0u64);
        for (_iface, data) in &self.networks {
            rx += data.received();
            tx += data.transmitted();
        }
        let net_rx_bps = (rx as f64 / elapsed) as u64;
        let net_tx_bps = (tx as f64 / elapsed) as u64;

        let per_core: Vec<f32> = self.sys.cpus().iter().map(|c| c.cpu_usage()).collect();

        let disks: Vec<DiskInfo> = self
            .disks
            .iter()
            .map(|d| DiskInfo {
                name: d.name().to_string_lossy().to_string(),
                mount: d.mount_point().to_string_lossy().to_string(),
                total: d.total_space(),
                available: d.available_space(),
            })
            .collect();

        let ts_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);

        Snapshot {
            source: "local".to_string(),
            hostname: System::host_name().unwrap_or_else(|| "unknown".into()),
            os: format!(
                "{} {}",
                System::name().unwrap_or_else(|| "OS".into()),
                System::os_version().unwrap_or_default()
            )
            .trim()
            .to_string(),
            cpu_usage: self.sys.global_cpu_usage(),
            per_core,
            mem_used: self.sys.used_memory(),
            mem_total: self.sys.total_memory(),
            swap_used: self.sys.used_swap(),
            swap_total: self.sys.total_swap(),
            net_rx_bps,
            net_tx_bps,
            disks,
            uptime_secs: System::uptime(),
            ts_ms,
        }
    }
}
