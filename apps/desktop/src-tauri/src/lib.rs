mod capture;
mod sound;
mod thumbs;
mod toast;
mod tray;
mod upload;

use capture::CaptureOutcome;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{Builder as ShortcutBuilder, GlobalShortcutExt, ShortcutState};

const DEFAULT_HOTKEY: &str = "Control+Shift+5";
#[cfg(target_os = "windows")]
const PRINT_SCREEN_HOTKEY: &str = "PrintScreen";
const DEFAULT_API_BASE: &str = "http://127.0.0.1:8787";

/// Prevents two interactive `screencapture -i` sessions (hotkey double-fire / overlap).
static CAPTURE_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShareSuccess {
    viewer_url: String,
    expires_at: String,
    shot_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShareFailure {
    message: String,
    code: String,
}

/// Env var at run time for local work, baked in at build time for anything we
/// hand to someone else, and localhost when neither says otherwise.
fn api_base() -> String {
    if let Ok(base) = std::env::var("HAUNTSHOT_API_BASE") {
        return base;
    }
    option_env!("HAUNTSHOT_API_BASE")
        .unwrap_or(DEFAULT_API_BASE)
        .to_string()
}

#[tauri::command]
fn get_api_base() -> String {
    api_base()
}

#[tauri::command]
fn get_device_id(app: AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("device_id");
    if path.exists() {
        return std::fs::read_to_string(&path).map_err(|e| e.to_string());
    }
    let id = format!("dev_{}", uuid_v4_simple());
    std::fs::write(&path, &id).map_err(|e| e.to_string())?;
    Ok(id)
}

fn uuid_v4_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}")
}

struct CaptureGuard;

impl CaptureGuard {
    fn try_acquire() -> Option<Self> {
        if CAPTURE_IN_FLIGHT
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            Some(Self)
        } else {
            None
        }
    }
}

impl Drop for CaptureGuard {
    fn drop(&mut self) {
        CAPTURE_IN_FLIGHT.store(false, Ordering::SeqCst);
    }
}

#[tauri::command]
async fn capture_and_share(app: AppHandle) -> Result<ShareSuccess, String> {
    run_capture_and_share(app).await
}

/// The webview has no clipboard permission of its own — copying goes through
/// here so every "Link copied" comes from the same place.
#[tauri::command]
fn copy_link(app: AppHandle, url: String) -> Result<(), String> {
    copy_to_clipboard(&app, &url)?;
    toast::ok(&app, "Link copied", &url);
    Ok(())
}

/// Rust owns the capture lifecycle, so the panel asks it rather than trusting
/// events it may have missed while hidden.
#[tauri::command]
fn capture_in_flight() -> bool {
    CAPTURE_IN_FLIGHT.load(Ordering::SeqCst)
}

#[tauri::command]
async fn shot_thumbnails(
    app: AppHandle,
    ids: Vec<String>,
) -> Result<std::collections::HashMap<String, String>, String> {
    Ok(thumbs::collect(&app, &api_base(), &ids).await)
}

fn copy_to_clipboard(app: &AppHandle, url: &str) -> Result<(), String> {
    app.clipboard().write_text(url).map_err(|e| {
        let msg = format!("Clipboard write failed: {e}");
        toast::error(app, "Couldn’t copy the link", &msg);
        msg
    })
}

