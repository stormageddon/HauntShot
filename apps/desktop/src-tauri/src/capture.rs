use std::process::Command;

#[cfg(target_os = "macos")]
use std::fs;
#[cfg(target_os = "macos")]
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
use std::time::{Duration, Instant};

pub enum CaptureOutcome {
    Captured(Vec<u8>),
    Cancelled,
}

#[cfg(target_os = "macos")]
fn temp_png_path() -> std::path::PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("hauntshot-{nanos}.png"))
}

/// Interactive region capture. Escape/cancel → Cancelled (not an error).
#[cfg(target_os = "macos")]
pub fn capture_region_png() -> Result<CaptureOutcome, String> {
    let path = temp_png_path();
    let path_str = path.to_string_lossy().to_string();

    // -i interactive selection, -x no shutter sound, -t png
    let output = Command::new("screencapture")
        .args(["-i", "-x", "-t", "png", &path_str])
        .output()
        .map_err(|e| format!("Failed to run screencapture: {e}"))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("two interactive") {
        let _ = fs::remove_file(&path);
        return Err(
            "screencapture: cannot run two interactive screen captures at a time".into(),
        );
    }

    if !output.status.success() {
        let _ = fs::remove_file(&path);
        return Ok(CaptureOutcome::Cancelled);
    }
    if !path.exists() {
        return Ok(CaptureOutcome::Cancelled);
    }

    let bytes = fs::read(&path).map_err(|e| format!("Failed to read capture: {e}"))?;
    let _ = fs::remove_file(&path);

    if bytes.is_empty() {
        return Ok(CaptureOutcome::Cancelled);
    }
    Ok(CaptureOutcome::Captured(bytes))
}

/// Windows has no headless region capture, so we drive the same overlay that
/// Win+Shift+S opens and pick the result up off the clipboard.
#[cfg(target_os = "windows")]
pub fn capture_region_png() -> Result<CaptureOutcome, String> {
    // A cancelled snip leaves the clipboard untouched, so remember where it
    // started — otherwise we'd upload whatever the user had copied earlier.
    let baseline = clipboard_sequence();
    launch_overlay()?;
    wait_for_snip(baseline)
}

/// Console flashes from a GUI app look like a crash.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(target_os = "windows")]
const POLL: Duration = Duration::from_millis(200);

/// Enumerating processes is far pricier than reading a clipboard counter.
#[cfg(target_os = "windows")]
const PROCESS_POLL: Duration = Duration::from_secs(1);

/// The clipboard write lands a moment after the overlay closes.
#[cfg(target_os = "windows")]
const CLIP_GRACE: Duration = Duration::from_millis(1_500);

/// Long enough to frame a careful shot, short enough not to strand the panel
/// if we never notice the overlay closing.
#[cfg(target_os = "windows")]
const OVERLAY_TIMEOUT: Duration = Duration::from_secs(120);

/// The overlay host is named differently on Windows 10 and 11.
#[cfg(target_os = "windows")]
const OVERLAY_PROCESSES: [&str; 2] = ["screenclippinghost.exe", "snippingtool.exe"];

#[cfg(target_os = "windows")]
fn launch_overlay() -> Result<(), String> {
    // ms-screenclip is the region overlay on both Windows 10 and 11.
    // snippingtool.exe is Windows 10 only, and its /clip flag is a no-op on
    // newer builds, so it is strictly the fallback.
    if Command::new("explorer")
        .arg("ms-screenclip:")
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .is_ok()
    {
        return Ok(());
    }
    Command::new("snippingtool")
        .arg("/clip")
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Couldn’t open the snip overlay: {e}"))
}

/// Waits for the overlay to put a new image on the clipboard. Returns
/// `Cancelled` when the overlay closes without one.
#[cfg(target_os = "windows")]
fn wait_for_snip(baseline: u32) -> Result<CaptureOutcome, String> {
    let started = Instant::now();
    let mut seen_overlay = false;
    let mut closed_at: Option<Instant> = None;
    let mut checked_at: Option<Instant> = None;

    loop {
        if clipboard_sequence() != baseline {
            return read_clipboard_png();
        }

        if checked_at.is_none_or(|at| at.elapsed() >= PROCESS_POLL) {
            checked_at = Some(Instant::now());
            if overlay_running() {
                seen_overlay = true;
                closed_at = None;
            } else if seen_overlay {
                closed_at.get_or_insert_with(Instant::now);
            }
        }

        // Only trust the overlay's exit as a cancel if we saw it running at
        // all; process names vary, and a bad guess must not cut a snip short.
        if closed_at.is_some_and(|at| at.elapsed() >= CLIP_GRACE) {
            return Ok(CaptureOutcome::Cancelled);
        }
        if started.elapsed() >= OVERLAY_TIMEOUT {
            return Ok(CaptureOutcome::Cancelled);
        }
        std::thread::sleep(POLL);
    }
}

#[cfg(target_os = "windows")]
fn overlay_running() -> bool {
    let Ok(out) = Command::new("tasklist")
        .args(["/NH", "/FO", "CSV"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    else {
        return false;
    };
    let listing = String::from_utf8_lossy(&out.stdout).to_lowercase();
    OVERLAY_PROCESSES.iter().any(|name| listing.contains(name))
}

/// Changes on every clipboard write, including one that repeats an earlier
/// image — which comparing contents would miss.
#[cfg(target_os = "windows")]
fn clipboard_sequence() -> u32 {
    unsafe { windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber() }
}

#[cfg(target_os = "windows")]
fn read_clipboard_png() -> Result<CaptureOutcome, String> {
    // The tool may still hold the clipboard open, and whatever landed there
    // might not be an image at all, so give it a few tries before giving up.
    for attempt in 0..6 {
        if attempt > 0 {
            std::thread::sleep(Duration::from_millis(150));
        }
        let Ok(mut clipboard) = arboard::Clipboard::new() else {
            continue;
        };
        if let Ok(image) = clipboard.get_image() {
            return encode_clipboard_png(&image);
        }
    }
    Ok(CaptureOutcome::Cancelled)
}

#[cfg(target_os = "windows")]
fn encode_clipboard_png(image: &arboard::ImageData) -> Result<CaptureOutcome, String> {
    use image::codecs::png::PngEncoder;
    use image::{ExtendedColorType, ImageEncoder};

    let width = image.width as u32;
    let height = image.height as u32;
    let raw = image.bytes.as_ref();
    if raw.len() < (width as usize) * (height as usize) * 4 {
        return Err("Clipboard image data incomplete".into());
    }

    let mut png = Vec::new();
    {
        let encoder = PngEncoder::new(&mut png);
        encoder
            .write_image(raw, width, height, ExtendedColorType::Rgba8)
            .map_err(|e| format!("PNG encode failed: {e}"))?;
    }
    Ok(CaptureOutcome::Captured(png))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn capture_region_png() -> Result<CaptureOutcome, String> {
    Err("Screen capture is not implemented on this platform yet".into())
}
