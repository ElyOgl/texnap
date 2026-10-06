//! Headless smoke test for the offline explanation LLM (F6b). Proves candle
//! loads the Qwen2.5-1.5B GGUF and generates a plain-language explanation.
//!
//! ```
//! cargo run --release --example local_explain_smoke -p texnap-core --features local,metal -- \
//!   '\textbf{Théorème.} Toute suite réelle croissante et majorée converge.' \
//!   "$HOME/Library/Application Support/fr.elyo.texnap/models/qwen2.5-1.5b" fr
//! ```

#[cfg(feature = "local_llm")]
fn main() {
    use std::path::PathBuf;
    let mut args = std::env::args().skip(1);
    let latex = args.next().expect("usage: local_explain_smoke <latex> <model_dir> [lang]");
    let model_dir = args.next().expect("usage: local_explain_smoke <latex> <model_dir> [lang]");
    let lang = args.next().unwrap_or_else(|| "fr".into());

    let started = std::time::Instant::now();
    match texnap_core::ocr::local_llm::explain(&latex, &lang, &PathBuf::from(&model_dir)) {
        Ok(text) => {
            println!("OK in {:?}", started.elapsed());
            println!("---EXPLANATION ({lang})---");
            println!("{text}");
        }
        Err(e) => {
            eprintln!("ERR: {e}");
            std::process::exit(1);
        }
    }
}

#[cfg(not(feature = "local_llm"))]
fn main() {
    eprintln!("local_explain_smoke requires `--features local_llm`");
    std::process::exit(2);
}
