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
use store::{NewServer, ServerEntry, StackMode, WidgetPrefs};
use tauri::RunEvent;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WindowEvent};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri_plugin_autostart::ManagerExt;

static HIDING_MAIN: AtomicBool = AtomicBool::new(false);
const AUTOSTART_ARG: &str = "--autostart";

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

struct ActiveUsersState(Arc<Mutex<metrics::ActiveUsersTracker>>);

fn data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn any_window_visible(app: &AppHandle) -> bool {
    ["main", "widget"].iter().any(|label| {
        app.get_webview_window(label)
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false)
    })
}

fn on_window_hidden(app: &AppHandle) {
    if !any_window_visible(app) {
        app.exit(0);
    }
}

fn invalidate_active_users(app: &AppHandle) {
    if let Some(state) = app.try_state::<ActiveUsersState>() {
        if let Ok(mut tracker) = state.0.lock() {
            tracker.invalidate();
        }
    }
}

/// Poll `query user` / `who` only when the main dashboard or widget Users segment needs it.
fn active_users_needed(app: &AppHandle) -> bool {
    let main_visible = app
        .get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    if main_visible {
        return true;
    }
    data_dir(app)
        .ok()
        .and_then(|d| store::load_widget_prefs(d).ok())
        .map(|p| p.segments.users)
        .unwrap_or(false)
}

