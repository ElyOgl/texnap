//! Which vision-LLM does the OCR call. Two today; adding a third is a new
//! variant here plus a new module under `ocr/` — the extension point flagged
//! in `Trinity/TEXNAP/DECISIONS.md` when the OCR call was first built.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    Gemini,
    Anthropic,
}

impl Provider {
    pub const ALL: [Provider; 2] = [Provider::Gemini, Provider::Anthropic];

    pub fn as_str(&self) -> &'static str {
        match self {
            Provider::Gemini => "gemini",
            Provider::Anthropic => "anthropic",
        }
    }

    pub fn from_str(s: &str) -> Option<Provider> {
        match s {
            "gemini" => Some(Provider::Gemini),
            "anthropic" => Some(Provider::Anthropic),
            _ => None,
        }
    }

    /// Dev-only convenience override, checked before the stored key.
    pub fn env_var_name(&self) -> &'static str {
        match self {
            Provider::Gemini => "GEMINI_API_KEY",
            Provider::Anthropic => "ANTHROPIC_API_KEY",
        }
    }

    pub fn info(&self) -> ProviderInfo {
        match self {
            Provider::Gemini => ProviderInfo {
                id: "gemini",
                label: "Google (Gemini)",
                free_tier: true,
                key_placeholder: "AIza...",
                get_key_url: "https://aistudio.google.com/apikey",
            },
            Provider::Anthropic => ProviderInfo {
                id: "anthropic",
                label: "Anthropic (Claude)",
                free_tier: false,
                key_placeholder: "sk-ant-...",
                get_key_url: "https://console.anthropic.com/settings/keys",
            },
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: &'static str,
    pub label: &'static str,
    pub free_tier: bool,
    pub key_placeholder: &'static str,
    pub get_key_url: &'static str,
}
