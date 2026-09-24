use super::{parse_data_url, OcrError, PROMPT};
use serde::{Deserialize, Serialize};

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2023-06-01";
const MODEL: &str = "claude-sonnet-5";
const MAX_TOKENS: u32 = 2048;

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

pub async fn call(image_data_url: &str, api_key: &str) -> Result<String, OcrError> {
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
        .post(API_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", API_VERSION)
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
