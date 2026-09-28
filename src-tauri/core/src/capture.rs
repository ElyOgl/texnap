//! P1: turning a file path (from native drag-and-drop or the file picker) into
//! something the frontend can preview and, later, send to the OCR command.
//! Clipboard-paste doesn't go through here — the browser already hands the
//! frontend image bytes directly, no file path involved.
//!
//! Pure (no Tauri): the app wraps this in a `#[tauri::command]`, the CLI and the
//! eval runner call it directly. The file→data-URL step is identical everywhere.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::path::Path;

const MAX_BYTES: u64 = 10 * 1024 * 1024; // 10 MB, matches CLAUDE.md's stated cap
const ALLOWED_EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "webp", "gif"];

#[derive(Serialize)]
pub struct CapturedImage {
    pub data_url: String,
    pub file_name: String,
}

fn mime_for_extension(ext: &str) -> Option<&'static str> {
    match ext {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        _ => None,
    }
}

pub fn read_image_as_base64(path: String) -> Result<CapturedImage, String> {
    let p = Path::new(&path);

    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!(
            "Unsupported file type \".{ext}\" — expected one of: {}",
            ALLOWED_EXTENSIONS.join(", ")
        ));
    }
    let mime = mime_for_extension(&ext).expect("extension was just checked against the allowlist");

    let metadata = std::fs::metadata(p).map_err(|e| format!("Couldn't read {path}: {e}"))?;
    if metadata.len() > MAX_BYTES {
        return Err(format!(
            "Image is {:.1} MB, which is over the 10 MB limit",
            metadata.len() as f64 / 1_048_576.0
        ));
    }

    let bytes = std::fs::read(p).map_err(|e| format!("Couldn't read {path}: {e}"))?;
    let file_name = p
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("image")
        .to_string();

    Ok(CapturedImage {
        data_url: format!("data:{mime};base64,{}", STANDARD.encode(&bytes)),
        file_name,
    })
}
