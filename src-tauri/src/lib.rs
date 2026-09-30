// The OCR engine lives in `texnap-core`, shared with the CLI. Re-export the
// pieces under their original paths (`texnap_lib::ocr`, `::provider`,
// `::capture`) so the eval runner (`examples/eval.rs`) — which must drive the
// *same* code path the app uses — keeps working unchanged.
pub use texnap_core::{capture, ocr, provider};

mod config;
mod history;
mod snip;

use std::str::FromStr;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

// Parse an accelerator like "Ctrl+Cmd+M" into a Shortcut ourselves, rather than
// relying on the plugin's string parser (whose key grammar is finicky — single
// letters vs "KeyM"). We normalize single letters/digits to Code names and let
// `Code::from_str` do the rest.
fn parse_shortcut(accel: &str) -> Option<Shortcut> {
    let mut mods = Modifiers::empty();
    let mut code: Option<Code> = None;
    for raw in accel.split('+') {
        let token = raw.trim();
        match token.to_ascii_lowercase().as_str() {
            "" => {}
            "cmd" | "command" | "super" | "meta" => mods |= Modifiers::SUPER,
            "ctrl" | "control" => mods |= Modifiers::CONTROL,
            "alt" | "option" => mods |= Modifiers::ALT,
            "shift" => mods |= Modifiers::SHIFT,
            _ => code = key_to_code(token),
        }
    }
    Some(Shortcut::new(Some(mods), code?))
}

fn key_to_code(k: &str) -> Option<Code> {
    // A full KeyboardEvent.code name from the recorder — "KeyM", "Semicolon",
    // "Digit2", "F5", "Space". This is the PHYSICAL key, which is what macOS
    // hotkeys match, so a recorded shortcut fires regardless of layout (AZERTY
    // etc.).
    if let Ok(code) = Code::from_str(k) {
        return Some(code);
    }
    // Or a hand-typed single letter/digit.
    let up = k.to_ascii_uppercase();
    let name = if up.len() == 1 && up.as_bytes()[0].is_ascii_alphabetic() {
        format!("Key{up}")
    } else if up.len() == 1 && up.as_bytes()[0].is_ascii_digit() {
        format!("Digit{up}")
    } else if up == "SPACE" {
        "Space".to_string()
    } else {
        return None;
    };
    Code::from_str(&name).ok()
}

// Registers `accel` as the global capture shortcut, replacing any previous one.
// The actual capture is done by the plugin's global handler (set in `run`); this
// only manages which accelerator is bound.
fn register_shortcut(app: &AppHandle, accel: &str) -> Result<(), String> {
    let shortcut = parse_shortcut(accel).ok_or_else(|| format!("Invalid shortcut: {accel}"))?;
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    gs.register(shortcut)
        .map_err(|e| format!("Couldn't register the shortcut \"{accel}\": {e}"))
}

// Thin Tauri wrapper over the pure `texnap_core::capture` — the drop/picker
// path invokes this; the actual file→data-URL work is shared with the CLI.
#[tauri::command]
fn read_image_as_base64(path: String) -> Result<capture::CapturedImage, String> {
    capture::read_image_as_base64(path)
}

// Write a text file to a user-chosen path (F2: exporting a fiche as .tex). The
// path comes from the native save dialog on the JS side.
#[tauri::command]
fn save_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Couldn't write {path}: {e}"))
}

