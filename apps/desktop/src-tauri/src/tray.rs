use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Rect, WebviewWindow};

pub const PANEL_LABEL: &str = "main";

/// Space between the menubar/taskbar icon and the panel edge.
const PANEL_GAP: f64 = 6.0;

/// Clicking the tray icon blurs the panel before the click is delivered, so the
/// panel is already hidden by the time we decide whether to toggle it.
static BLUR_HIDE_AT: Mutex<Option<Instant>> = Mutex::new(None);
const BLUR_CLICK_WINDOW: Duration = Duration::from_millis(300);

pub fn note_blur_hide() {
    if let Ok(mut at) = BLUR_HIDE_AT.lock() {
        *at = Some(Instant::now());
    }
}

fn hidden_by_this_click() -> bool {
    let Ok(mut at) = BLUR_HIDE_AT.lock() else {
        return false;
    };
    match *at {
        Some(t) if t.elapsed() < BLUR_CLICK_WINDOW => {
            *at = None;
            true
        }
        _ => false,
    }
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let capture = MenuItem::with_id(
        app,
        "capture",
        "Capture",
        true,
        Some(crate::DEFAULT_HOTKEY),
    )?;
    let open = MenuItem::with_id(app, "open", "Open HauntShot", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit HauntShot", true, Some("CmdOrCtrl+Q"))?;
    let menu = Menu::with_items(
        app,
        &[
            &capture,
            &open,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id("main")
        .icon(tray_icon(app)?)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("HauntShot")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "capture" => start_capture(app),
            "open" => show_panel(app, None),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                toggle_panel(tray.app_handle(), Some(rect));
            }
        })
        .build(app)?;

    Ok(())
}

/// Menubar icons are drawn from alpha only, so macOS gets the monochrome template
/// and every other platform keeps the full-color app icon.
fn tray_icon(app: &AppHandle) -> tauri::Result<Image<'static>> {
    if cfg!(target_os = "macos") {
        return Image::from_bytes(include_bytes!("../icons/tray-template.png"));
    }
    let icon = app
        .default_window_icon()
        .ok_or_else(|| tauri::Error::AssetNotFound("tray icon".into()))?;
    Ok(Image::new_owned(
        icon.rgba().to_vec(),
        icon.width(),
        icon.height(),
    ))
}

fn start_capture(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = crate::run_capture_and_share(handle).await;
    });
}

pub fn toggle_panel(app: &AppHandle, anchor: Option<Rect>) {
    let Some(window) = app.get_webview_window(PANEL_LABEL) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else if !hidden_by_this_click() {
        reveal(&window, anchor);
    }
}

pub fn show_panel(app: &AppHandle, anchor: Option<Rect>) {
    if let Some(window) = app.get_webview_window(PANEL_LABEL) {
        reveal(&window, anchor);
    }
}

fn reveal(window: &WebviewWindow, anchor: Option<Rect>) {
    if let Some(rect) = anchor {
        let _ = anchor_to_icon(window, rect);
    }
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.emit("panel-shown", ());
}

/// Centers the panel under (macOS) or above (Windows/Linux) the tray icon,
/// keeping it inside the monitor the icon lives on.
fn anchor_to_icon(window: &WebviewWindow, anchor: Rect) -> tauri::Result<()> {
    let scale = window.scale_factor()?;
    let icon_pos = anchor.position.to_physical::<f64>(scale);
    let icon_size = anchor.size.to_physical::<f64>(scale);
    let panel = window.outer_size()?;

    let mut x = icon_pos.x + icon_size.width / 2.0 - panel.width as f64 / 2.0;

    #[cfg(target_os = "macos")]
    let y = icon_pos.y + icon_size.height + PANEL_GAP;
    #[cfg(not(target_os = "macos"))]
    let y = icon_pos.y - panel.height as f64 - PANEL_GAP;

    if let Ok(Some(monitor)) = window.app_handle().monitor_from_point(icon_pos.x, icon_pos.y) {
        let left = monitor.position().x as f64 + PANEL_GAP;
        let right =
            (monitor.position().x + monitor.size().width as i32) as f64 - panel.width as f64 - PANEL_GAP;
        if right > left {
            x = x.clamp(left, right);
        }
    }

    window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
}
