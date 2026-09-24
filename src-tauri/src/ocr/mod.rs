//! P2b: image → LaTeX, dispatched to whichever provider is active. Talks to
//! the provider's API directly from Rust (never from the webview) so the key
//! never touches JS/DOM. See `Trinity/TEXNAP/DECISIONS.md` for why a vision
//! LLM instead of a self-hosted OCR model or Mathpix.

mod anthropic;
mod gemini;
mod openai_compat;
mod simpletex;

use crate::provider::Provider;
use std::fmt;

pub const PROMPT: &str = "You are a rigorous LaTeX transcription engine. Transcribe the mathematical content in this image into LaTeX exactly as written, with zero commentary.

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
            OcrError::MissingApiKey => write!(f, "No API key configured."),
            OcrError::MalformedImage(msg) => write!(f, "Couldn't read the image: {msg}"),
            OcrError::Network(msg) => write!(f, "Network error calling the OCR provider: {msg}"),
            OcrError::Api { status, message } => {
                write!(f, "OCR provider returned {status}: {message}")
            }
            OcrError::UnparseableResponse(msg) => {
                write!(f, "Couldn't parse the OCR provider's response: {msg}")
            }
        }
    }
}

/// Data URLs look like `data:image/png;base64,iVBOR...` — split into
/// (mime type, base64 payload). Shared by every provider module.
pub(crate) fn parse_data_url(data_url: &str) -> Result<(String, String), OcrError> {
    let (header, data) = data_url
        .split_once(',')
        .ok_or_else(|| OcrError::MalformedImage("not a data URL".into()))?;
    let mime = header
        .strip_prefix("data:")
        .and_then(|h| h.strip_suffix(";base64"))
        .ok_or_else(|| OcrError::MalformedImage("expected a base64 data URL".into()))?;
    Ok((mime.to_string(), data.to_string()))
}

pub async fn transcribe_to_latex(
    provider: Provider,
    image_data_url: &str,
    api_key: &str,
) -> Result<String, OcrError> {
    match provider {
        Provider::Anthropic => anthropic::call(image_data_url, api_key).await,
        Provider::Gemini => gemini::call(image_data_url, api_key).await,
        Provider::SimpleTex => simpletex::call(image_data_url, api_key).await,
        Provider::OpenRouter => {
            openai_compat::call(&openai_compat::OPENROUTER, image_data_url, api_key).await
        }
        Provider::OpenAi => {
            openai_compat::call(&openai_compat::OPENAI, image_data_url, api_key).await
        }
    }
}
