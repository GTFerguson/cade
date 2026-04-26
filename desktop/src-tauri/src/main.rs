// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod port;
mod python;
mod remote_profiles;
mod ssh_tunnel;
mod tunnel_registry;

use config::AppConfig;
use port::find_available_port;
use python::PythonProcess;
use tunnel_registry::TunnelRegistry;
use std::sync::Mutex;
use tauri::Manager;

struct AppState {
    backend: Mutex<Option<PythonProcess>>,
    tunnels: TunnelRegistry,
}

#[tauri::command]
fn start_ssh_tunnel(
    state: tauri::State<AppState>,
    ssh_host: String,
    local_port: u16,
    remote_port: u16,
    ssh_user: Option<String>,
    ssh_key_path: Option<String>,
) -> Result<u32, String> {
    state.tunnels.start_or_reuse(ssh_host, local_port, remote_port, ssh_user, ssh_key_path)
}

#[tauri::command]
fn stop_ssh_tunnel(
    state: tauri::State<AppState>,
    tunnel_pid: u32,
) -> Result<(), String> {
    state.tunnels.stop(tunnel_pid)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            remote_profiles::load_remote_profiles,
            remote_profiles::save_remote_profiles,
            start_ssh_tunnel,
            stop_ssh_tunnel,
        ])
        .setup(|app| {
            // Load configuration
            let config = AppConfig::load();

            let (backend_url, backend_process) = if config.remote_backend.enabled {
                // Remote mode: use configured remote backend URL
                println!("Remote backend mode enabled");
                println!("Remote backend URL: {}", config.remote_backend.url);

                (config.remote_backend.url.clone(), None)
            } else {
                // Local mode: start local Python backend
                println!("Local backend mode");

                // Find an available port
                let port = find_available_port()
                    .map_err(|e| format!("Failed to find available port: {}", e))?;

                println!("Found available port: {}", port);

                let backend_url = format!("http://127.0.0.1:{}", port);

                // Resolve Tauri resource directory (contains ms-playwright, usage-rule.md, etc.)
                let resource_dir = app.path().resource_dir().ok();

                // Start Python backend
                let mut backend = PythonProcess::start(port, resource_dir)
                    .map_err(|e| format!("Failed to start backend: {}", e))?;

                println!("Backend started on port {} (PID: {:?})", port, backend.pid());

                // Wait for backend to be ready (poll the HTTP endpoint)
                if !wait_for_backend(&backend_url, 30) {
                    backend.stop().ok();
                    return Err("Backend failed to start within 30 seconds".into());
                }

                println!("Backend is ready at {}", backend_url);

                (backend_url, Some(backend))
            };

            // Inject backend URL into the webview BEFORE starting the backend.
            // The webview begins loading when the window is created (before setup runs),
            // so this must happen as early as possible to beat the frontend JS evaluation.
            let window = app.get_webview_window("main")
                .ok_or("Failed to get main window")?;

            let home_dir = dirs::home_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            window.eval(&format!(
                "window.__BACKEND_URL__ = '{}'; window.__TAURI__ = true; window.__HOME_DIR__ = '{}';",
                backend_url,
                home_dir.replace('\\', "\\\\")
            )).map_err(|e| format!("Failed to inject backend URL: {}", e))?;

            // Store backend in app state (None if using remote backend)
            app.manage(AppState {
                backend: Mutex::new(backend_process),
                tunnels: TunnelRegistry::new(),
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Stop backend when window closes
                if let Some(state) = window.try_state::<AppState>() {
                    if let Ok(mut backend) = state.backend.lock() {
                        if let Some(ref mut proc) = *backend {
                            println!("Stopping backend on window close");
                            proc.stop().ok();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Wait for the backend to be ready by polling the HTTP endpoint
fn wait_for_backend(url: &str, timeout_secs: u64) -> bool {
    use std::time::{Duration, Instant};

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap();

    let start = Instant::now();
    let timeout = Duration::from_secs(timeout_secs);

    while start.elapsed() < timeout {
        match client.get(url).send() {
            Ok(response) if response.status().is_success() => {
                println!("Backend ready after {:?}", start.elapsed());
                return true;
            }
            _ => {
                std::thread::sleep(Duration::from_millis(500));
            }
        }
    }

    eprintln!("Backend did not become ready within {}s", timeout_secs);
    false
}