// Write a fiche as a standalone HTML file and return its path (F2: exporting a
// PDF). WKWebView's window.print() is a no-op in Tauri, so we open this page in
// the user's real browser, where Cmd+P / "Save as PDF" works and the math stays
// crisp vector text. Written into the app's cache dir so the opener scope
// ($APPCACHE) resolves to the exact same path (no /var vs /private/var symlink
// mismatch that bites $TEMP on macOS).
#[tauri::command]
fn write_temp_html(app: AppHandle, contents: String) -> Result<String, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Couldn't resolve the cache dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = dir.join(format!("texnap-fiche-{ts}.html"));
    std::fs::write(&path, contents).map_err(|e| format!("Couldn't write the fiche: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn set_shortcut(app: AppHandle, shortcut: String) -> Result<(), String> {
    let previous = config::current_shortcut(&app);
    if let Err(e) = register_shortcut(&app, &shortcut) {
        // Registering unregistered the old one first; restore it so the user
        // isn't left with no working shortcut after a bad entry.
        let _ = register_shortcut(&app, &previous);
        return Err(e);
    }
    config::persist_shortcut(&app, &shortcut)
}

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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Verdict {
    /// "match" | "minor" | "mismatch" | "unknown"
    level: &'static str,
    note: String,
    provider_label: &'static str,
}

#[tauri::command]
async fn ocr_verify(app: AppHandle, image_data_url: String, latex: String) -> Result<Verdict, String> {
    // Verification needs a reasoning vision LLM — SimpleTex (OCR-only) can't do
    // it, so pick the first non-SimpleTex provider that has a key (active first).
    let (provider, key) = config::fallback_chain(&app)
        .into_iter()
        .find(|(p, _)| *p != provider::Provider::SimpleTex)
        .ok_or_else(|| "No LLM provider configured for verification (SimpleTex can't verify).".to_string())?;

    let raw = ocr::verify(provider, &image_data_url, &latex, &key)
        .await
        .map_err(|e| e.to_string())?;

    let line = raw.trim().lines().next().unwrap_or("").trim();
    let upper = line.to_ascii_uppercase();
    let (level, note) = if upper.starts_with("MATCH") {
        ("match", String::new())
    } else if upper.starts_with("MINOR") {
        ("minor", strip_prefix_note(line))
    } else if upper.starts_with("MISMATCH") {
        ("mismatch", strip_prefix_note(line))
    } else {
        ("unknown", line.to_string())
    };

    Ok(Verdict {
        level,
        note,
        provider_label: provider.info().label,
    })
}

// Drops the "MINOR —"/"MISMATCH —" prefix, keeping the explanation.
fn strip_prefix_note(line: &str) -> String {
    line.split_once(['—', '-', ':'])
        .map(|(_, rest)| rest.trim().to_string())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{key_to_code, parse_shortcut};
    use tauri_plugin_global_shortcut::{Code, Modifiers};

    #[test]
    fn key_to_code_handles_codes_and_bare_chars() {
        assert_eq!(key_to_code("KeyM"), Some(Code::KeyM));
        assert_eq!(key_to_code("M"), Some(Code::KeyM));
        assert_eq!(key_to_code("Semicolon"), Some(Code::Semicolon)); // AZERTY "M" position
        assert_eq!(key_to_code("2"), Some(Code::Digit2));
        assert_eq!(key_to_code("Space"), Some(Code::Space));
        assert_eq!(key_to_code("nonsense!!"), None);
    }

    #[test]
    fn parse_shortcut_builds_the_expected_combo() {
        let sc = parse_shortcut("Ctrl+Cmd+M").unwrap();
        assert_eq!(sc.key, Code::KeyM);
        assert!(sc.mods.contains(Modifiers::CONTROL));
        assert!(sc.mods.contains(Modifiers::SUPER));
        assert!(!sc.mods.contains(Modifiers::SHIFT));
    }

    #[test]
    fn parse_shortcut_needs_a_key() {
        assert!(parse_shortcut("Ctrl+Cmd").is_none());
    }
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
        .plugin(
            // One global handler for whatever shortcut is currently registered:
            // on press, run the region capture off the main thread (screencapture
            // blocks while the user drags), then show the window and hand the
            // image to the frontend, which auto-transcribes it.
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let app = app.clone();
                    std::thread::spawn(move || {
                        if let Some(data_url) = snip::capture_region_to_data_url() {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                            let _ = app.emit("capture-region", data_url);
                        }
                    });
                })
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // Register the stored (or default) global capture shortcut at start.
            let accel = config::current_shortcut(app.handle());
            if let Err(e) = register_shortcut(app.handle(), &accel) {
                eprintln!("[texnap] {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_image_as_base64,
            save_text_file,
            write_temp_html,
            config::get_config_status,
            config::list_providers,
            config::save_provider_key,
            config::set_active_provider,
            config::get_shortcut,
            set_shortcut,
            history::get_history,
            history::add_history_entry,
            history::delete_history_entry,
            history::set_entry_tags,
            history::set_entry_pinned,
            history::clear_uncurated,
            ocr_transcribe,
            ocr_verify
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
