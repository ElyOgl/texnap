//! P2b: the actual image → LaTeX call. Talks to the Anthropic Messages API
//! directly from Rust (never from the webview) so the API key never touches
//! JS/DOM. See `Trinity/TEXNAP/DECISIONS.md` for why a vision LLM instead of
//! a self-hosted OCR model or Mathpix.

use serde::{Deserialize, Serialize};
use std::fmt;

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const MODEL: &str = "claude-sonnet-5";
const MAX_TOKENS: u32 = 2048;

const PROMPT: &str = "You are a rigorous LaTeX transcription engine. Transcribe the mathematical content in this image into LaTeX exactly as written, with zero commentary.

Rules:
- Output ONLY the LaTeX source, nothing else — no explanation, no markdown code fences, no \"Here is the LaTeX\" preamble.
- Reproduce the formula(s) exactly as shown: same order, same grouping, same notation. Do not simplify, solve, or correct anything, even if it looks like a mistake in the source.
- Use standard amsmath/amssymb environments and commands (\\frac, \\sqrt, \\sum, \\int, \\begin{cases}, \\begin{pmatrix}/\\begin{bmatrix}, \\begin{align*} for multi-line aligned equations, etc). Prefer semantic environments over ad-hoc spacing hacks.
- Escape LaTeX special characters (%, &, _, #, {, }) correctly when they appear as literal text rather than LaTeX syntax.
- If there are multiple separate formulas in the image, separate them with a blank line, each as its own standalone snippet — unless the source clearly groups them (e.g. a system of equations), in which case use the appropriate environment.
- If something is illegible or ambiguous, transcribe your best reading. Do not insert placeholder text or ask for clarification.";

#[derive(Debug)]
pub enum OcrError {
    MissingApiKey,
    MalformedImage(String),
    Network(String),
    Api { status: u16, message: String },
    UnparseableResponse(String),
}

impl fmt::Display for OcrError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            OcrError::MissingApiKey => write!(f, "No Anthropic API key configured."),
            OcrError::MalformedImage(msg) => write!(f, "Couldn't read the image: {msg}"),
            OcrError::Network(msg) => write!(f, "Network error calling Anthropic: {msg}"),
            OcrError::Api { status, message } => {
                write!(f, "Anthropic API returned {status}: {message}")
            }
            OcrError::UnparseableResponse(msg) => {
                write!(f, "Couldn't parse the Anthropic response: {msg}")
            }
        }
    }
}

fn parse_data_url(data_url: &str) -> Result<(String, String), OcrError> {
    let (header, data) = data_url
        .split_once(',')
        .ok_or_else(|| OcrError::MalformedImage("not a data URL".into()))?;
    let mime = header
        .strip_prefix("data:")
        .and_then(|h| h.strip_suffix(";base64"))
        .ok_or_else(|| OcrError::MalformedImage("expected a base64 data URL".into()))?;
    Ok((mime.to_string(), data.to_string()))
}

#[derive(Serialize)]
struct ImageSource {
    #[serde(rename = "type")]
    kind: &'static str,
    media_type: String,
    data: String,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ContentBlock {
    Image { source: ImageSource },
    Text { text: String },
}

#[derive(Serialize)]
struct Message {
    role: &'static str,
    content: Vec<ContentBlock>,
}

#[derive(Serialize)]
struct MessagesRequest {
    model: &'static str,
    max_tokens: u32,
    messages: Vec<Message>,
}

#[derive(Deserialize)]
struct ResponseContentBlock {
    #[serde(rename = "type")]
    kind: String,
    text: Option<String>,
}

#[derive(Deserialize)]
struct MessagesResponse {
    content: Vec<ResponseContentBlock>,
}

#[derive(Deserialize)]
struct ApiErrorBody {
    error: ApiErrorDetail,
}

#[derive(Deserialize)]
struct ApiErrorDetail {
    message: String,
}

pub async fn transcribe_to_latex(image_data_url: &str, api_key: &str) -> Result<String, OcrError> {
    let (media_type, data) = parse_data_url(image_data_url)?;

    let body = MessagesRequest {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: vec![Message {
            role: "user",
            content: vec![
                ContentBlock::Image {
                    source: ImageSource {
                        kind: "base64",
                        media_type,
                        data,
                    },
                },
                ContentBlock::Text {
                    text: PROMPT.to_string(),
                },
            ],
        }],
    };

    let client = reqwest::Client::new();
    let response = client
        .post(ANTHROPIC_API_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
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

    let parsed: MessagesResponse = serde_json::from_slice(&bytes)
        .map_err(|e| OcrError::UnparseableResponse(e.to_string()))?;

    parsed
        .content
        .into_iter()
        .find(|block| block.kind == "text")
        .and_then(|block| block.text)
        .map(|text| text.trim().to_string())
        .ok_or_else(|| OcrError::UnparseableResponse("no text block in response".into()))
}
