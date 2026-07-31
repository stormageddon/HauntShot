mod capture;
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

fn api_base() -> String {
    std::env::var("HAUNTSHOT_API_BASE").unwrap_or_else(|_| DEFAULT_API_BASE.to_string())
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

    let _ = app.emit("share-status", "Select a region…");

    let png = match tauri::async_runtime::spawn_blocking(capture::capture_region_png)
        .await
        .map_err(|e| e.to_string())?
    {
        Ok(CaptureOutcome::Captured(bytes)) => bytes,
        Ok(CaptureOutcome::Cancelled) => {
            let _ = app.emit("share-status", "Capture cancelled");
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
    // Single registration path only (avoid on_shortcut + register double-fire).
    if app.global_shortcut().is_registered(DEFAULT_HOTKEY) {
        app.global_shortcut()
            .unregister(DEFAULT_HOTKEY)
            .map_err(|e| format!("Failed to clear hotkey: {e}"))?;
    }

    app.global_shortcut()
        .on_shortcut(DEFAULT_HOTKEY, |app, _shortcut, event| {
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
        .map_err(|e| format!("Failed to register {DEFAULT_HOTKEY}: {e}"))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(ShortcutBuilder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_device_id,
            capture_and_share,
            copy_link,
            shot_thumbnails
        ])
        .setup(|app| {
            // Menubar app: no Dock icon, no app switcher entry.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

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
