//! A small HUD near the tray icon.
//!
//! System notifications can't be relied on for capture feedback: in dev they are
//! posted under Terminal's bundle id, and in release they're one System Settings
//! toggle away from silence. Captures hide the panel, so this is the only thing
//! that tells you whether the link made it to your clipboard.

use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

pub const TOAST_LABEL: &str = "toast";

const LINGER_OK: Duration = Duration::from_millis(2600);
const LINGER_ERROR: Duration = Duration::from_millis(5000);

/// A newer toast cancels the pending dismissal of the one it replaced.
static GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Serialize)]
struct Payload {
    tone: &'static str,
    title: String,
    detail: String,
}

pub fn ok(app: &AppHandle, title: impl Into<String>, detail: impl Into<String>) {
    show(app, "ok", title.into(), detail.into(), LINGER_OK);
}

pub fn error(app: &AppHandle, title: impl Into<String>, detail: impl Into<String>) {
    show(app, "error", title.into(), detail.into(), LINGER_ERROR);
}

fn show(app: &AppHandle, tone: &'static str, title: String, detail: String, linger: Duration) {
    let Some(window) = app.get_webview_window(TOAST_LABEL) else {
        return;
    };

    let _ = app.emit_to(
        TOAST_LABEL,
        "toast",
        Payload {
            tone,
            title,
            detail,
        },
    );

    if let Some(rect) = crate::tray::icon_rect(app) {
        let _ = crate::tray::anchor_to_icon(&window, rect);
    }
    // A HUD shouldn't eat clicks or pin the user to one Space.
    let _ = window.set_ignore_cursor_events(true);
    let _ = window.set_visible_on_all_workspaces(true);
    let _ = window.show();

    dismiss_after(window, linger);
}

fn dismiss_after(window: WebviewWindow, linger: Duration) {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    thread::spawn(move || {
        thread::sleep(linger);
        if GENERATION.load(Ordering::SeqCst) == generation {
            let _ = window.hide();
        }
    });
}
