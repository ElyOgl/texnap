//! `texnap-core` — the pure OCR engine, with no dependency on Tauri.
//!
//! Everything the app and the CLI share lives here: the provider list, the
//! per-provider API calls, the transcription/verification logic, the shared
//! prompt, and the pure key-resolution rules. The Tauri app (`../src`) wraps
//! these in `#[tauri::command]`s and owns the window/shortcut/history; the CLI
//! (`../cli`) calls them straight. Keeping this crate Tauri-free is the whole
//! point of the split — the CLI builds small and fast, and a change to the
//! engine can't accidentally reach for a window handle.

pub mod capture;
pub mod config;
pub mod ocr;
pub mod provider;
