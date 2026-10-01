//! Which engine does the OCR call. Adding one is a new variant here plus a
//! new arm in `ocr/mod.rs`'s dispatcher — the dropdown is driven by
//! `list_providers`, so the frontend needs no change at all.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    Gemini,
    SimpleTex,
    OpenRouter,
    OpenAi,
    Anthropic,
    /// F6: offline on-device model (no key, no network). Not in `ALL` until the
    /// app wires model download + selection; reachable via `from_str("local")`.
    Local,
}

impl Provider {
    // Order matters: this is the dropdown order, free tiers first.
    pub const ALL: [Provider; 5] = [
        Provider::Gemini,
        Provider::SimpleTex,
        Provider::OpenRouter,
        Provider::OpenAi,
        Provider::Anthropic,
    ];

    pub fn as_str(&self) -> &'static str {
        match self {
            Provider::Gemini => "gemini",
            Provider::SimpleTex => "simpletex",
            Provider::OpenRouter => "openrouter",
            Provider::OpenAi => "openai",
            Provider::Anthropic => "anthropic",
            Provider::Local => "local",
        }
    }

    pub fn from_str(s: &str) -> Option<Provider> {
        match s {
            "gemini" => Some(Provider::Gemini),
            "simpletex" => Some(Provider::SimpleTex),
            "openrouter" => Some(Provider::OpenRouter),
            "openai" => Some(Provider::OpenAi),
            "anthropic" => Some(Provider::Anthropic),
            "local" => Some(Provider::Local),
            _ => None,
        }
    }

    /// Whether this provider needs an API key (the local model doesn't).
    pub fn needs_key(&self) -> bool {
        !matches!(self, Provider::Local)
    }

    /// Dev-only convenience override, checked before the stored key.
    pub fn env_var_name(&self) -> &'static str {
        match self {
            Provider::Gemini => "GEMINI_API_KEY",
            Provider::SimpleTex => "SIMPLETEX_API_KEY",
            Provider::OpenRouter => "OPENROUTER_API_KEY",
            Provider::OpenAi => "OPENAI_API_KEY",
            Provider::Anthropic => "ANTHROPIC_API_KEY",
            Provider::Local => "TEXNAP_LOCAL",
        }
    }

    pub fn info(&self) -> ProviderInfo {
        match self {
            Provider::Gemini => ProviderInfo {
                id: "gemini",
                label: "Google (Gemini)",
                free_tier: true,
                note: "General vision model, generous free tier.",
                key_placeholder: "AIza...",
                get_key_url: "https://aistudio.google.com/apikey",
            },
            Provider::SimpleTex => ProviderInfo {
                id: "simpletex",
                label: "SimpleTex",
                free_tier: true,
                note: "Purpose-built formula OCR, 2000 calls/day free. One formula per image; servers in China.",
                key_placeholder: "your SimpleTex UAT token",
                get_key_url: "https://simpletex.cn/user/center",
            },
            Provider::OpenRouter => ProviderInfo {
                id: "openrouter",
                label: "OpenRouter",
                free_tier: true,
                note: "Routes to free vision models. 50 requests/day free, 1000/day after a one-off $10 top-up.",
                key_placeholder: "sk-or-...",
                get_key_url: "https://openrouter.ai/keys",
            },
            Provider::OpenAi => ProviderInfo {
                id: "openai",
                label: "OpenAI",
                free_tier: false,
                note: "No free tier, but cents per month at screenshot volume. Very reliable on exact output.",
                key_placeholder: "sk-...",
                get_key_url: "https://platform.openai.com/api-keys",
            },
            Provider::Anthropic => ProviderInfo {
                id: "anthropic",
                label: "Anthropic (Claude)",
                free_tier: false,
                note: "No ongoing free tier, trial credits only.",
                key_placeholder: "sk-ant-...",
                get_key_url: "https://console.anthropic.com/settings/keys",
            },
            Provider::Local => ProviderInfo {
                id: "local",
                label: "Local (offline)",
                free_tier: true,
                note: "Runs on your Mac — no key, no quota, works offline. Downloads a ~600 MB model once.",
                key_placeholder: "",
                get_key_url: "",
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
    pub note: &'static str,
    pub key_placeholder: &'static str,
    pub get_key_url: &'static str,
}
