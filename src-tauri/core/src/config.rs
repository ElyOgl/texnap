//! Pure config: the shape stored on disk (`config.json`) and the rules for
//! resolving *which provider, with which key* — with no dependency on Tauri.
//!
//! The app owns *where* the file lives (Tauri's `app_data_dir()`) and the
//! read/write commands; it hands the parsed [`StoredConfig`] here for the
//! actual decisions. The CLI has no Tauri `app_data_dir`, so it reads the same
//! file from the known macOS path via [`load_from_disk`] and then uses the
//! exact same resolution rules — one source of truth for both.

use crate::provider::Provider;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// Global capture shortcut, macOS-default. Ctrl+Cmd+M is unused by macOS and is
/// what Mathpix Snip uses, so it's familiar and collision-free; "M" for math.
/// (Only the app registers a shortcut; it lives here so the stored shape is
/// fully described in one place.)
pub const DEFAULT_SHORTCUT: &str = "Ctrl+Cmd+M";

/// The on-disk `config.json` shape, shared by the app and the CLI. `keys` is
/// one API key per provider (by `Provider::as_str()`); `shortcut` is only used
/// by the app.
#[derive(Serialize, Deserialize, Default, Clone)]
pub struct StoredConfig {
    pub provider: Option<String>,
    #[serde(default)]
    pub keys: HashMap<String, String>,
    #[serde(default)]
    pub shortcut: Option<String>,
    /// UI language code (e.g. "fr", "en"). `None` = never chosen, so the
    /// frontend auto-detects from the OS locale. App-only, like `shortcut`.
    #[serde(default)]
    pub language: Option<String>,
}

/// The active provider from a stored config, defaulting to the free one
/// (Gemini) when nothing valid is stored.
pub fn active_provider(stored: &StoredConfig) -> Provider {
    stored
        .provider
        .as_deref()
        .and_then(Provider::from_str)
        .unwrap_or(Provider::Gemini)
}

/// The key to use for `provider`: that provider's env var first (dev / CLI
/// convenience), otherwise the key stored in `config.json`. Empty values are
/// treated as absent.
pub fn key_for(stored: &StoredConfig, provider: Provider) -> Option<String> {
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
/// other provider that has a key, in `Provider::ALL` order. Lets the caller
/// fall through to a working provider when the active one is out of quota.
pub fn fallback_chain(stored: &StoredConfig) -> Vec<(Provider, String)> {
    let active = active_provider(stored);
    let mut chain = Vec::new();
    if let Some(key) = key_for(stored, active) {
        chain.push((active, key));
    }
    for provider in Provider::ALL {
        if provider != active {
            if let Some(key) = key_for(stored, provider) {
                chain.push((provider, key));
            }
        }
    }
    chain
}

/// The macOS path where the app stores `config.json`
/// (`~/Library/Application Support/fr.elyo.texnap/config.json`). This mirrors
/// Tauri's `app_data_dir()` for this bundle identifier; the app itself resolves
/// it through Tauri, this is for the non-Tauri callers (CLI, eval).
pub fn app_config_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(
        PathBuf::from(home)
            .join("Library/Application Support/fr.elyo.texnap/config.json"),
    )
}

/// Load the app's stored config from disk, or a default if it's missing or
/// unreadable. For non-Tauri callers (CLI, eval).
pub fn load_from_disk() -> StoredConfig {
    app_config_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored_with(provider: Option<&str>, keys: &[(&str, &str)]) -> StoredConfig {
        StoredConfig {
            provider: provider.map(str::to_string),
            keys: keys
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            shortcut: None,
            language: None,
        }
    }

    #[test]
    fn active_provider_defaults_to_gemini() {
        assert_eq!(active_provider(&StoredConfig::default()), Provider::Gemini);
        assert_eq!(
            active_provider(&stored_with(Some("nonsense"), &[])),
            Provider::Gemini
        );
        assert_eq!(
            active_provider(&stored_with(Some("anthropic"), &[])),
            Provider::Anthropic
        );
    }

    #[test]
    fn fallback_chain_puts_active_first_then_others_with_keys() {
        // Active = OpenAi (has a stored key); Gemini also has one; SimpleTex is
        // empty (treated as absent). The active provider must come first, and a
        // provider with an empty key must never appear.
        // NB: assertions are robust to extra providers picked up from ambient
        // env vars (key_for checks env too) — we don't assert an exact set.
        let stored = stored_with(
            Some("openai"),
            &[("openai", "sk-a"), ("gemini", "AIza-b"), ("simpletex", "  ")],
        );
        let chain = fallback_chain(&stored);
        assert_eq!(chain.first().map(|(p, _)| *p), Some(Provider::OpenAi));
        assert!(chain.iter().any(|(p, _)| *p == Provider::Gemini));
        assert!(
            !chain.iter().any(|(p, _)| *p == Provider::SimpleTex),
            "an empty stored key must not enter the chain"
        );
    }
}
