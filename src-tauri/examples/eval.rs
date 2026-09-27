//! Cross-provider eval runner (P4).
//!
//! Runs every image in `eval/images/` through every provider that has a key
//! in the environment, then writes `eval/report.html` — source image next to
//! each provider's rendered LaTeX, so scoring 15 images across 5 providers is
//! a visual scan rather than 75 rounds of reading raw LaTeX in the GUI.
//!
//! This deliberately calls `texnap_lib::ocr` directly: the eval must exercise
//! the same code the app runs, or it measures a reimplementation.
//!
//! Usage, from `src-tauri/`:
//!     GEMINI_API_KEY=... cargo run --example eval
//! Providers without a key in the environment are skipped and reported as such.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::time::Instant;

use texnap_lib::capture::read_image_as_base64;
use texnap_lib::ocr::transcribe_to_latex;
use texnap_lib::provider::Provider;

const IMAGE_EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "webp", "gif"];

struct Outcome {
    provider: &'static str,
    latex: Option<String>,
    error: Option<String>,
    millis: u128,
}

struct Case {
    file_name: String,
    data_url: String,
    outcomes: Vec<Outcome>,
}

fn eval_dir() -> PathBuf {
    // Runner is invoked from src-tauri/, the eval assets live beside it.
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri always has a parent")
        .join("eval")
}

fn collect_images(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.extension()
                .and_then(|e| e.to_str())
                .map(|e| IMAGE_EXTENSIONS.contains(&e.to_lowercase().as_str()))
                .unwrap_or(false)
        })
        .collect();
    paths.sort();
    paths
}

fn json_escape(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len() + 16);
    for c in raw.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out
}

fn build_json(cases: &[Case]) -> String {
    let mut json = String::from("[");
    for (i, case) in cases.iter().enumerate() {
        if i > 0 {
            json.push(',');
        }
        let _ = write!(
            json,
            "{{\"fileName\":\"{}\",\"dataUrl\":\"{}\",\"outcomes\":[",
            json_escape(&case.file_name),
            json_escape(&case.data_url)
        );
        for (j, outcome) in case.outcomes.iter().enumerate() {
            if j > 0 {
                json.push(',');
            }
            let latex = match &outcome.latex {
                Some(l) => format!("\"{}\"", json_escape(l)),
                None => "null".to_string(),
            };
            let error = match &outcome.error {
                Some(e) => format!("\"{}\"", json_escape(e)),
                None => "null".to_string(),
            };
            let _ = write!(
                json,
                "{{\"provider\":\"{}\",\"latex\":{},\"error\":{},\"millis\":{}}}",
                json_escape(outcome.provider),
                latex,
                error,
                outcome.millis
            );
        }
        json.push_str("]}");
    }
    json.push(']');
    json
}

// Reads the per-provider keys the app stored via its settings UI. The path
// mirrors Tauri's app_data_dir for this bundle identifier on macOS; kept in
// sync with `config.rs` (which owns the real resolution for the app itself).
fn stored_keys() -> std::collections::HashMap<String, String> {
    let Ok(home) = std::env::var("HOME") else {
        return std::collections::HashMap::new();
    };
    let path = format!("{home}/Library/Application Support/fr.elyo.texnap/config.json");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return std::collections::HashMap::new();
    };
    #[derive(serde::Deserialize, Default)]
    struct Stored {
        #[serde(default)]
        keys: std::collections::HashMap<String, String>,
    }
    serde_json::from_str::<Stored>(&text).map(|s| s.keys).unwrap_or_default()
}

#[tokio::main]
async fn main() {
    let dir = eval_dir();
    let images = collect_images(&dir.join("images"));

    if images.is_empty() {
        eprintln!(
            "No images found in {}. Drop some captures there first — see eval/README.md.",
            dir.join("images").display()
        );
        std::process::exit(1);
    }

    // Resolve each provider's key the way the user actually has them set up:
    // an env var if present, otherwise the key stored by the app's settings UI
    // in config.json — so a run "just works" against whatever's configured,
    // with no secret ever passed on the command line.
    let stored = stored_keys();
    let active: Vec<(Provider, String)> = Provider::ALL
        .iter()
        .filter_map(|p| {
            let key = std::env::var(p.env_var_name())
                .ok()
                .filter(|k| !k.trim().is_empty())
                .or_else(|| stored.get(p.as_str()).filter(|k| !k.trim().is_empty()).cloned());
            key.map(|k| (*p, k))
        })
        .collect();

    if active.is_empty() {
        eprintln!("No provider keys found — set one in the app's settings, or export one of:");
        for p in Provider::ALL {
            eprintln!("  {}", p.env_var_name());
        }
        std::process::exit(1);
    }

    for p in Provider::ALL {
        if !active.iter().any(|(active, _)| *active == p) {
            println!("skipping {} — no key (env or config.json)", p.as_str());
        }
    }

    let mut cases = Vec::new();
    for path in &images {
        let captured = match read_image_as_base64(path.to_string_lossy().to_string()) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("skipping {}: {e}", path.display());
                continue;
            }
        };

        let mut outcomes = Vec::new();
        for (provider, key) in &active {
            print!("{} · {} … ", captured.file_name, provider.as_str());
            let started = Instant::now();
            let result = transcribe_to_latex(*provider, &captured.data_url, key).await;
            let millis = started.elapsed().as_millis();
            match result {
                Ok(latex) => {
                    println!("ok ({millis} ms)");
                    outcomes.push(Outcome {
                        provider: provider.info().label,
                        latex: Some(latex),
                        error: None,
                        millis,
                    });
                }
                Err(e) => {
                    println!("FAILED ({millis} ms): {e}");
                    outcomes.push(Outcome {
                        provider: provider.info().label,
                        latex: None,
                        error: Some(e.to_string()),
                        millis,
                    });
                }
            }
        }

        cases.push(Case {
            file_name: captured.file_name,
            data_url: captured.data_url,
            outcomes,
        });
    }

    let template_path = dir.join("report-template.html");
    let template = std::fs::read_to_string(&template_path)
        .unwrap_or_else(|e| panic!("couldn't read {}: {e}", template_path.display()));

    // Data is inlined rather than fetched: a file:// page can't fetch a
    // sibling JSON file, and a self-contained report is easier to keep.
    // Replaces the placeholder *and* its `[]` fallback — substituting only the
    // comment would leave `const DATA = [...] [];`, which parses as indexing.
    let report = template.replace("/*__DATA__*/[]", &build_json(&cases));
    let report_path = dir.join("report.html");
    std::fs::write(&report_path, report)
        .unwrap_or_else(|e| panic!("couldn't write {}: {e}", report_path.display()));

    println!("\nReport written to {}", report_path.display());
    println!("Open it and score each cell against the source image.");
}
