//! Short shutter click after a region is captured.

const SHUTTER_MP3: &[u8] = include_bytes!("../../assets/camera-shutter-effect.mp3");

/// Fire-and-forget — never block the capture pipeline on audio.
pub fn play_shutter() {
    std::thread::Builder::new()
        .name("hauntshot-shutter".into())
        .spawn(|| {
            if let Err(e) = play_shutter_blocking() {
                eprintln!("[hauntshot] shutter sound failed: {e}");
            }
        })
        .ok();
}

fn play_shutter_blocking() -> Result<(), String> {
    let path = shutter_cache_path()?;

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("afplay")
            .arg(&path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        // PlaySoundW is WAV-only; MediaPlayer handles the MP3 asset.
        let uri = format!("file:///{}", path.to_string_lossy().replace('\\', "/"));
        let script = format!(
            r#"
Add-Type -AssemblyName presentationCore
$p = New-Object System.Windows.Media.MediaPlayer
$p.Open([Uri]::new('{uri}'))
$p.Play()
Start-Sleep -Milliseconds 400
"#
        );
        std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = path;
        Ok(())
    }
}

fn shutter_cache_path() -> Result<std::path::PathBuf, String> {
    let dir = std::env::temp_dir().join("hauntshot");
    let path = dir.join("camera-shutter-effect.mp3");
    let needs_write = match std::fs::metadata(&path) {
        Ok(meta) => meta.len() as usize != SHUTTER_MP3.len(),
        Err(_) => true,
    };
    if needs_write {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(&path, SHUTTER_MP3).map_err(|e| e.to_string())?;
    }
    Ok(path)
}
