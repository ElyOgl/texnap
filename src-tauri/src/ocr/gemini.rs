use super::{parse_data_url, OcrError};
use serde::{Deserialize, Serialize};

// gemini-2.5-flash returned 404 "no longer available to new users" as of
// 2026-09-24 — Google is retiring old Flash generations fairly quickly.
// generateContent itself is NOT deprecated (Google: "recommended path for
// stable deployments"), only individual model IDs churn; if this 404s again,
// check https://ai.google.dev/gemini-api/docs/models for the current Flash
// model rather than assuming the endpoint shape changed.
const MODEL: &str = "gemini-3.6-flash";

fn api_url() -> String {
    format!("https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent")
}

#[derive(Serialize)]
struct InlineData {
    mime_type: String,
    data: String,
}

// Untagged so each variant serializes as its single field directly —
// {"inline_data": {...}} or {"text": "..."} — matching what the Gemini API
// expects, instead of being wrapped in an extra variant-name key.
#[derive(Serialize)]
#[serde(untagged)]
enum Part {
    InlineData { inline_data: InlineData },
    Text { text: String },
}

#[derive(Serialize)]
struct Content {
    parts: Vec<Part>,
}

// gemini-2.5/3.x Flash think by default, and thinking tokens are billed
// against maxOutputTokens — a low or unset limit means the model can burn
// its whole budget "thinking" and get cut off before writing the actual
// answer (confirmed against real output 2026-09-24: response stopped
// mid-formula with no error). Transcription doesn't need reasoning, so
// thinking is disabled outright rather than just raising the token cap.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThinkingConfig {
    thinking_budget: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerationConfig {
    thinking_config: ThinkingConfig,
    max_output_tokens: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerateContentRequest {
    contents: Vec<Content>,
    generation_config: GenerationConfig,
}

#[derive(Deserialize)]
struct ResponsePart {
    text: Option<String>,
    // Defensive: if a "thought" part ever slips through even with thinking
    // disabled, skip it rather than returning its (reasoning, not answer)
    // text as if it were the transcription.
    #[serde(default)]
    thought: bool,
}

#[derive(Deserialize)]
struct ResponseContent {
    #[serde(default)]
    parts: Vec<ResponsePart>,
}

#[derive(Deserialize)]
struct Candidate {
    content: ResponseContent,
    #[serde(default, rename = "finishReason")]
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct GenerateContentResponse {
    #[serde(default)]
    candidates: Vec<Candidate>,
}

#[derive(Deserialize)]
struct ApiErrorBody {
    error: ApiErrorDetail,
}

#[derive(Deserialize)]
struct ApiErrorDetail {
    message: String,
}

pub async fn call(image_data_url: &str, prompt: &str, api_key: &str) -> Result<String, OcrError> {
    let (mime_type, data) = parse_data_url(image_data_url)?;

    let body = GenerateContentRequest {
        contents: vec![Content {
            parts: vec![
                Part::InlineData {
                    inline_data: InlineData { mime_type, data },
                },
                Part::Text {
                    text: prompt.to_string(),
                },
            ],
        }],
        generation_config: GenerationConfig {
            thinking_config: ThinkingConfig { thinking_budget: 0 },
            max_output_tokens: 4096,
        },
    };

    let client = reqwest::Client::new();
    let response = client
        .post(api_url())
        .header("x-goog-api-key", api_key)
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
        let message = serde_json::from_slice::<ApiErrorBody>(&bytes)
            .map(|b| b.error.message)
            .unwrap_or_else(|_| String::from_utf8_lossy(&bytes).to_string());
        return Err(OcrError::Api {
            status: status.as_u16(),
            message,
        });
    }

    let parsed: GenerateContentResponse = serde_json::from_slice(&bytes)
        .map_err(|e| OcrError::UnparseableResponse(e.to_string()))?;

    let candidate = parsed
        .candidates
        .into_iter()
        .next()
        .ok_or_else(|| OcrError::UnparseableResponse("no candidates in response".into()))?;

    // Concatenate every non-thought part. Gemini does split one answer across
    // several parts (confirmed 2026-09-24: a formula came back as "...+\infty"
    // + "[ \text{ tel que }..."), with a perfectly normal STOP finishReason —
    // so reading only the first part looks like success while silently losing
    // the rest. Join with NO separator: parts can split mid-expression.
    let joined = candidate
        .content
        .parts
        .into_iter()
        .filter(|p| !p.thought)
        .filter_map(|p| p.text)
        .collect::<Vec<_>>()
        .join("");
    let text = Some(joined.trim().to_string()).filter(|t| !t.is_empty());

    match (text, candidate.finish_reason.as_deref()) {
        (Some(text), Some("MAX_TOKENS")) => Err(OcrError::UnparseableResponse(format!(
            "response was cut off (hit the token limit) even with thinking disabled — got: {text:?}"
        ))),
        (Some(text), _) => Ok(text),
        (None, Some(reason)) => Err(OcrError::UnparseableResponse(format!(
            "no text in response, finish reason: {reason}"
        ))),
        (None, None) => Err(OcrError::UnparseableResponse("no text part in response".into())),
    }
}
