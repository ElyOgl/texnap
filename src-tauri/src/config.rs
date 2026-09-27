//! P2a: which provider is active and where its key comes from. Resolution
//! order per provider: (1) that provider's env var / repo-root `.env` (dev
//! convenience — `dotenvy::dotenv()` in `lib.rs` searches upward from the
//! CWD); (2) `config.json` in the app's data dir (`~/Library/Application
//! Support/fr.elyo.texnap/` on macOS) — this is what the built `.dmg` uses.
//!
//! Deliberately NOT using macOS Keychain: single-user local tool, nothing
//! else on the machine reads this file. See `Trinity/TEXNAP/DECISIONS.md`.

use crate::provider::{Provider, ProviderInfo};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Default)]
struct StoredConfig {
    provider: Option<String>,
    #[serde(default)]
    keys: HashMap<String, String>,
}

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

fn active_provider(stored: &StoredConfig) -> Provider {
    stored
        .provider
        .as_deref()
        .and_then(Provider::from_str)
        .unwrap_or(Provider::Gemini) // default to the free one
}

fn key_for(stored: &StoredConfig, provider: Provider) -> Option<String> {
    std::env::var(provider.env_var_name())
        .ok()
        .filter(|k| !k.trim().is_empty())
        .or_else(|| {
            stored
                .keys
                .get(provider.as_str())
                .filter(|k| !k.trim().is_empty())
                .cloned()
        })
}

/// Ordered (provider, key) list to try: the active provider first, then every
/// other provider that has a key, in `Provider::ALL` order. Lets the OCR
/// command fall through to a working provider when the active one is out of
/// quota — relevant now that free tiers are in play.
pub fn fallback_chain(app: &AppHandle) -> Vec<(Provider, String)> {
    let stored = read_stored(app);
    let active = active_provider(&stored);
    let mut chain = Vec::new();
    if let Some(key) = key_for(&stored, active) {
        chain.push((active, key));
    }
    for provider in Provider::ALL {
        if provider != active {
            if let Some(key) = key_for(&stored, provider) {
                chain.push((provider, key));
            }
        }
    }
    chain
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigStatus {
    pub configured: bool,
    pub active_provider: &'static str,
    pub saved_providers: Vec<&'static str>,
}

#[tauri::command]
pub fn get_config_status(app: AppHandle) -> ConfigStatus {
    let stored = read_stored(&app);
    let provider = active_provider(&stored);
    ConfigStatus {
        configured: key_for(&stored, provider).is_some(),
        active_provider: provider.as_str(),
        saved_providers: Provider::ALL
            .iter()
            .filter(|p| key_for(&stored, **p).is_some())
            .map(|p| p.as_str())
            .collect(),
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
