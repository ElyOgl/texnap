//! Session 3: a local history of past transcriptions, stored as history.json
//! in the app data dir (same place as config.json). Entries hold a small
//! thumbnail (the frontend downscales before saving, to keep the file small),
//! the LaTeX, the provider, and a timestamp — enough to revisit and re-copy.

use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager};

const MAX_ENTRIES: usize = 100;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub created_at: u64,
    pub latex: String,
    pub provider: String,
    /// Small downscaled data URL for the list preview.
    pub thumbnail: String,
}

fn history_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Couldn't resolve the app data directory: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
    Ok(dir.join("history.json"))
}

fn read(app: &AppHandle) -> Vec<HistoryEntry> {
    history_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write(app: &AppHandle, entries: &[HistoryEntry]) -> Result<(), String> {
    let path = history_path(app)?;
    let json = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("Couldn't write {}: {e}", path.display()))
}

#[tauri::command]
pub fn get_history(app: AppHandle) -> Vec<HistoryEntry> {
    read(&app)
}

#[tauri::command]
pub fn add_history_entry(app: AppHandle, entry: HistoryEntry) -> Result<(), String> {
    let mut entries = read(&app);
    entries.insert(0, entry); // newest first
    entries.truncate(MAX_ENTRIES);
    write(&app, &entries)
}

#[tauri::command]
pub fn delete_history_entry(app: AppHandle, id: String) -> Result<(), String> {
    let mut entries = read(&app);
    entries.retain(|e| e.id != id);
    write(&app, &entries)
}

#[tauri::command]
pub fn clear_history(app: AppHandle) -> Result<(), String> {
    write(&app, &[])
}
