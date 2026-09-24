mod capture;
mod config;
mod ocr;

use tauri::AppHandle;

#[tauri::command]
async fn ocr_transcribe(app: AppHandle, image_data_url: String) -> Result<String, String> {
    let api_key = config::resolve_api_key(&app).ok_or_else(|| ocr::OcrError::MissingApiKey.to_string())?;
    ocr::transcribe_to_latex(&image_data_url, &api_key)
        .await
        .map_err(|e| e.to_string())
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
        .invoke_handler(tauri::generate_handler![
            capture::read_image_as_base64,
            config::get_api_key_status,
            config::save_api_key,
            ocr_transcribe
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
