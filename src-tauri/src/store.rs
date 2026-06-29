//! Persisted SSH server list (app data dir).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthMethod {
    Agent,
    KeyFile,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerEntry {
    pub id: String,
    pub alias: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: AuthMethod,
    pub key_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewServer {
    pub alias: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: AuthMethod,
    pub key_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ServerStore {
    servers: Vec<ServerEntry>,
}

pub fn servers_path(base: PathBuf) -> PathBuf {
    base.join("servers.json")
}

pub fn load_servers(base: PathBuf) -> Result<Vec<ServerEntry>, String> {
    let path = servers_path(base);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let store: ServerStore = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(store.servers)
}

pub fn save_servers(base: PathBuf, servers: &[ServerEntry]) -> Result<(), String> {
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let path = servers_path(base);
    let store = ServerStore {
        servers: servers.to_vec(),
    };
    let raw = serde_json::to_string_pretty(&store).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

pub fn add_server(base: PathBuf, new: NewServer) -> Result<ServerEntry, String> {
    let mut servers = load_servers(base.clone())?;
    let alias = new.alias.trim();
    if alias.is_empty() {
        return Err("alias is required".into());
    }
    if servers.iter().any(|s| s.alias.eq_ignore_ascii_case(alias)) {
        return Err(format!("alias '{}' already exists", alias));
    }
    if alias.chars().count() > 15 {
        return Err("alias must be at most 15 characters".into());
    }
    let entry = ServerEntry {
        id: uuid::Uuid::new_v4().to_string(),
        alias: alias.to_string(),
        host: new.host.trim().to_string(),
        port: new.port,
        user: new.user.trim().to_string(),
        auth: new.auth,
        key_path: new
            .key_path
            .map(|p| p.trim().to_string())
            .filter(|p| !p.is_empty()),
    };
    servers.push(entry.clone());
    save_servers(base, &servers)?;
    Ok(entry)
}

pub fn remove_server(base: PathBuf, id: &str) -> Result<(), String> {
    let mut servers = load_servers(base.clone())?;
    let before = servers.len();
    servers.retain(|s| s.id != id);
    if servers.len() == before {
        return Err("server not found".into());
    }
    save_servers(base, &servers)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StackMode {
    #[default]
    Behind,
    Normal,
    OnTop,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WidgetSegments {
    pub cpu: bool,
    pub mem: bool,
    pub disk: bool,
    pub net: bool,
    pub users: bool,
}

impl Default for WidgetSegments {
    fn default() -> Self {
        Self {
            cpu: true,
            mem: true,
            disk: true,
            net: true,
            users: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetricDisplay {
    Number,
    Bar,
    #[default]
    Both,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WidgetDisplay {
    pub cpu: MetricDisplay,
    pub mem: MetricDisplay,
    pub disk: MetricDisplay,
}

impl Default for WidgetDisplay {
    fn default() -> Self {
        Self {
            cpu: MetricDisplay::Both,
            mem: MetricDisplay::Both,
            disk: MetricDisplay::Number,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WidgetPrefs {
    pub stack_mode: StackMode,
    pub segments: WidgetSegments,
    #[serde(default)]
    pub display: WidgetDisplay,
    /// User preference; OS login-item state is synced via autostart plugin on read/write.
    #[serde(default)]
    pub launch_at_login: bool,
    /// When launched at login (`--autostart`): widget only if true, main dashboard if false.
    #[serde(default = "default_show_widget_on_startup")]
    pub show_widget_on_startup: bool,
    /// Remote server poll cadence in seconds (min 1, max 60).
    #[serde(default = "default_server_poll_secs")]
    pub server_poll_secs: u64,
    #[serde(default)]
    pub ssh_client: SshClientPrefs,
    /// Small per-strip SSH launcher on remote servers in the widget.
    #[serde(default = "default_show_ssh_button")]
    pub show_ssh_button: bool,
}

fn default_show_ssh_button() -> bool {
    true
}

fn default_show_widget_on_startup() -> bool {
    true
}

fn default_server_poll_secs() -> u64 {
    3
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SshClientPreset {
    #[serde(rename = "system_default")]
    SystemDefault,
    #[serde(rename = "mac_terminal")]
    MacTerminal,
    #[serde(rename = "mac_i_term")]
    MacITerm,
    #[serde(rename = "windows_power_shell")]
    WindowsPowerShell,
    #[serde(rename = "windows_terminal")]
    WindowsTerminal,
    #[serde(rename = "moba_xterm")]
    MobaXterm,
    #[serde(rename = "pu_tty")]
    PuTTY,
    #[serde(rename = "custom")]
    Custom,
}

impl Default for SshClientPreset {
    fn default() -> Self {
        Self::SystemDefault
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SshClientPrefs {
    #[serde(default)]
    pub preset: SshClientPreset,
    /// User-selected MobaXterm.exe path (Windows). Auto-detect is used when unset.
    #[serde(default)]
    pub moba_xterm_path: Option<String>,
    /// Legacy field; ignored.
    #[serde(default)]
    pub custom_command: String,
}

impl Default for SshClientPrefs {
    fn default() -> Self {
        Self {
            preset: SshClientPreset::SystemDefault,
            moba_xterm_path: None,
            custom_command: String::new(),
        }
    }
}

impl Default for WidgetPrefs {
    fn default() -> Self {
        Self {
            stack_mode: StackMode::default(),
            segments: WidgetSegments::default(),
            display: WidgetDisplay::default(),
            launch_at_login: false,
            show_widget_on_startup: true,
            server_poll_secs: default_server_poll_secs(),
            ssh_client: SshClientPrefs::default(),
            show_ssh_button: default_show_ssh_button(),
        }
    }
}

pub fn widget_prefs_path(base: PathBuf) -> PathBuf {
    base.join("widget_prefs.json")
}

pub fn load_widget_prefs(base: PathBuf) -> Result<WidgetPrefs, String> {
    let path = widget_prefs_path(base);
    if !path.exists() {
        return Ok(WidgetPrefs::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

pub fn validate_widget_prefs(prefs: &WidgetPrefs) -> Result<(), String> {
    let s = &prefs.segments;
    if !(s.cpu || s.mem || s.disk || s.net || s.users) {
        return Err("at least one metric segment must be enabled".into());
    }
    if !(1..=60).contains(&prefs.server_poll_secs) {
        return Err("server poll interval must be between 1 and 60 seconds".into());
    }
    Ok(())
}

pub fn save_widget_prefs(base: PathBuf, prefs: &WidgetPrefs) -> Result<(), String> {
    validate_widget_prefs(prefs)?;
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let path = widget_prefs_path(base);
    let raw = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widget_prefs_default_has_one_metric() {
        let prefs = WidgetPrefs::default();
        assert!(validate_widget_prefs(&prefs).is_ok());
    }

    #[test]
    fn widget_prefs_default_disk_is_number_only() {
        let prefs = WidgetPrefs::default();
        assert_eq!(prefs.display.disk, MetricDisplay::Number);
        assert_eq!(prefs.display.cpu, MetricDisplay::Both);
    }

    #[test]
    fn widget_prefs_rejects_all_segments_off() {
        let prefs = WidgetPrefs {
            stack_mode: StackMode::Behind,
            segments: WidgetSegments {
                cpu: false,
                mem: false,
                disk: false,
                net: false,
                users: false,
            },
            display: WidgetDisplay::default(),
            launch_at_login: false,
            show_widget_on_startup: true,
            server_poll_secs: 3,
            ssh_client: SshClientPrefs::default(),
            show_ssh_button: true,
        };
        assert!(validate_widget_prefs(&prefs).is_err());
    }

    #[test]
    fn widget_prefs_startup_defaults() {
        let prefs = WidgetPrefs::default();
        assert!(!prefs.launch_at_login);
        assert!(prefs.show_widget_on_startup);
        assert_eq!(prefs.server_poll_secs, 3);
        assert_eq!(prefs.ssh_client.preset, SshClientPreset::SystemDefault);
        assert!(prefs.ssh_client.custom_command.is_empty());
        assert!(prefs.show_ssh_button);
    }

    #[test]
    fn widget_prefs_rejects_out_of_range_poll_secs() {
        let mut prefs = WidgetPrefs::default();
        prefs.server_poll_secs = 0;
        assert!(validate_widget_prefs(&prefs).is_err());
        prefs.server_poll_secs = 61;
        assert!(validate_widget_prefs(&prefs).is_err());
    }
}
