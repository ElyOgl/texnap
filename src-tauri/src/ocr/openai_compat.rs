//! OpenAI's chat/completions shape, shared by OpenAI itself and OpenRouter —
//! the request and response JSON are identical, only the host, model and a
//! header differ. Two real consumers today, so this is shared rather than
//! duplicated; a third would slot in as another `Endpoint` const.
//!
//! Note this deliberately uses `/v1/chat/completions`, not OpenAI's newer
//! `/v1/responses`: the latter returns an `output` array that can interleave
//! reasoning and message items, which is exactly the trap that silently
//! truncated our Gemini transcriptions (see `gemini.rs`).

use super::OcrError;
use serde::{Deserialize, Serialize};

const MAX_TOKENS: u32 = 4096;

pub struct Endpoint {
    pub url: &'static str,
    /// Single model (OpenAI). Serialized as `model`.
    pub model: Option<&'static str>,
    /// Ordered model list (OpenRouter): tried in order, retired ids skipped.
    /// Serialized as `models`.
    pub models: Option<&'static [&'static str]>,
}

pub const OPENAI: Endpoint = Endpoint {
    url: "https://api.openai.com/v1/chat/completions",
    model: Some("gpt-5.6-luna"),
    models: None,
};

pub const OPENROUTER: Endpoint = Endpoint {
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: None,
    // A curated list of free, genuinely vision-capable models, NOT the
    // `openrouter/free` auto-router — the router happily routed OCR requests to
    // a content-moderation model (nvidia/...content-safety) that replied
    // "User Safety: safe" instead of transcribing (seen 2026-09-27). OpenRouter
    // tries these in order and skips any that are unavailable/retired, so this
    // survives model churn while never hitting a non-transcription model.
    // Qwen VL leads (strong at OCR); Gemma 4 as fallbacks. If all 404, refresh
    // from https://openrouter.ai/api/v1/models (filter :free + image input).
    models: Some(&[
        "qwen/qwen3.8-27b:free",
        "google/gemma-4-31b-it:free",
        "google/gemma-4-26b-a4b-it:free",
    ]),
};

#[derive(Serialize)]
struct ImageUrl {
    url: String,
    // Dense subscripts and exponents get lost if the image is downsampled,
    // which is the default on some models.
    detail: &'static str,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Content {
    Text { text: String },
    ImageUrl { image_url: ImageUrl },
}

#[derive(Serialize)]
struct Message {
    role: &'static str,
    content: Vec<Content>,
}

#[derive(Serialize)]
struct ChatRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    models: Option<&'static [&'static str]>,
    messages: Vec<Message>,
    max_tokens: u32,
}

#[derive(Deserialize)]
struct ResponseMessage {
    content: Option<String>,
}

#[derive(Deserialize)]
struct Choice {
    message: ResponseMessage,
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct ChatResponse {
    #[serde(default)]
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct ApiErrorBody {
    error: ApiErrorDetail,
}

#[derive(Deserialize)]
struct ApiErrorDetail {
    message: String,
}

fn error_message(bytes: &[u8]) -> String {
    serde_json::from_slice::<ApiErrorBody>(bytes)
        .map(|b| b.error.message)
        .unwrap_or_else(|_| String::from_utf8_lossy(bytes).to_string())
}

pub async fn call(
    endpoint: &Endpoint,
    image_data_url: &str,
    prompt: &str,
    api_key: &str,
) -> Result<String, OcrError> {
    let body = ChatRequest {
        model: endpoint.model,
        models: endpoint.models,
        max_tokens: MAX_TOKENS,
        messages: vec![Message {
            role: "user",
            content: vec![
                Content::ImageUrl {
                    image_url: ImageUrl {
                        // This shape takes the data URL whole, no splitting needed.
                        url: image_data_url.to_string(),
                        detail: "high",
                    },
                },
                Content::Text {
                    text: prompt.to_string(),
                },
            ],
        }],
    };

    let client = reqwest::Client::new();
    let response = client
        .post(endpoint.url)
        .bearer_auth(api_key)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| OcrError::Network(e.to_string()))?;

    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|e| OcrError::Network(e.to_string()))?;

    if !status.is_success() {
        return Err(OcrError::Api {
            status: status.as_u16(),
            message: error_message(&bytes),
        });
    }

    let parsed: ChatResponse = serde_json::from_slice(&bytes)
        .map_err(|e| OcrError::UnparseableResponse(e.to_string()))?;

    let choice = match parsed.choices.into_iter().next() {
        Some(choice) => choice,
        // OpenRouter can answer 200 with a top-level error object instead of
        // choices, so surface that rather than a bare "no choices".
        None => {
            return Err(OcrError::Api {
                status: status.as_u16(),
                message: error_message(&bytes),
            })
        }
    };

    let text = choice
        .message
        .content
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());

    match (text, choice.finish_reason.as_deref()) {
        (Some(text), Some("length")) => Err(OcrError::UnparseableResponse(format!(
            "response was cut off at the token limit — got: {text:?}"
        ))),
        (Some(text), _) => Ok(text),
        (None, Some(reason)) => Err(OcrError::UnparseableResponse(format!(
            "no text in response, finish reason: {reason}"
        ))),
        (None, None) => Err(OcrError::UnparseableResponse(
            "no text in response".into(),
        )),
    }
}
