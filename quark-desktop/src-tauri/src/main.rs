#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;

struct BackendState {
    url: Arc<Mutex<Option<String>>>,
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Shared slot — populated once the sidecar prints its
            // QUARK_BACKEND_PORT handshake line on stdout.
            let url_slot: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
            app.manage(BackendState { url: url_slot.clone() });

            let sidecar = app
                .shell()
                .sidecar("quark-server")
                .expect("failed to find quark-server sidecar binary");

            // QUARK_WEB_PORT=0 → Bun.serve binds to a free port and announces
            // it via stdout. Avoids EADDRINUSE collisions with stale instances
            // or other dev servers.
            let (mut rx, _child) = sidecar
                .env("QUARK_WEB_PORT", "0")
                .spawn()
                .expect("failed to spawn quark-server sidecar");

            let app_handle = app.handle().clone();
            let url_slot_for_task = url_slot.clone();

            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let s = String::from_utf8_lossy(&line);
                            let trimmed = s.trim();
                            if let Some(rest) = trimmed.strip_prefix("QUARK_BACKEND_PORT=") {
                                if let Ok(port) = rest.parse::<u16>() {
                                    let url = format!("http://127.0.0.1:{}", port);
                                    *url_slot_for_task.lock().unwrap() = Some(url.clone());
                                    println!("[sidecar] backend ready on {}", url);
                                    let _ = app_handle.emit("backend-ready", url);
                                    continue;
                                }
                            }
                            println!("[sidecar] {}", s);
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[sidecar] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Terminated(status) => {
                            eprintln!("[sidecar] exited with {:?}", status);
                            let _ = app_handle.emit(
                                "backend-failed",
                                format!("sidecar exited: {:?}", status),
                            );
                            break;
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_backend_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Synchronous Tauri commands run on a worker thread, so polling here does not
// block the UI thread. Wait up to 30s for the sidecar handshake.
#[tauri::command]
fn get_backend_url(state: tauri::State<BackendState>) -> Result<String, String> {
    for _ in 0..300 {
        if let Some(url) = state.url.lock().unwrap().clone() {
            return Ok(url);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err("Backend did not start in time".to_string())
}
