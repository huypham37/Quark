#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri_plugin_shell::ShellExt;

struct BackendState {
    url: String,
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let port: u16 = 3001;
            let backend_url = format!("http://localhost:{}", port);

            // Spawn the sidecar
            let sidecar = app.shell()
                .sidecar("quark-server")
                .expect("failed to find quark-server sidecar binary");

            let (mut rx, _child) = sidecar
                .env("QUARK_WEB_PORT", port.to_string())
                .spawn()
                .expect("failed to spawn quark-server sidecar");

            // Store URL for the Tauri command
            app.manage(BackendState { url: backend_url.clone() });

            // Read sidecar stderr in background (logs)
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stderr(line) => {
                            eprintln!("[sidecar] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Terminated(status) => {
                            eprintln!("[sidecar] exited with {:?}", status);
                            break;
                        }
                        _ => {}
                    }
                }
            });

            println!("Sidecar spawned on {}", backend_url);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_backend_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn get_backend_url(state: tauri::State<BackendState>) -> String {
    state.url.clone()
}
