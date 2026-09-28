//! `texnap` on the command line. An image of math in → LaTeX out, reusing the
//! exact engine the desktop app runs (`texnap-core`): same providers, same
//! prompt, same fallback-on-quota, same verification pass.
//!
//! Key resolution (env first, then the app's stored config — as approved):
//!   1. `$TEXNAP_API_KEY` (+ optional `$TEXNAP_PROVIDER`, or `--provider`) —
//!      lets it run standalone in scripts/CI with nothing on disk.
//!   2. Otherwise the same `config.json` the desktop app writes
//!      (`~/Library/Application Support/fr.elyo.texnap/`), so a key entered once
//!      in the app just works here too. Per-provider env vars
//!      (`GEMINI_API_KEY`, …) are still honored, matching the app.
//!
//! No Tauri anywhere in this crate — that's why it builds small and fast.

use std::io::{Read, Write};
use std::process::Stdio;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use clap::Parser;
use texnap_core::config;
use texnap_core::ocr;
use texnap_core::provider::Provider;

/// Screenshot/photo of math → LaTeX, from the terminal.
#[derive(Parser)]
#[command(
    name = "texnap",
    version,
    about = "Screenshot/photo of math → LaTeX, from the terminal.",
    long_about = "Transcribe an image of mathematical content to LaTeX, using the same \
engine as the texnap desktop app (bring-your-own vision-LLM key).\n\n\
Keys: set $TEXNAP_API_KEY (and optionally $TEXNAP_PROVIDER), or configure a \
provider in the texnap app and it's reused from ~/Library/Application Support/fr.elyo.texnap/config.json."
)]
struct Cli {
    /// Image file to transcribe (png/jpg/jpeg/webp/gif). Use "-" to read image
    /// bytes from stdin.
    image: String,

    /// Force a provider, overriding $TEXNAP_PROVIDER and the app's active one.
    #[arg(long, short, value_name = "NAME")]
    provider: Option<String>,

    /// Also run a second-pass confidence check; the verdict goes to stderr
    /// (or into the JSON with --json).
    #[arg(long)]
    verify: bool,

    /// Copy the LaTeX to the clipboard (pbcopy) in addition to printing it.
    #[arg(long)]
    copy: bool,

    /// Emit {"latex","provider","verdict"} as JSON instead of raw LaTeX.
    #[arg(long)]
    json: bool,
}

#[tokio::main]
async fn main() {
    if let Err(e) = run(Cli::parse()).await {
        eprintln!("texnap: {e}");
        std::process::exit(1);
    }
}

async fn run(cli: Cli) -> Result<(), String> {
    let provider_override = match cli.provider.as_deref() {
        Some(s) => Some(Provider::from_str(s).ok_or_else(|| {
            format!("unknown provider {s:?} — expected one of: gemini, simpletex, openrouter, openai, anthropic")
        })?),
        None => None,
    };

    let chain = resolve_chain(provider_override);
    if chain.is_empty() {
        return Err("no API key found. Set $TEXNAP_API_KEY (optionally $TEXNAP_PROVIDER), \
or add a provider key in the texnap app."
            .into());
    }

    let data_url = load_image(&cli.image)?;

    let (latex, used) = transcribe_with_fallback(&chain, &data_url).await?;

    let verdict = if cli.verify {
        verify(&chain, &data_url, &latex).await
    } else {
        None
    };

    if cli.copy {
        if let Err(e) = copy_to_clipboard(&latex) {
            eprintln!("texnap: couldn't copy to clipboard: {e}");
        }
    }

    if cli.json {
        let obj = serde_json::json!({
            "latex": latex,
            "provider": used.as_str(),
            "verdict": verdict,
        });
        println!("{obj}");
    } else {
        println!("{latex}");
        if let Some(v) = &verdict {
            eprintln!("check ({}): {v}", used.info().label);
        }
    }
    Ok(())
}