async fn run_capture_and_share(app: AppHandle) -> Result<ShareSuccess, String> {
    let Some(_guard) = CaptureGuard::try_acquire() else {
        let _ = app.emit("share-status", "Capture already in progress");
        return Err("busy".into());
    };

    // Hide the tray panel first so region select isn't covering the display.
    if let Some(window) = app.get_webview_window(tray::PANEL_LABEL) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
            // Let the compositor clear the panel before the OS capture UI appears.
            let _ = tauri::async_runtime::spawn_blocking(|| {
                std::thread::sleep(std::time::Duration::from_millis(120));
            })
            .await;
        }
    }

    let _ = app.emit("share-status", "Select a region…");

    let png = match tauri::async_runtime::spawn_blocking(capture::capture_region_png)
        .await
        .map_err(|e| e.to_string())?
    {
        Ok(CaptureOutcome::Captured(bytes)) => {
            sound::play_shutter();
            bytes
        }
        Ok(CaptureOutcome::Cancelled) => {
            // Terminal, but not a failure — the panel needs it to stop waiting.
            let _ = app.emit("share-cancelled", ());
            return Err("cancelled".into());
        }
        Err(e) => {
            let friendly = if e.contains("two interactive") {
                "Capture was interrupted — try again".to_string()
            } else {
                e
            };
            toast::error(&app, "Capture failed", &friendly);
            let _ = app.emit(
                "share-failed",
                ShareFailure {
                    message: friendly.clone(),
                    code: "capture_failed".into(),
                },
            );
            return Err(friendly);
        }
    };

    let _ = app.emit("share-status", "Uploading…");

    let device_id = get_device_id(app.clone())?;
    let base = api_base();

    let thumb_source = png.clone();
    let created = match upload::upload_png(&base, &device_id, png).await {
        Ok(r) => r,
        Err(upload::UploadError::QuotaExceeded) => {
            let msg = upload::UploadError::QuotaExceeded.to_string();
            toast::error(&app, "Free live limit reached", "Upgrade for unlimited");
            let _ = app.emit(
                "share-failed",
                ShareFailure {
                    message: msg.clone(),
                    code: "quota_exceeded".into(),
                },
            );
            return Err(msg);
        }
        Err(e) => {
            let msg = e.to_string();
            toast::error(&app, "Couldn’t upload", &msg);
            let _ = app.emit(
                "share-failed",
                ShareFailure {
                    message: msg.clone(),
                    code: "upload_failed".into(),
                },
            );
            return Err(msg);
        }
    };

    // Off the critical path — the link shouldn't wait on a resize.
    let thumb_app = app.clone();
    let thumb_id = created.shot.id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = thumbs::store(&thumb_app, &thumb_id, &thumb_source) {
            eprintln!("[hauntshot] thumbnail failed: {e}");
        }
    });

    let viewer_url = created
        .shot
        .viewer_url
        .unwrap_or_else(|| format!("{base}{}", created.shot.viewer_path));

    copy_to_clipboard(&app, &viewer_url)?;
    toast::ok(&app, "Link copied · expires in 24h", &viewer_url);

    let success = ShareSuccess {
        viewer_url,
        expires_at: created.shot.expires_at,
        shot_id: created.shot.id,
    };
    let _ = app.emit("share-success", success.clone());
    Ok(success)
}

fn register_hotkey(app: &AppHandle) -> Result<(), String> {
    register_one_hotkey(app, DEFAULT_HOTKEY)?;
    #[cfg(target_os = "windows")]
    {
        // Print Screen is what Windows users reach for; keep Control+Shift+5 too.
        if let Err(e) = register_one_hotkey(app, PRINT_SCREEN_HOTKEY) {
            eprintln!("[hauntshot] PrintScreen hotkey unavailable: {e}");
        }
    }
    Ok(())
}

fn register_one_hotkey(app: &AppHandle, chord: &str) -> Result<(), String> {
    // Single registration path only (avoid on_shortcut + register double-fire).
    if app.global_shortcut().is_registered(chord) {
        app.global_shortcut()
            .unregister(chord)
            .map_err(|e| format!("Failed to clear hotkey {chord}: {e}"))?;
    }

    app.global_shortcut()
        .on_shortcut(chord, |app, _shortcut, event| {
            // Ignore key-repeat / Released — only one start per press.
            if event.state != ShortcutState::Pressed {
                return;
            }
            if CAPTURE_IN_FLIGHT.load(Ordering::SeqCst) {
                return;
            }
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = run_capture_and_share(handle).await;
            });
        })
        .map_err(|e| format!("Failed to register {chord}: {e}"))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri_plugin_autostart::MacosLauncher;

    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(ShortcutBuilder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None::<Vec<&str>>,
        ))
        .invoke_handler(tauri::generate_handler![
            get_device_id,
            get_api_base,
            capture_and_share,
            capture_in_flight,
            copy_link,
            shot_thumbnails
        ])
        .setup(|app| {
            // Menubar app: no Dock icon, no app switcher entry.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Opt new installs into login launch once; respect later opt-outs.
            {
                use tauri_plugin_autostart::ManagerExt;
                let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
                let _ = std::fs::create_dir_all(&dir);
                let marker = dir.join("autostart_initialized");
                if !marker.exists() {
                    let autostart = app.autolaunch();
                    if let Err(e) = autostart.enable() {
                        eprintln!("[hauntshot] autostart enable failed: {e}");
                    }
                    let _ = std::fs::write(&marker, b"1");
                }
            }

            if let Err(e) = register_hotkey(app.handle()) {
                eprintln!("[hauntshot] {e}");
            }
            if let Err(e) = tray::build(app.handle()) {
                eprintln!("[hauntshot] tray unavailable: {e}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Only the panel is dismissible this way; the HUD manages itself.
            if window.label() != tray::PANEL_LABEL {
                return;
            }
            match event {
                // The panel belongs to the tray icon — closing or clicking away parks it.
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                tauri::WindowEvent::Focused(false) => {
                    tray::note_blur_hide();
                    let _ = window.hide();
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
