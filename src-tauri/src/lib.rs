// Public so the eval runner (`examples/eval.rs`) can drive the *same* code
// path the app uses. An eval that reimplements the API calls measures a
// reimplementation, not the app.
pub mod capture;
mod config;
pub mod ocr;
pub mod provider;

use tauri::AppHandle;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Transcription {
    latex: String,
    /// Which provider actually produced this — with five providers and
    /// fallback, the UI shows what answered.
    provider_label: &'static str,
    /// Set when the originally-active provider failed and a fallback answered,
    /// so the UI can say "X was unavailable — answered by <provider_label>".
    fell_back_from: Option<&'static str>,
}

#[tauri::command]
async fn ocr_transcribe(app: AppHandle, image_data_url: String) -> Result<Transcription, String> {
    let chain = config::fallback_chain(&app);
    if chain.is_empty() {
        return Err(ocr::OcrError::MissingApiKey.to_string());
    }
    let last = chain.len() - 1;
    for (idx, (provider, api_key)) in chain.iter().enumerate() {
        match ocr::transcribe_to_latex(*provider, &image_data_url, api_key).await {
            Ok(latex) => {
                return Ok(Transcription {
                    latex,
                    provider_label: provider.info().label,
                    // chain[0] is the originally-active provider; if we're past
                    // it, we fell back from there.
                    fell_back_from: (idx > 0).then(|| chain[0].0.info().label),
                });
            }
            // Only fall through on a retryable failure with a provider left to try.
            Err(e) if idx < last && e.is_retryable() => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    unreachable!("loop returns on the last provider")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Dev convenience only: searches upward from CWD, so a repo-root .env is
    // found even though `tauri dev` runs cargo from src-tauri/. The built
    // .dmg has no .env at all — see config.rs for the real resolution order.
    dotenvy::dotenv().ok();

    tauri::Builder::default()
        // Remembers the window's size and position across restarts, restoring
        // it on the next launch (falls back to the tauri.conf.json defaults on
        // first run).
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            capture::read_image_as_base64,
            config::get_config_status,
            config::list_providers,
            config::save_provider_key,
            config::set_active_provider,
            ocr_transcribe
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
