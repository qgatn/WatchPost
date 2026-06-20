mod metrics;

use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

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
        Ok(true)
    }
}

/// Spawn the local-metrics sampling loop. Timer-driven (no busy loop) so idle
/// CPU stays near zero. Emits a `metrics` event broadcast to all windows.
fn start_local_sampler(app: AppHandle) {
    thread::spawn(move || {
        let mut sampler = metrics::LocalSampler::new();
        // Short warmup so the first emitted CPU reading isn't zero.
        thread::sleep(Duration::from_millis(300));
        loop {
            let snapshot = sampler.sample();
            // If emitting fails the app is shutting down; stop the loop.
            if app.emit("metrics", &snapshot).is_err() {
                break;
            }
            thread::sleep(Duration::from_millis(1000));
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![toggle_widget])
        .setup(|app| {
            start_local_sampler(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
