//! P2a: which provider is active and where its key comes from — the app's
//! Tauri-bound half. The *rules* (resolution order, fallback ordering, the
//! stored shape) live in `texnap_core::config`; this owns *where* the file is
//! (Tauri's `app_data_dir()`), the read/write, and the `#[tauri::command]`s.
//!
//! Resolution order per provider, unchanged: (1) that provider's env var /
//! repo-root `.env` (dev convenience — `dotenvy::dotenv()` in `lib.rs` searches
//! upward from the CWD); (2) `config.json` in the app's data dir
//! (`~/Library/Application Support/fr.elyo.texnap/` on macOS) — what the built
//! `.dmg` uses. Deliberately NOT macOS Keychain: single-user local tool. See
//! `Trinity/TEXNAP/DECISIONS.md`.

use crate::provider::{Provider, ProviderInfo};
use std::fs;
use tauri::{AppHandle, Manager};
use texnap_core::config::{self as core_config, StoredConfig, DEFAULT_SHORTCUT};

fn config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Couldn't resolve the app data directory: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
    Ok(dir.join("config.json"))
}

fn read_stored(app: &AppHandle) -> StoredConfig {
    config_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_stored(app: &AppHandle, config: &StoredConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("Couldn't write {}: {e}", path.display()))
}

/// Ordered (provider, key) list to try — active first, then others with a key.
/// The ordering rule is `texnap_core::config::fallback_chain`; this just feeds
/// it the app's stored config.
pub fn fallback_chain(app: &AppHandle) -> Vec<(Provider, String)> {
    core_config::fallback_chain(&read_stored(app))
}

/// The active provider (stored, or the default). Lets the OCR command route the
/// local provider (F6) differently from the key-based cloud providers.
pub fn active_provider(app: &AppHandle) -> Provider {
    core_config::active_provider(&read_stored(app))
}

/// The active global capture shortcut (stored, or the default).
pub fn current_shortcut(app: &AppHandle) -> String {
    read_stored(app)
        .shortcut
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_SHORTCUT.to_string())
}

pub fn persist_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    let mut stored = read_stored(app);
    stored.shortcut = Some(shortcut.to_string());
    write_stored(app, &stored)
}

#[tauri::command]
pub fn get_shortcut(app: AppHandle) -> String {
    current_shortcut(&app)
}

/// The stored UI language, or `None` when the user has never chosen one (the
/// frontend then auto-detects from the OS locale). App-only, like the shortcut.
pub fn current_language(app: &AppHandle) -> Option<String> {
    read_stored(app)
        .language
        .filter(|l| !l.trim().is_empty())
}

pub fn persist_language(app: &AppHandle, language: &str) -> Result<(), String> {
    let mut stored = read_stored(app);
    stored.language = Some(language.to_string());
    write_stored(app, &stored)
}

#[tauri::command]
pub fn get_language(app: AppHandle) -> Option<String> {
    current_language(&app)
}

#[tauri::command]
pub fn set_language(app: AppHandle, language: String) -> Result<(), String> {
    let trimmed = language.trim();
    if trimmed.is_empty() {
        return Err("Language can't be empty".into());
    }
    persist_language(&app, trimmed)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigStatus {
    pub configured: bool,
    pub active_provider: &'static str,
    pub saved_providers: Vec<&'static str>,
    /// Stored UI language, or `None` (never chosen → frontend auto-detects).
    pub language: Option<String>,
}

#[tauri::command]
pub fn get_config_status(app: AppHandle) -> ConfigStatus {
    let stored = read_stored(&app);
    let provider = core_config::active_provider(&stored);
    ConfigStatus {
        // A keyless provider (the local model) counts as configured — otherwise
        // selecting it would bounce the user back into setup forever.
        configured: !provider.needs_key() || core_config::key_for(&stored, provider).is_some(),
        active_provider: provider.as_str(),
        saved_providers: Provider::ALL
            .iter()
            .filter(|p| core_config::key_for(&stored, **p).is_some())
            .map(|p| p.as_str())
            .collect(),
        language: stored.language.filter(|l| !l.trim().is_empty()),
    }
}

#[tauri::command]
pub fn list_providers() -> Vec<ProviderInfo> {
    Provider::ALL.iter().map(|p| p.info()).collect()
}

#[tauri::command]
pub fn save_provider_key(app: AppHandle, provider: String, key: String) -> Result<(), String> {
    let provider =
        Provider::from_str(&provider).ok_or_else(|| format!("Unknown provider \"{provider}\""))?;
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("API key can't be empty".into());
    }
    let mut stored = read_stored(&app);
    stored
        .keys
        .insert(provider.as_str().to_string(), trimmed.to_string());
    stored.provider = Some(provider.as_str().to_string());
    write_stored(&app, &stored)
}

#[tauri::command]
pub fn set_active_provider(app: AppHandle, provider: String) -> Result<(), String> {
    let provider =
        Provider::from_str(&provider).ok_or_else(|| format!("Unknown provider \"{provider}\""))?;
    let mut stored = read_stored(&app);
    stored.provider = Some(provider.as_str().to_string());
    write_stored(&app, &stored)
}
