use std::fs;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

pub enum CaptureOutcome {
    Captured(Vec<u8>),
    Cancelled,
}

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

#[cfg(target_os = "windows")]
pub fn capture_region_png() -> Result<CaptureOutcome, String> {
    // Opens Snipping Tool overlay; copies result to clipboard when finished.
    let status = Command::new("cmd")
        .args(["/C", "start", "/WAIT", "snippingtool", "/clip"])
        .status()
        .map_err(|e| format!("Failed to run Snipping Tool: {e}"))?;

    if !status.success() {
        // Still try clipboard — some builds return odd codes after a successful snip.
    }

    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Clipboard unavailable: {e}"))?;

    let image = match clipboard.get_image() {
        Ok(img) => img,
        Err(_) => return Ok(CaptureOutcome::Cancelled),
    };

    encode_clipboard_png(&image)
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
