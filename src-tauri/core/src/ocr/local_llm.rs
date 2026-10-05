//! F6b: offline plain-language explanation with a small on-device LLM
//! (Qwen2.5-1.5B-Instruct, GGUF Q4_K_M) via candle, Metal-accelerated. Loaded
//! once and cached. Explanation-only — naming stays cloud-only (a 1.5B model
//! hallucinates theorem names; see the Phase-0 eval in DECISIONS.md).

use crate::ocr::OcrError;
use candle_core::quantized::gguf_file;
use candle_core::{Device, Tensor};
use candle_transformers::generation::LogitsProcessor;
use candle_transformers::models::quantized_qwen2::ModelWeights;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use tokenizers::Tokenizer;

pub const GGUF_FILE: &str = "qwen2.5-1.5b-instruct-q4_k_m.gguf";
pub const TOKENIZER_FILE: &str = "tokenizer.json";

const MAX_TOKENS: usize = 260;
const TEMPERATURE: f64 = 0.35;
const SEED: u64 = 299_792_458;

pub fn is_downloaded(dir: &Path) -> bool {
    [GGUF_FILE, TOKENIZER_FILE]
        .iter()
        .all(|f| dir.join(f).exists())
}

struct Llm {
    model: ModelWeights,
    tokenizer: Tokenizer,
    device: Device,
    eos: u32,
    eot: u32,
}

static LLM: OnceLock<Mutex<Llm>> = OnceLock::new();

fn err<E: std::fmt::Display>(e: E) -> OcrError {
    OcrError::Local(e.to_string())
}

fn load(dir: &Path) -> Result<Llm, OcrError> {
    // Metal when available (Apple Silicon); CPU fallback keeps it working anywhere.
    let device = Device::new_metal(0).unwrap_or(Device::Cpu);
    let gguf = dir.join(GGUF_FILE);
    let mut file = std::fs::File::open(&gguf).map_err(err)?;
    let content = gguf_file::Content::read(&mut file).map_err(err)?;
    let model = ModelWeights::from_gguf(content, &mut file, &device).map_err(err)?;
    let tokenizer = Tokenizer::from_file(dir.join(TOKENIZER_FILE)).map_err(err)?;
    let eos = tokenizer.token_to_id("<|im_end|>").unwrap_or(151_645);
    let eot = tokenizer.token_to_id("<|endoftext|>").unwrap_or(151_643);
    Ok(Llm { model, tokenizer, device, eos, eot })
}

fn system_prompt(lang: &str) -> &'static str {
    match lang {
        "en" => "Explain in clear, plain English, in 2 to 4 sentences, what this mathematical statement means and what it establishes or proves. Write only sentences: no formula, no LaTeX, no mathematical symbols, no preamble, no heading.",
        _ => "Explique en français clair et courant, en 2 à 4 phrases, ce que signifie cet énoncé mathématique et ce qu'il établit ou démontre. N'écris que des phrases : aucune formule, aucun LaTeX, aucun symbole mathématique, aucun préambule, aucun titre.",
    }
}

/// Qwen2.5 ChatML prompt. The `<|im_start|>`/`<|im_end|>` markers are special
/// tokens in the vocabulary, so encoding the assembled string yields their ids.
fn chatml(system: &str, user: &str) -> String {
    format!(
        "<|im_start|>system\n{system}<|im_end|>\n<|im_start|>user\n{user}<|im_end|>\n<|im_start|>assistant\n"
    )
}

fn generate(llm: &mut Llm, prompt: &str) -> Result<String, OcrError> {
    let encoding = llm.tokenizer.encode(prompt, false).map_err(err)?;
    let mut tokens: Vec<u32> = encoding.get_ids().to_vec();
    let mut processor = LogitsProcessor::new(SEED, Some(TEMPERATURE), None);
    let mut generated: Vec<u32> = Vec::new();

    for step in 0..MAX_TOKENS {
        // Feed the whole prompt on the first pass, then one token at a time
        // (the model keeps a KV cache keyed by index_pos).
        let (context, index_pos) = if step == 0 {
            (&tokens[..], 0)
        } else {
            (&tokens[tokens.len() - 1..], tokens.len() - 1)
        };
        let input = Tensor::new(context, &llm.device)
            .and_then(|t| t.unsqueeze(0))
            .map_err(err)?;
        let logits = llm.model.forward(&input, index_pos).map_err(err)?;
        let logits = logits.squeeze(0).map_err(err)?;
        let next = processor.sample(&logits).map_err(err)?;
        if next == llm.eos || next == llm.eot {
            break;
        }
        tokens.push(next);
        generated.push(next);
    }

    let text = llm.tokenizer.decode(&generated, true).map_err(err)?;
    Ok(clean(&text))
}

/// Strip a leading "Here is…/Voici…" lead-in and stray wrapping punctuation.
fn clean(text: &str) -> String {
    let t = text.trim().trim_matches(['"', '`']).trim();
    t.to_string()
}

/// Reformulate `latex` in plain prose, in `lang`, using the on-device model in
/// `dir`. Loads the model once and caches it.
pub fn explain(latex: &str, lang: &str, dir: &Path) -> Result<String, OcrError> {
    if !is_downloaded(dir) {
        return Err(OcrError::ModelNotDownloaded);
    }
    if LLM.get().is_none() {
        let _ = LLM.set(Mutex::new(load(dir)?));
    }
    let mut guard = LLM
        .get()
        .ok_or_else(|| OcrError::Local("LLM cache unavailable".into()))?
        .lock()
        .map_err(|_| OcrError::Local("LLM lock poisoned".into()))?;
    let prompt = chatml(system_prompt(lang), latex);
    generate(&mut guard, &prompt)
}
