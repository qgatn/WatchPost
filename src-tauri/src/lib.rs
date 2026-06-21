mod metrics;
mod ssh;
mod store;

use serde::Serialize;
use ssh::{DiagnoseResult, TestResult};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use store::{NewServer, ServerEntry};
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

#[derive(Clone, serde::Serialize)]
struct SourceStatus {
    source: String,
    ok: bool,
    message: String,
    ts_ms: u128,
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn emit_source_status(app: &AppHandle, source: &str, ok: bool, message: &str) {
    let _ = app.emit(
        "source-status",
        SourceStatus {
            source: source.to_string(),
            ok,
            message: message.to_string(),
            ts_ms: now_ms(),
        },
    );
}

fn entry_from_new(server: &NewServer) -> ServerEntry {
    ServerEntry {
        id: "diagnose".into(),
        alias: server.alias.clone(),
        host: server.host.clone(),
        port: server.port,
        user: server.user.clone(),
        auth: server.auth.clone(),
        key_path: server.key_path.clone(),
    }
}

struct PollerRegistry {
    stops: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl PollerRegistry {
    fn new() -> Self {
        Self {
            stops: Mutex::new(HashMap::new()),
        }
    }

    fn stop(&self, id: &str) {
        if let Some(flag) = self.stops.lock().ok().and_then(|m| m.get(id).cloned()) {
            flag.store(true, Ordering::Relaxed);
        }
    }

    /// Signal the poller to stop and drop its registry entry (used on removal).
    fn stop_and_remove(&self, id: &str) {
        if let Ok(mut map) = self.stops.lock() {
            if let Some(flag) = map.remove(id) {
                flag.store(true, Ordering::Relaxed);
            }
        }
    }

    fn start(&self, app: AppHandle, entry: ServerEntry) {
        self.stop(&entry.id);
        let stop = Arc::new(AtomicBool::new(false));
        if let Ok(mut map) = self.stops.lock() {
            map.insert(entry.id.clone(), stop.clone());
        }
        thread::spawn(move || run_server_poller(app, entry, stop));
    }
}

fn data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct SshSetupInfo {
    has_public_key: bool,
    public_key_path: Option<String>,
    public_key: Option<String>,
}

#[tauri::command]
fn list_servers(app: AppHandle) -> Result<Vec<ServerEntry>, String> {
    store::load_servers(data_dir(&app)?)
}

#[tauri::command]
fn add_server(app: AppHandle, server: NewServer) -> Result<ServerEntry, String> {
    let dir = data_dir(&app)?;
    let entry = store::add_server(dir, server)?;
    let registry = app.state::<PollerRegistry>();
    registry.start(app.clone(), entry.clone());
    let _ = app.emit("servers-changed", ());
    Ok(entry)
}

#[tauri::command]
fn remove_server(app: AppHandle, id: String) -> Result<(), String> {
    app.state::<PollerRegistry>().stop_and_remove(&id);
    store::remove_server(data_dir(&app)?, &id)?;
    let _ = app.emit("servers-changed", ());
    Ok(())
}

// Connecting can block for up to CONNECT_TIMEOUT (10s). Run on a blocking
// thread so the UI/event loop never freezes while testing a slow/bad host.
#[tauri::command]
async fn test_server(server: NewServer) -> TestResult {
    tauri::async_runtime::spawn_blocking(move || {
        let entry = ServerEntry {
            id: "test".into(),
            alias: server.alias,
            host: server.host,
            port: server.port,
            user: server.user,
            auth: server.auth,
            key_path: server.key_path,
        };
        ssh::test_connection(&entry)
    })
    .await
    .unwrap_or_else(|e| TestResult {
        ok: false,
        message: format!("internal error: {e}"),
        hostname: None,
        os: None,
        latency_ms: 0,
    })
}

#[tauri::command]
async fn diagnose_server(server: NewServer) -> DiagnoseResult {
    tauri::async_runtime::spawn_blocking(move || {
        ssh::diagnose_connection(&entry_from_new(&server))
    })
    .await
    .unwrap_or_else(|_| DiagnoseResult {
        ok: false,
        steps: Vec::new(),
    })
}

#[tauri::command]
fn get_ssh_setup_info() -> SshSetupInfo {
    if let Some((path, key)) = ssh::read_local_public_key() {
        SshSetupInfo {
            has_public_key: true,
            public_key_path: Some(path),
            public_key: Some(key),
        }
    } else {
        SshSetupInfo {
            has_public_key: false,
            public_key_path: None,
            public_key: None,
        }
    }
}

/// Toggle the desktop widget window (stays below other windows).
#[tauri::command]
fn toggle_widget(app: AppHandle) -> Result<bool, String> {
    let win = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window not found".to_string())?;
    let visible = win.is_visible().map_err(|e| e.to_string())?;
    if visible {
        win.hide().map_err(|e| e.to_string())?;
        Ok(false)
    } else {
        win.set_always_on_top(false).map_err(|e| e.to_string())?;
        win.set_always_on_bottom(true).map_err(|e| e.to_string())?;
        win.show().map_err(|e| e.to_string())?;
        let _ = app.emit("widget-shown", ());
        Ok(true)
    }
}

/// Show and focus the main dashboard. Used by widget double-click (all platforms)
/// and by the macOS dock handler below.
fn focus_main_window(app: &AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    win.show().map_err(|e| e.to_string())?;
    let _ = win.unminimize();
    win.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// Show and focus the main dashboard (e.g. after closing it while the widget stays open).
#[tauri::command]
fn show_main_window(app: AppHandle) -> Result<(), String> {
    focus_main_window(&app)
}

fn run_server_poller(app: AppHandle, entry: ServerEntry, stop: Arc<AtomicBool>) {
    const POLL_MS: u64 = 2500;
    const BACKOFF_MS: u64 = 5000;

    while !stop.load(Ordering::Relaxed) {
        let sess = match ssh::connect_session_for(&entry) {
            Ok(s) => s,
            Err(e) => {
                emit_source_status(&app, &entry.alias, false, &format!("connect: {e}"));
                thread::sleep(Duration::from_millis(BACKOFF_MS));
                continue;
            }
        };

        emit_source_status(&app, &entry.alias, true, "connected, collecting metrics");

        let mut metrics_failed = false;
        while !stop.load(Ordering::Relaxed) {
            match ssh::collect_linux_metrics(&sess, &entry.alias) {
                Ok(snapshot) => {
                    emit_source_status(&app, &entry.alias, true, "receiving metrics");
                    let _ = app.emit("metrics", &snapshot);
                }
                Err(e) => {
                    emit_source_status(&app, &entry.alias, false, &format!("metrics: {e}"));
                    metrics_failed = true;
                    break;
                }
            }
            thread::sleep(Duration::from_millis(POLL_MS));
        }

        // A metrics failure dropped us out of the inner loop; back off before
        // reconnecting so a persistent error doesn't spin a tight reconnect loop.
        if metrics_failed && !stop.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(BACKOFF_MS));
        }
    }
}

fn start_local_sampler(app: AppHandle) {
    thread::spawn(move || {
        let mut sampler = metrics::LocalSampler::new();
        thread::sleep(Duration::from_millis(300));
        loop {
            let snapshot = sampler.sample();
            if app.emit("metrics", &snapshot).is_err() {
                break;
            }
            thread::sleep(Duration::from_millis(1000));
        }
    });
}

fn start_saved_server_pollers(app: AppHandle) {
    let dir = match data_dir(&app) {
        Ok(d) => d,
        Err(_) => return,
    };
    let servers = store::load_servers(dir).unwrap_or_default();
    let registry = app.state::<PollerRegistry>();
    for entry in servers {
        registry.start(app.clone(), entry);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PollerRegistry::new())
        .invoke_handler(tauri::generate_handler![
            toggle_widget,
            show_main_window,
            list_servers,
            add_server,
            remove_server,
            test_server,
            diagnose_server,
            get_ssh_setup_info,
        ])
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Hide instead of destroy so the widget can reopen the dashboard.
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            start_local_sampler(handle.clone());
            start_saved_server_pollers(handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            #[cfg(target_os = "macos")]
            {
                // Dock icon click when main is hidden (Windows restores via taskbar instead).
                if let RunEvent::Reopen { .. } = event {
                    let _ = focus_main_window(&app_handle);
                }
            }
        });
}
