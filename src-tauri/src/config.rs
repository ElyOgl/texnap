//! P2a: where the Anthropic API key comes from. Resolution order:
//! 1. `ANTHROPIC_API_KEY` env var / repo-root `.env` (dev convenience — `dotenvy::dotenv()`
//!    is called once at startup in `lib.rs` and searches upward from the CWD, so it finds
//!    a repo-root `.env` even though `tauri dev` runs `cargo` from `src-tauri/`).
//! 2. A plain `config.json` in the app's data dir (`~/Library/Application Support/fr.elyo.texnap/`
//!    on macOS). This is what the built `.dmg` uses — it has no `.env` file.
//!
//! Deliberately NOT using macOS Keychain: this is a single-user local tool, nothing else
//! on the machine reads this file, and Keychain integration is real extra plumbing for
//! marginal benefit here. See `Trinity/TEXNAP/DECISIONS.md` § Deferred.

use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Default)]
struct StoredConfig {
    api_key: Option<String>,
}

fn config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Couldn't resolve the app data directory: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
    Ok(dir.join("config.json"))
}

fn read_stored_key(app: &AppHandle) -> Option<String> {
    let path = config_path(app).ok()?;
    let contents = fs::read_to_string(path).ok()?;
    let config: StoredConfig = serde_json::from_str(&contents).ok()?;
    config.api_key.filter(|k| !k.trim().is_empty())
}

/// Used by `ocr.rs` — not exposed as a command itself, so the key never has to
/// round-trip through JS at all once it's been saved once.
pub fn resolve_api_key(app: &AppHandle) -> Option<String> {
    std::env::var("ANTHROPIC_API_KEY")
        .ok()
        .filter(|k| !k.trim().is_empty())
        .or_else(|| read_stored_key(app))
}

#[tauri::command]
pub fn get_api_key_status(app: AppHandle) -> bool {
    resolve_api_key(&app).is_some()
}

#[tauri::command]
pub fn save_api_key(app: AppHandle, key: String) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("API key can't be empty".into());
    }
    let path = config_path(&app)?;
    let config = StoredConfig {
        api_key: Some(trimmed.to_string()),
    };
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("Couldn't write {}: {e}", path.display()))
}
