//! Session 3 + F1 (library): a local store of past transcriptions, in
//! history.json in the app data dir (same place as config.json). Entries hold
//! a small thumbnail (the frontend downscales before saving), the LaTeX, the
//! provider, a timestamp — and, for the library (F1), user `tags` and a
//! `pinned` flag.
//!
//! F1 unified-store model: this *is* the library. Every transcription is still
//! auto-saved, but the cap only culls **uncurated** entries (neither tagged nor
//! pinned) — tagging or pinning a formula keeps it indefinitely. `tags`/`pinned`
//! are `#[serde(default)]`, so entries written before F1 load fine (empty tags,
//! not pinned).

use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager};

/// How many *uncurated* entries to keep (the ephemeral log). Curated ones
/// (tagged or pinned) are never dropped by the cap.
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
    /// Library tags (chapters/topics). Empty for a plain, uncurated entry.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Pinned entries sort to the top and are protected from the cap.
    #[serde(default)]
    pub pinned: bool,
}

impl HistoryEntry {
    /// Curated = worth keeping past the cap: tagged or pinned.
    fn is_curated(&self) -> bool {
        self.pinned || !self.tags.is_empty()
    }
}

/// Normalize incoming tags: trim, drop blanks, dedup case-insensitively while
/// keeping the first spelling and the given order.
fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    tags.into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .filter(|t| seen.insert(t.to_lowercase()))
        .collect()
}

/// Keep every curated entry; keep only the newest `MAX_ENTRIES` uncurated ones.
/// `entries` is newest-first, so counting uncurated from the front keeps the
/// most recent and drops the stale tail.
fn enforce_cap(entries: &mut Vec<HistoryEntry>) {
    let mut uncurated = 0;
    entries.retain(|e| {
        if e.is_curated() {
            true
        } else {
            uncurated += 1;
            uncurated <= MAX_ENTRIES
        }
    });
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
    enforce_cap(&mut entries);
    write(&app, &entries)
}

#[tauri::command]
pub fn delete_history_entry(app: AppHandle, id: String) -> Result<(), String> {
    let mut entries = read(&app);
    entries.retain(|e| e.id != id);
    write(&app, &entries)
}

/// Set an entry's tags (F1). Normalizes them; tagging makes the entry curated,
/// so it survives the cap from here on.
#[tauri::command]
pub fn set_entry_tags(app: AppHandle, id: String, tags: Vec<String>) -> Result<(), String> {
    let mut entries = read(&app);
    let entry = entries
        .iter_mut()
        .find(|e| e.id == id)
        .ok_or("entry not found")?;
    entry.tags = normalize_tags(tags);
    write(&app, &entries)
}

/// Pin or unpin an entry (F1). Pinned entries sort first and survive the cap.
#[tauri::command]
pub fn set_entry_pinned(app: AppHandle, id: String, pinned: bool) -> Result<(), String> {
    let mut entries = read(&app);
    let entry = entries
        .iter_mut()
        .find(|e| e.id == id)
        .ok_or("entry not found")?;
    entry.pinned = pinned;
    write(&app, &entries)
}

/// Clear only the uncurated (untagged, unpinned) entries — the ephemeral log —
/// leaving the curated library intact. This is what the panel's "Clear
/// untagged" does; a full wipe would nuke saved formulas.
#[tauri::command]
pub fn clear_uncurated(app: AppHandle) -> Result<(), String> {
    let mut entries = read(&app);
    entries.retain(HistoryEntry::is_curated);
    write(&app, &entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, tags: &[&str], pinned: bool) -> HistoryEntry {
        HistoryEntry {
            id: id.into(),
            created_at: 0,
            latex: String::new(),
            provider: "gemini".into(),
            thumbnail: String::new(),
            tags: tags.iter().map(|s| s.to_string()).collect(),
            pinned,
        }
    }

    #[test]
    fn cap_keeps_curated_and_newest_uncurated() {
        // newest-first: one pinned, one tagged, then MAX_ENTRIES+5 plain ones.
        let mut entries = vec![entry("pinned", &[], true), entry("tagged", &["algebra"], false)];
        for i in 0..(MAX_ENTRIES + 5) {
            entries.push(entry(&format!("plain{i}"), &[], false));
        }
        enforce_cap(&mut entries);
        // Both curated survive; uncurated capped at MAX_ENTRIES.
        assert!(entries.iter().any(|e| e.id == "pinned"));
        assert!(entries.iter().any(|e| e.id == "tagged"));
        let uncurated = entries.iter().filter(|e| !e.is_curated()).count();
        assert_eq!(uncurated, MAX_ENTRIES);
        // The oldest plain ones (highest index) were dropped, newest kept.
        assert!(entries.iter().any(|e| e.id == "plain0"));
        assert!(!entries.iter().any(|e| e.id == format!("plain{}", MAX_ENTRIES + 4)));
    }

    #[test]
    fn normalize_tags_trims_dedups_and_drops_blanks() {
        let got = normalize_tags(vec![
            "  Algebra ".into(),
            "algebra".into(), // dup (case-insensitive) → dropped
            "".into(),
            "  ".into(),
            "Topology".into(),
        ]);
        assert_eq!(got, vec!["Algebra".to_string(), "Topology".to_string()]);
    }
}
