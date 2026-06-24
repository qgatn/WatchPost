//! Local machine metrics collection (M1).
//!
//! Kept deliberately small: we sample with `sysinfo`, compute a few derived
//! values (CPU %, network rates), and hand a compact `Snapshot` to the UI.

use serde::{Deserialize, Serialize};
use std::process::Command;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use sysinfo::{Disks, Networks, System};

/// How often to re-run `query user` / `who` when active users are needed.
pub const ACTIVE_USERS_POLL_INTERVAL: Duration = Duration::from_secs(30);

/// Cached active-user count with throttled subprocess polling.
pub struct ActiveUsersTracker {
    cached: usize,
    last_poll: Option<Instant>,
}

impl ActiveUsersTracker {
    pub fn new() -> Self {
        Self {
            cached: 0,
            last_poll: None,
        }
    }

    /// When `needed` is false, returns the cache without spawning a subprocess.
    /// When `needed` is true, refreshes at most every [`ACTIVE_USERS_POLL_INTERVAL`].
    pub fn value(&mut self, needed: bool) -> usize {
        if !needed {
            return self.cached;
        }
        let stale = self
            .last_poll
            .map(|t| t.elapsed() >= ACTIVE_USERS_POLL_INTERVAL)
            .unwrap_or(true);
        if stale {
            self.cached = count_active_users();
            self.last_poll = Some(Instant::now());
        }
        self.cached
    }

    /// Next `value(true)` will poll immediately (e.g. main opened or Users segment enabled).
    pub fn invalidate(&mut self) {
        self.last_poll = None;
    }
}

/// Count logged-in sessions (console + SSH/tty). Used locally now; SSH remotes later.
pub fn count_active_users() -> usize {
    #[cfg(target_family = "unix")]
    {
        return Command::new("who")
            .output()
            .ok()
            .map(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .filter(|l| !l.trim().is_empty())
                    .count()
            })
            .unwrap_or(0);
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // GUI apps spawn visible console windows unless CREATE_NO_WINDOW is set.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        return Command::new("query")
            .creation_flags(CREATE_NO_WINDOW)
            .arg("user")
            .output()
            .ok()
            .map(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .skip(1) // header
                    .filter(|l| {
                        let t = l.trim();
                        !t.is_empty() && !t.starts_with("No User exists")
                    })
                    .count()
            })
            .unwrap_or(0);
    }
    #[cfg(not(any(target_family = "unix", target_os = "windows")))]
    {
        0
    }
}

/// Convert byte deltas since the last refresh into bytes-per-second rates.
pub fn compute_net_bps(rx: u64, tx: u64, elapsed_secs: f64) -> (u64, u64) {
    let elapsed = elapsed_secs.max(0.001);
    ((rx as f64 / elapsed) as u64, (tx as f64 / elapsed) as u64)
}

/// Disk used percentage from total and available byte counts.
/// Shared helper for tests now; remote SSH parsers will reuse it in M3+.
#[cfg_attr(not(test), allow(dead_code))]
pub fn disk_used_pct(total: u64, available: u64) -> f32 {
    if total == 0 {
        return 0.0;
    }
    let used = total.saturating_sub(available);
    (used as f64 / total as f64 * 100.0) as f32
}

#[derive(Serialize, Deserialize, Clone, Debug)]
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
    pub cpu_usage: f32,     // overall %, 0..100
    pub per_core: Vec<f32>, // per-core %
    pub cpu_cores: usize,   // logical core count
    pub physical_cores: usize,
    pub mem_used: u64,
    pub mem_total: u64,
    pub swap_used: u64,
    pub swap_total: u64,
    pub net_rx_bps: u64, // bytes/sec received (across all interfaces)
    pub net_tx_bps: u64, // bytes/sec transmitted
    pub disks: Vec<DiskInfo>,
    pub uptime_secs: u64,
    pub active_users: usize,
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
    pub fn sample(&mut self, users: &mut ActiveUsersTracker, users_needed: bool) -> Snapshot {
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
        let (net_rx_bps, net_tx_bps) = compute_net_bps(rx, tx, elapsed);

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
            cpu_cores: self.sys.cpus().len(),
            physical_cores: self.sys.physical_core_count().unwrap_or(0),
            mem_used: self.sys.used_memory(),
            mem_total: self.sys.total_memory(),
            swap_used: self.sys.used_swap(),
            swap_total: self.sys.total_swap(),
            net_rx_bps,
            net_tx_bps,
            disks,
            uptime_secs: System::uptime(),
            active_users: users.value(users_needed),
            ts_ms,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compute_net_bps_converts_deltas_to_rates() {
        let (rx, tx) = compute_net_bps(2048, 1024, 2.0);
        assert_eq!(rx, 1024);
        assert_eq!(tx, 512);
    }

    #[test]
    fn compute_net_bps_avoids_divide_by_zero() {
        let (rx, tx) = compute_net_bps(100, 50, 0.0);
        assert_eq!(rx, 100_000);
        assert_eq!(tx, 50_000);
    }

    #[test]
    fn disk_used_pct_handles_empty_and_partial() {
        assert_eq!(disk_used_pct(0, 0), 0.0);
        assert!((disk_used_pct(1000, 250) - 75.0).abs() < f32::EPSILON);
    }

    #[test]
    fn snapshot_serializes_expected_fields() {
        let snap = Snapshot {
            source: "local".into(),
            hostname: "test-host".into(),
            os: "TestOS 1.0".into(),
            cpu_usage: 12.5,
            per_core: vec![10.0, 15.0],
            cpu_cores: 2,
            physical_cores: 2,
            mem_used: 4_000_000_000,
            mem_total: 16_000_000_000,
            swap_used: 0,
            swap_total: 0,
            net_rx_bps: 1024,
            net_tx_bps: 512,
            disks: vec![DiskInfo {
                name: "disk0".into(),
                mount: "/".into(),
                total: 1_000_000,
                available: 250_000,
            }],
            uptime_secs: 3600,
            active_users: 2,
            ts_ms: 1_700_000_000_000,
        };

        let json = serde_json::to_value(&snap).expect("serialize snapshot");
        assert_eq!(json["source"], "local");
        assert_eq!(json["hostname"], "test-host");
        assert_eq!(json["cpu_usage"], 12.5);
        assert_eq!(json["per_core"], serde_json::json!([10.0, 15.0]));
        assert_eq!(json["net_rx_bps"], 1024);
        assert_eq!(json["active_users"], 2);
        assert_eq!(json["disks"][0]["mount"], "/");
    }

    #[test]
    fn active_users_tracker_skips_poll_when_not_needed() {
        let mut tracker = ActiveUsersTracker::new();
        tracker.cached = 7;
        tracker.last_poll = Some(Instant::now());
        assert_eq!(tracker.value(false), 7);
    }

    #[test]
    fn active_users_tracker_invalidate_marks_stale() {
        let mut tracker = ActiveUsersTracker::new();
        tracker.last_poll = Some(Instant::now());
        tracker.invalidate();
        assert!(tracker.last_poll.is_none());
    }

    #[test]
    fn local_sampler_produces_local_source() {
        let mut sampler = LocalSampler::new();
        let mut tracker = ActiveUsersTracker::new();
        std::thread::sleep(Duration::from_millis(50));
        let snap = sampler.sample(&mut tracker, false);
        assert_eq!(snap.source, "local");
        assert!(!snap.hostname.is_empty());
        assert!(snap.mem_total > 0);
    }
}
