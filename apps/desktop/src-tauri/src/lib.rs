mod capture;
mod upload;

use capture::CaptureOutcome;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{Builder as ShortcutBuilder, GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;

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
            notify_fail(&app, &friendly);
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

    let created = match upload::upload_png(&base, &device_id, png).await {
        Ok(r) => r,
        Err(upload::UploadError::QuotaExceeded) => {
            let msg = upload::UploadError::QuotaExceeded.to_string();
            notify_fail(&app, &msg);
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
            notify_fail(&app, "Couldn’t upload — link was not copied");
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

    let viewer_url = created
        .shot
        .viewer_url
        .unwrap_or_else(|| format!("{base}{}", created.shot.viewer_path));

    app.clipboard()
        .write_text(&viewer_url)
        .map_err(|e| format!("Clipboard write failed: {e}"))?;

    let _ = app
        .notification()
        .builder()
        .title("Link copied")
        .body("Expires in 24h")
        .show();

    let success = ShareSuccess {
        viewer_url,
        expires_at: created.shot.expires_at,
        shot_id: created.shot.id,
    };
    let _ = app.emit("share-success", success.clone());
    Ok(success)
}

fn notify_fail(app: &AppHandle, body: &str) {
    let _ = app
        .notification()
        .builder()
        .title("HauntShot")
        .body(body)
        .show();
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
        .plugin(tauri_plugin_notification::init())
        .plugin(ShortcutBuilder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_device_id, capture_and_share])
        .setup(|app| {
            if let Err(e) = register_hotkey(app.handle()) {
                eprintln!("[hauntshot] {e}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
