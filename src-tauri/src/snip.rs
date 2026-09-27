//! Session 2: region screenshot via the global shortcut. macOS's built-in
//! `screencapture -i` gives an interactive crosshair region selector; we read
//! the resulting PNG and hand it to the same pipeline paste/drop/pick feed.
//! Needs Screen Recording permission (macOS prompts on first use); a cancelled
//! selection writes no file, which we treat as "nothing captured".

use base64::{engine::general_purpose::STANDARD, Engine as _};

/// Runs the interactive region capture (blocking — the user drags a selection),
/// returns a PNG data URL, or None if they cancelled (Esc) or it produced
/// nothing (e.g. Screen Recording permission not granted).
pub fn capture_region_to_data_url() -> Option<String> {
    let tmp = std::env::temp_dir().join(format!(
        "texnap-snip-{}.png",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));

    // -i interactive selection, -x no capture sound.
    let ok = std::process::Command::new("screencapture")
        .arg("-i")
        .arg("-x")
        .arg(&tmp)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if !ok || !tmp.exists() {
        return None; // cancelled or failed
    }
    let bytes = std::fs::read(&tmp).ok();
    let _ = std::fs::remove_file(&tmp);
    let bytes = bytes?;
    if bytes.is_empty() {
        return None;
    }
    Some(format!("data:image/png;base64,{}", STANDARD.encode(&bytes)))
}
