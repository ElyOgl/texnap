//! SimpleTex — a purpose-built formula-OCR service rather than a general
//! vision LLM. It differs from every other provider here in three ways, all
//! deliberate:
//!
//! - It takes `multipart/form-data` with raw image bytes, not a base64 JSON
//!   payload, so this module decodes the data URL first.
//! - It ignores the shared `PROMPT` — there is no prompt. That's the point:
//!   it cannot wander off into prose or commentary.
//! - Its HTTP status is 200 even on failure; the real outcome is the `status`
//!   boolean in the body.
//!
//! Auth uses the simple UAT `token:` header. SimpleTex's docs mark that as
//! "not for production" in favour of app-id + MD5 request signing — that
//! caveat is about distributed services with a shared secret, not a
//! single-user local app holding its own token.

use super::{parse_data_url, OcrError};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Deserialize;

const API_URL: &str = "https://server.simpletex.net/api/latex_ocr_turbo";

#[derive(Deserialize)]
struct OcrResult {
    latex: Option<String>,
}

#[derive(Deserialize)]
struct SimpleTexResponse {
    #[serde(default)]
    status: bool,
    res: Option<OcrResult>,
    #[serde(default)]
    message: Option<String>,
}

fn extension_for(mime: &str) -> &'static str {
    match mime {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "png",
    }
}

pub async fn call(image_data_url: &str, api_key: &str) -> Result<String, OcrError> {
    let (mime_type, base64_data) = parse_data_url(image_data_url)?;
    let image_bytes = STANDARD
        .decode(base64_data)
        .map_err(|e| OcrError::MalformedImage(e.to_string()))?;

    let part = reqwest::multipart::Part::bytes(image_bytes)
        .file_name(format!("capture.{}", extension_for(&mime_type)))
        .mime_str(&mime_type)
        .map_err(|e| OcrError::MalformedImage(e.to_string()))?;
    let form = reqwest::multipart::Form::new().part("file", part);

    let client = reqwest::Client::new();
    let response = client
        .post(API_URL)
        .header("token", api_key)
        .multipart(form)
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
            message: String::from_utf8_lossy(&bytes).to_string(),
        });
    }

    let parsed: SimpleTexResponse = serde_json::from_slice(&bytes)
        .map_err(|e| OcrError::UnparseableResponse(e.to_string()))?;

    if !parsed.status {
        return Err(OcrError::Api {
            // Not an HTTP failure: SimpleTex reports errors in the body.
            status: status.as_u16(),
            message: parsed
                .message
                .unwrap_or_else(|| String::from_utf8_lossy(&bytes).to_string()),
        });
    }

    parsed
        .res
        .and_then(|r| r.latex)
        .map(|latex| latex.trim().to_string())
        .filter(|latex| !latex.is_empty())
        .ok_or_else(|| OcrError::UnparseableResponse("no latex in response".into()))
}
