//! Headless smoke test for the offline local OCR engine (F6).
//!
//! Proves that the statically-linked onnxruntime (via `ort`'s `download-binaries`)
//! actually loads the texify model and runs inference end-to-end — the exact path
//! the shipped app uses. Build/run with the `local` feature:
//!
//! ```
//! cargo run --release --example local_smoke -p texnap-core --features local -- \
//!   <image.png> "$HOME/Library/Application Support/fr.elyo.texnap/models/texify"
//! ```
//!
//! Exit 0 + printed LaTeX = the on-device runtime works in this build config.

#[cfg(feature = "local")]
fn main() {
    use base64::Engine;
    use std::path::PathBuf;

    let mut args = std::env::args().skip(1);
    let image = args.next().expect("usage: local_smoke <image> <model_dir>");
    let model_dir = args.next().expect("usage: local_smoke <image> <model_dir>");

    let bytes = std::fs::read(&image).expect("read image file");
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let data_url = format!("data:image/png;base64,{b64}");

    let started = std::time::Instant::now();
    match texnap_core::ocr::local::transcribe(&data_url, &PathBuf::from(&model_dir)) {
        Ok(latex) => {
            println!("OK in {:?}", started.elapsed());
            println!("---LATEX---");
            println!("{latex}");
        }
        Err(e) => {
            eprintln!("ERR: {e}");
            std::process::exit(1);
        }
    }
}

#[cfg(not(feature = "local"))]
fn main() {
    eprintln!("local_smoke requires `--features local`");
    std::process::exit(2);
}
