//! Local thumbnail cache for the panel list.
//!
//! The list only ever shows this device's own captures, and we already hold the
//! pixels at capture time, so thumbnails are built and kept here rather than
//! round-tripping full screenshots through the API to fill a 44px box.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Cursor;
use std::path::PathBuf;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use image::ImageFormat;
use tauri::{AppHandle, Manager};

/// Long edge in pixels — enough for a retina row, small enough to inline.
const MAX_EDGE: u32 = 160;

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("thumbs");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn thumb_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(cache_dir(app)?.join(format!("{id}.png")))
}

/// Downscales a captured PNG and caches it under the shot's id.
pub fn store(app: &AppHandle, id: &str, png: &[u8]) -> Result<(), String> {
    let image = image::load_from_memory(png).map_err(|e| e.to_string())?;
    let mut encoded = Vec::new();
    image
        .thumbnail(MAX_EDGE, MAX_EDGE)
        .write_to(&mut Cursor::new(&mut encoded), ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    fs::write(thumb_path(app, id)?, encoded).map_err(|e| e.to_string())
}

fn read_data_url(app: &AppHandle, id: &str) -> Option<String> {
    let bytes = fs::read(thumb_path(app, id).ok()?).ok()?;
    Some(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

/// Rebuilds a missing thumbnail from the shot we already uploaded, which covers
/// captures made before this cache existed and reinstalls that wiped it.
async fn backfill(app: &AppHandle, api_base: &str, id: &str) -> Option<String> {
    let url = format!("{}/i/{id}", api_base.trim_end_matches('/'));
    let res = reqwest::get(&url).await.ok()?;
    if !res.status().is_success() {
        return None;
    }
    let bytes = res.bytes().await.ok()?;
    store(app, id, &bytes).ok()?;
    read_data_url(app, id)
}

/// Data URLs for the given shots, building any that are missing.
pub async fn collect(app: &AppHandle, api_base: &str, ids: &[String]) -> HashMap<String, String> {
    let mut found = HashMap::new();
    for id in ids {
        let thumb = match read_data_url(app, id) {
            Some(url) => Some(url),
            None => backfill(app, api_base, id).await,
        };
        if let Some(url) = thumb {
            found.insert(id.clone(), url);
        }
    }
    prune(app, ids);
    found
}

/// Expired shots leave the list for good, so their thumbnails go with them.
fn prune(app: &AppHandle, live: &[String]) {
    let Ok(dir) = cache_dir(app) else {
        return;
    };
    let live: HashSet<&str> = live.iter().map(String::as_str).collect();
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_live = path
            .file_stem()
            .and_then(|s| s.to_str())
            .is_some_and(|id| live.contains(id));
        if !is_live {
            let _ = fs::remove_file(path);
        }
    }
}