fn apply_widget_stack_mode(win: &WebviewWindow, mode: StackMode) -> Result<(), String> {
    match mode {
        StackMode::Behind => {
            win.set_always_on_top(false).map_err(|e| e.to_string())?;
            win.set_always_on_bottom(true).map_err(|e| e.to_string())?;
        }
        StackMode::Normal => {
            win.set_always_on_top(false).map_err(|e| e.to_string())?;
            win.set_always_on_bottom(false).map_err(|e| e.to_string())?;
        }
        StackMode::OnTop => {
            win.set_always_on_bottom(false).map_err(|e| e.to_string())?;
            win.set_always_on_top(true).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn apply_widget_prefs_to_window(app: &AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window not found".to_string())?;
    if !win.is_visible().map_err(|e| e.to_string())? {
        return Ok(());
    }
    let prefs = store::load_widget_prefs(data_dir(app)?)?;
    apply_widget_stack_mode(&win, prefs.stack_mode)
}

fn launched_by_autostart() -> bool {
    std::env::args().any(|a| a == AUTOSTART_ARG)
}

fn show_widget_window(app: &AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window not found".to_string())?;
    let prefs = store::load_widget_prefs(data_dir(app)?)?;
    apply_widget_stack_mode(&win, prefs.stack_mode)?;
    win.show().map_err(|e| e.to_string())?;
    let _ = app.emit("widget-shown", ());
    Ok(())
}

fn apply_autostart_launch(app: &AppHandle) -> Result<(), String> {
    let prefs = store::load_widget_prefs(data_dir(app)?).unwrap_or_default();
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    if prefs.show_widget_on_startup {
        show_widget_window(app)?;
    } else if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn sync_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        app.autolaunch().enable().map_err(|e| e.to_string())?;
    } else {
        app.autolaunch().disable().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn sync_autostart(_app: &AppHandle, _enabled: bool) -> Result<(), String> {
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn read_autostart_enabled(app: &AppHandle) -> Option<bool> {
    app.autolaunch().is_enabled().ok()
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn read_autostart_enabled(_app: &AppHandle) -> Option<bool> {
    None
}

#[derive(Serialize)]
struct SshSetupInfo {
    has_public_key: bool,
    public_key_path: Option<String>,
    public_key: Option<String>,
}

/// Build-time metadata (version, author, UTC timestamp). Also written to bundled `ABOUT.md`.
#[derive(Serialize)]
struct AppAbout {
    product: &'static str,
    version: &'static str,
    author: &'static str,
    copyright: &'static str,
    build_utc: &'static str,
}

#[tauri::command]
fn get_app_about() -> AppAbout {
    AppAbout {
        product: "WatchPost",
        version: env!("WATCHPOST_VERSION"),
        author: env!("WATCHPOST_AUTHOR"),
        copyright: env!("WATCHPOST_COPYRIGHT"),
        build_utc: env!("WATCHPOST_BUILD_UTC"),
    }
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
    tauri::async_runtime::spawn_blocking(move || ssh::diagnose_connection(&entry_from_new(&server)))
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

#[tauri::command]
fn get_widget_prefs(app: AppHandle) -> Result<WidgetPrefs, String> {
    let mut prefs = store::load_widget_prefs(data_dir(&app)?)?;
    if let Some(enabled) = read_autostart_enabled(&app) {
        prefs.launch_at_login = enabled;
    }
    Ok(prefs)
}

#[tauri::command]
fn set_widget_prefs(app: AppHandle, prefs: WidgetPrefs) -> Result<(), String> {
    let prev = store::load_widget_prefs(data_dir(&app)?).ok();
    store::save_widget_prefs(data_dir(&app)?, &prefs)?;
    if prev.map(|p| p.launch_at_login) != Some(prefs.launch_at_login) {
        sync_autostart(&app, prefs.launch_at_login)?;
    }
    apply_widget_prefs_to_window(&app)?;
    if prefs.segments.users {
        invalidate_active_users(&app);
    }
    let _ = app.emit("widget-prefs-changed", &prefs);
    Ok(())
}

fn hide_widget_window(app: &AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window not found".to_string())?;
    if win.is_visible().map_err(|e| e.to_string())? {
        win.hide().map_err(|e| e.to_string())?;
        let _ = app.emit("widget-hidden", ());
        on_window_hidden(app);
    }
    Ok(())
}

/// Hide the widget window (no-op if already hidden).
#[tauri::command]
fn hide_widget(app: AppHandle) -> Result<(), String> {
    hide_widget_window(&app)
}

/// Whether the main dashboard window is currently visible.
#[tauri::command]
fn is_main_visible(app: AppHandle) -> Result<bool, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?
        .is_visible()
        .map_err(|e| e.to_string())
}

/// Exit the application.
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Toggle the desktop widget window show/hide.
#[tauri::command]
fn toggle_widget(app: AppHandle) -> Result<bool, String> {
    let win = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window not found".to_string())?;
    let visible = win.is_visible().map_err(|e| e.to_string())?;
    if visible {
        hide_widget_window(&app)?;
        Ok(false)
    } else {
        show_widget_window(&app)?;
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
    invalidate_active_users(app);
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

fn start_local_sampler(app: AppHandle, users: Arc<Mutex<metrics::ActiveUsersTracker>>) {
    thread::spawn(move || {
        let mut sampler = metrics::LocalSampler::new();
        thread::sleep(Duration::from_millis(300));
        loop {
            let needed = active_users_needed(&app);
            let snapshot = {
                let mut tracker = users
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                sampler.sample(&mut tracker, needed)
            };
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
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args([AUTOSTART_ARG])
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .manage(PollerRegistry::new())
        .invoke_handler(tauri::generate_handler![
            toggle_widget,
            hide_widget,
            quit_app,
            is_main_visible,
            show_main_window,
            list_servers,
            add_server,
            remove_server,
            test_server,
            diagnose_server,
            get_ssh_setup_info,
            get_app_about,
            get_widget_prefs,
            set_widget_prefs,
        ])
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Hide instead of destroy so the widget can reopen the dashboard.
                api.prevent_close();
                HIDING_MAIN.store(true, Ordering::SeqCst);
                let _ = window.hide();
                on_window_hidden(window.app_handle());
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let users_tracker = Arc::new(Mutex::new(metrics::ActiveUsersTracker::new()));
            app.manage(ActiveUsersState(users_tracker.clone()));
            start_local_sampler(handle.clone(), users_tracker);
            start_saved_server_pollers(handle.clone());
            if launched_by_autostart() {
                let _ = apply_autostart_launch(&handle);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { api, .. } = &event {
                // macOS may emit ExitRequested when main is hidden via ✕; keep running if widget is up.
                if HIDING_MAIN.swap(false, Ordering::SeqCst) && any_window_visible(&app_handle) {
                    api.prevent_exit();
                }
            }
            #[cfg(target_os = "macos")]
            {
                // Dock icon click when main is hidden (Windows restores via taskbar instead).
                if let RunEvent::Reopen { .. } = event {
                    let _ = focus_main_window(&app_handle);
                }
            }
        });
}
