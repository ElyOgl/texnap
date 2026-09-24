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
    /// With five providers, knowing which one produced a given result is what
    /// makes the quality difference between them actionable.
    provider_label: &'static str,
}

#[tauri::command]
async fn ocr_transcribe(app: AppHandle, image_data_url: String) -> Result<Transcription, String> {
    let (provider, api_key) = config::resolve_active_provider_and_key(&app)
        .ok_or_else(|| ocr::OcrError::MissingApiKey.to_string())?;
    let latex = ocr::transcribe_to_latex(provider, &image_data_url, &api_key)
        .await
        .map_err(|e| e.to_string())?;
    Ok(Transcription {
        latex,
        provider_label: provider.info().label,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Dev convenience only: searches upward from CWD, so a repo-root .env is
    // found even though `tauri dev` runs cargo from src-tauri/. The built
    // .dmg has no .env at all — see config.rs for the real resolution order.
    dotenvy::dotenv().ok();

    tauri::Builder::default()
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
