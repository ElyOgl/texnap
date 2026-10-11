//! Local-model feedback dataset. Each rating the user gives on an on-device
//! transcription is appended to `feedback.jsonl` in the app data dir, with the
//! source image saved under `feedback/images/<id>.<ext>`. This is a labeled
//! dataset (image → model output, rating, what's-wrong, corrected LaTeX) you can
//! later use to FINE-TUNE or EVALUATE the local model offline — the app itself
//! does not train the model live (the ONNX OCR model is fixed at runtime).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{AppHandle, Manager};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackPayload {
    pub id: String,
    pub image_data_url: String,
    pub model_provider: String,
    pub model_latex: String,
    /// "bad" | "mid" | "correct"
    pub rating: String,
    pub comment: Option<String>,
    pub corrected_latex: Option<String>,
    pub corrected_provider: Option<String>,
    pub lang: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FeedbackRecord<'a> {
    id: &'a str,
    timestamp_ms: u128,
    model_provider: &'a str,
    model_latex: &'a str,
    rating: &'a str,
    comment: Option<&'a str>,
    corrected_latex: Option<&'a str>,
    corrected_provider: Option<&'a str>,
    lang: Option<&'a str>,
    /// Relative path of the saved source image, or None if it couldn't be saved.
    image: Option<String>,
}

fn feedback_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("feedback");
    fs::create_dir_all(dir.join("images")).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn save_image(dir: &Path, id: &str, data_url: &str) -> Option<String> {
    // data:image/<subtype>;base64,<data>
    let comma = data_url.find(',')?;
    let header = &data_url[..comma];
    let ext = header
        .strip_prefix("data:image/")
        .and_then(|h| h.split(';').next())
        .map(|s| match s {
            "jpeg" => "jpg",
            other => other,
        })
        .unwrap_or("png");
    let bytes = STANDARD.decode(data_url[comma + 1..].as_bytes()).ok()?;
    let rel = format!("images/{id}.{ext}");
    fs::write(dir.join(&rel), bytes).ok()?;
    Some(rel)
}

pub fn record(app: &AppHandle, p: FeedbackPayload) -> Result<(), String> {
    let dir = feedback_dir(app)?;
    let image = save_image(&dir, &p.id, &p.image_data_url);
    let rec = FeedbackRecord {
        id: &p.id,
        timestamp_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0),
        model_provider: &p.model_provider,
        model_latex: &p.model_latex,
        rating: &p.rating,
        comment: p.comment.as_deref().filter(|s| !s.trim().is_empty()),
        corrected_latex: p.corrected_latex.as_deref().filter(|s| !s.trim().is_empty()),
        corrected_provider: p.corrected_provider.as_deref(),
        lang: p.lang.as_deref(),
        image,
    };
    let line = serde_json::to_string(&rec).map_err(|e| e.to_string())?;
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("feedback.jsonl"))
        .map_err(|e| e.to_string())?;
    writeln!(f, "{line}").map_err(|e| e.to_string())?;
    Ok(())
}

/// How many feedback entries have been collected (shown in Settings).
pub fn count(app: &AppHandle) -> usize {
    let Ok(dir) = feedback_dir(app) else { return 0 };
    fs::read_to_string(dir.join("feedback.jsonl"))
        .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
        .unwrap_or(0)
}