/// Build the ordered (provider, key) attempt list: the chosen provider first
/// (CLI flag → `$TEXNAP_PROVIDER` → app's active → Gemini), then every other
/// provider that has a key, so the CLI falls through on a quota/network error
/// just like the app. `$TEXNAP_API_KEY` is the generic override for the primary.
fn resolve_chain(provider_override: Option<Provider>) -> Vec<(Provider, String)> {
    let stored = config::load_from_disk();

    let primary = provider_override
        .or_else(|| {
            std::env::var("TEXNAP_PROVIDER")
                .ok()
                .and_then(|s| Provider::from_str(s.trim()))
        })
        .unwrap_or_else(|| config::active_provider(&stored));

    let generic = std::env::var("TEXNAP_API_KEY")
        .ok()
        .filter(|k| !k.trim().is_empty());

    let mut chain = Vec::new();
    if let Some(key) = generic.or_else(|| config::key_for(&stored, primary)) {
        chain.push((primary, key));
    }
    for p in Provider::ALL {
        if p != primary {
            if let Some(key) = config::key_for(&stored, p) {
                chain.push((p, key));
            }
        }
    }
    chain
}

/// Turn the image argument into a data URL: a file path via the shared
/// `capture` logic, or raw bytes from stdin (`-`) sniffed for their type.
fn load_image(arg: &str) -> Result<String, String> {
    if arg == "-" {
        let mut buf = Vec::new();
        std::io::stdin()
            .read_to_end(&mut buf)
            .map_err(|e| format!("reading stdin: {e}"))?;
        if buf.is_empty() {
            return Err("no bytes on stdin".into());
        }
        let mime = sniff_mime(&buf)
            .ok_or("stdin isn't a recognized image (png, jpeg, gif, or webp)")?;
        Ok(format!("data:{mime};base64,{}", STANDARD.encode(&buf)))
    } else {
        Ok(texnap_core::capture::read_image_as_base64(arg.to_string())?.data_url)
    }
}

/// Detect image type from magic bytes, for stdin input.
fn sniff_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

/// Try each provider in order; fall through to the next only on a retryable
/// error (quota/overload/5xx/network), matching the app's `ocr_transcribe`.
async fn transcribe_with_fallback(
    chain: &[(Provider, String)],
    data_url: &str,
) -> Result<(String, Provider), String> {
    let last = chain.len() - 1;
    for (idx, (provider, key)) in chain.iter().enumerate() {
        match ocr::transcribe_to_latex(*provider, data_url, key).await {
            Ok(latex) => return Ok((latex, *provider)),
            Err(e) if idx < last && e.is_retryable() => {
                eprintln!(
                    "texnap: {} unavailable ({e}) — falling back to {}…",
                    provider.info().label,
                    chain[idx + 1].0.info().label
                );
                continue;
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    unreachable!("loop returns on the last provider")
}

/// Second-pass check with the first non-SimpleTex provider that has a key
/// (SimpleTex is OCR-only and can't verify). Returns the model's one-line
/// verdict, or None if there's no eligible provider or the call failed.
async fn verify(chain: &[(Provider, String)], data_url: &str, latex: &str) -> Option<String> {
    let (provider, key) = chain.iter().find(|(p, _)| *p != Provider::SimpleTex)?;
    match ocr::verify(*provider, data_url, latex, key).await {
        Ok(raw) => Some(raw.trim().lines().next().unwrap_or("").trim().to_string()),
        Err(e) => {
            eprintln!("texnap: confidence check failed: {e}");
            None
        }
    }
}

fn copy_to_clipboard(text: &str) -> Result<(), String> {
    let mut child = std::process::Command::new("pbcopy")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| format!("couldn't run pbcopy: {e}"))?;
    child
        .stdin
        .as_mut()
        .ok_or("no stdin on pbcopy")?
        .write_all(text.as_bytes())
        .map_err(|e| e.to_string())?;
    let status = child.wait().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("pbcopy exited non-zero".into())
    }
}

#[cfg(test)]
mod tests {
    use super::sniff_mime;

    #[test]
    fn sniffs_common_image_types() {
        assert_eq!(sniff_mime(&[0x89, b'P', b'N', b'G', 0x0D]), Some("image/png"));
        assert_eq!(sniff_mime(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(sniff_mime(b"GIF89a....."), Some("image/gif"));
        let mut webp = b"RIFF".to_vec();
        webp.extend_from_slice(&[0, 0, 0, 0]); // size
        webp.extend_from_slice(b"WEBP");
        assert_eq!(sniff_mime(&webp), Some("image/webp"));
    }

    #[test]
    fn rejects_non_images() {
        assert_eq!(sniff_mime(b"not an image"), None);
        assert_eq!(sniff_mime(&[]), None);
        assert_eq!(sniff_mime(b"RIFF____XXXX"), None); // RIFF but not WEBP
    }
}
