//! P2b: image → LaTeX, dispatched to whichever provider is active. Talks to
//! the provider's API directly from Rust (never from the webview) so the key
//! never touches JS/DOM. See `Trinity/TEXNAP/DECISIONS.md` for why a vision
//! LLM instead of a self-hosted OCR model or Mathpix.

mod anthropic;
mod gemini;
#[cfg(feature = "local")]
pub mod local;
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
    /// F6: the local model isn't downloaded yet (offline provider).
    ModelNotDownloaded,
    /// F6: local inference failed (model load / runtime error).
    Local(String),
}

impl OcrError {
    /// Whether falling back to another provider could plausibly succeed: quota
    /// (429), provider overload (Anthropic's 529), any 5xx, and network
    /// failures. NOT a bad key (401/403) or a bad request (400) or a malformed
    /// image — those would fail identically everywhere, and a bad key is
    /// something the user should see, not have silently masked.
    pub fn is_retryable(&self) -> bool {
        match self {
            OcrError::Network(_) => true,
            OcrError::Api { status, .. } => *status == 429 || *status == 529 || *status >= 500,
            _ => false,
        }
    }
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
            OcrError::ModelNotDownloaded => {
                write!(f, "The local model isn't downloaded yet.")
            }
            OcrError::Local(msg) => write!(f, "Local OCR failed: {msg}"),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_data_url() {
        let (mime, data) = parse_data_url("data:image/png;base64,AAAB").unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(data, "AAAB");
    }

    #[test]
    fn rejects_non_data_urls() {
        assert!(parse_data_url("not a data url").is_err());
        assert!(parse_data_url("data:image/png,AAAB").is_err()); // missing ;base64
    }

    #[test]
    fn retryable_covers_quota_overload_5xx_and_network() {
        assert!(OcrError::Network("x".into()).is_retryable());
        assert!(OcrError::Api { status: 429, message: String::new() }.is_retryable());
        assert!(OcrError::Api { status: 529, message: String::new() }.is_retryable());
        assert!(OcrError::Api { status: 503, message: String::new() }.is_retryable());
        // Not retryable: bad key / bad request / client-side.
        assert!(!OcrError::Api { status: 401, message: String::new() }.is_retryable());
        assert!(!OcrError::Api { status: 400, message: String::new() }.is_retryable());
        assert!(!OcrError::MissingApiKey.is_retryable());
        assert!(!OcrError::MalformedImage("x".into()).is_retryable());
    }
}

pub async fn transcribe_to_latex(
    provider: Provider,
    image_data_url: &str,
    api_key: &str,
) -> Result<String, OcrError> {
    match provider {
        Provider::Anthropic => anthropic::call(image_data_url, PROMPT, api_key).await,
        Provider::Gemini => gemini::call(image_data_url, PROMPT, api_key).await,
        Provider::SimpleTex => simpletex::call(image_data_url, api_key).await,
        Provider::OpenRouter => {
            openai_compat::call(&openai_compat::OPENROUTER, image_data_url, PROMPT, api_key).await
        }
        Provider::OpenAi => {
            openai_compat::call(&openai_compat::OPENAI, image_data_url, PROMPT, api_key).await
        }
        // The local model needs a model directory, not an API key — it's routed
        // via `transcribe_local`, never through this key-based dispatch.
        Provider::Local => Err(OcrError::Local(
            "local provider must be called via transcribe_local".into(),
        )),
    }
}

/// F6: transcribe with the on-device model in `model_dir` (no key, no network).
#[cfg(feature = "local")]
pub fn transcribe_local(
    image_data_url: &str,
    model_dir: &std::path::Path,
) -> Result<String, OcrError> {
    local::transcribe(image_data_url, model_dir)
}

/// F6: whether the local model files are present in `model_dir`.
#[cfg(feature = "local")]
pub fn local_model_downloaded(model_dir: &std::path::Path) -> bool {
    local::is_downloaded(model_dir)
}

fn verify_prompt(latex: &str) -> String {
    format!(
        "You are checking a LaTeX transcription against the source image. Candidate LaTeX:\n\n{latex}\n\n\
Does this LaTeX faithfully reproduce the mathematics shown in the image? Ignore cosmetic differences \
(spacing, equivalent commands). Reply with EXACTLY one line, starting with one of:\n\
MATCH\n\
MINOR — <the one thing to double-check>\n\
MISMATCH — <what is actually wrong>\n\
No other text, no code fences."
    )
}

/// Second-pass accuracy check: shows the model the image and the produced LaTeX
/// and asks whether they match. Returns the model's single-line verdict. Not
/// supported by SimpleTex (OCR-only, no free-form prompt).
pub async fn verify(
    provider: Provider,
    image_data_url: &str,
    latex: &str,
    api_key: &str,
) -> Result<String, OcrError> {
    let prompt = verify_prompt(latex);
    match provider {
        Provider::Anthropic => anthropic::call(image_data_url, &prompt, api_key).await,
        Provider::Gemini => gemini::call(image_data_url, &prompt, api_key).await,
        Provider::OpenRouter => {
            openai_compat::call(&openai_compat::OPENROUTER, image_data_url, &prompt, api_key).await
        }
        Provider::OpenAi => {
            openai_compat::call(&openai_compat::OPENAI, image_data_url, &prompt, api_key).await
        }
        Provider::SimpleTex => Err(OcrError::Api {
            status: 0,
            message: "SimpleTex is OCR-only and can't verify.".into(),
        }),
        Provider::Local => Err(OcrError::Api {
            status: 0,
            message: "The local model can't verify.".into(),
        }),
    }
}
