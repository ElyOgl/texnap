//! F6: offline local OCR — texify (Donut Swin + mBART) fp16 via ONNX Runtime,
//! run entirely on-device (no key, no network). Ported from the validated spike.
//! Behind the `local` cargo feature so only the desktop app pulls onnxruntime.
//!
//! Pipeline: preprocess 420×420 (aspect-fit, centered white pad, ImageNet norm)
//! → encoder → merged decoder with the `use_cache_branch` KV-cache protocol →
//! greedy decode with repetition detection → fuzzy segment dedup. All Float16.

use std::path::Path;
use std::sync::{Mutex, OnceLock};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use half::f16;
use ort::session::Session;
use ort::value::{Tensor, Value};
use tokenizers::Tokenizer;

use super::{parse_data_url, OcrError};

const SIZE: usize = 420;
const N_LAYERS: usize = 8;
const HEADS: i64 = 16;
const HEAD_DIM: i64 = 64;
const BOS: i64 = 0;
const PAD: i64 = 1;
const EOS: i64 = 2;
const MAX_TOKENS: usize = 768;
const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const STD: [f32; 3] = [0.229, 0.224, 0.225];

pub const ENCODER_FILE: &str = "encoder_model.onnx";
pub const DECODER_FILE: &str = "decoder_model_merged.onnx";
pub const TOKENIZER_FILE: &str = "tokenizer.json";

/// Whether the model files are present on disk (app resolves `model_dir`).
pub fn is_downloaded(model_dir: &Path) -> bool {
    [ENCODER_FILE, DECODER_FILE, TOKENIZER_FILE]
        .iter()
        .all(|f| model_dir.join(f).exists())
}

struct Models {
    encoder: Session,
    decoder: Session,
    tok: Tokenizer,
}

static MODELS: OnceLock<Mutex<Models>> = OnceLock::new();

fn local_err<E: std::fmt::Display>(e: E) -> OcrError {
    OcrError::Local(e.to_string())
}

fn load(model_dir: &Path) -> Result<Models, OcrError> {
    let encoder = Session::builder()
        .map_err(local_err)?
        .commit_from_file(model_dir.join(ENCODER_FILE))
        .map_err(local_err)?;
    let decoder = Session::builder()
        .map_err(local_err)?
        .commit_from_file(model_dir.join(DECODER_FILE))
        .map_err(local_err)?;
    let tok = Tokenizer::from_file(model_dir.join(TOKENIZER_FILE)).map_err(local_err)?;
    Ok(Models { encoder, decoder, tok })
}

/// Transcribe an image (data URL) to LaTeX with the local model in `model_dir`.
/// Loads the model once and caches it for subsequent calls.
pub fn transcribe(image_data_url: &str, model_dir: &Path) -> Result<String, OcrError> {
    if !is_downloaded(model_dir) {
        return Err(OcrError::ModelNotDownloaded);
    }
    if MODELS.get().is_none() {
        let _ = MODELS.set(Mutex::new(load(model_dir)?));
    }
    let mut guard = MODELS
        .get()
        .ok_or_else(|| OcrError::Local("model cache unavailable".into()))?
        .lock()
        .map_err(|_| OcrError::Local("model lock poisoned".into()))?;
    run(&mut guard, image_data_url)
}

fn run(m: &mut Models, image_data_url: &str) -> Result<String, OcrError> {
    let pixel = preprocess(image_data_url)?;

    // Encoder
    let px = Tensor::from_array(([1usize, 3, SIZE, SIZE], pixel)).map_err(local_err)?;
    let enc = m
        .encoder
        .run(ort::inputs!["pixel_values" => px])
        .map_err(local_err)?;
    let (ehs_shape, ehs_data) = enc["last_hidden_state"]
        .try_extract_tensor::<f16>()
        .map_err(local_err)?;
    let ehs_shape: Vec<i64> = ehs_shape.to_vec();
    let ehs: Vec<f16> = ehs_data.to_vec();
    drop(enc);

    let empty = || -> Result<Value, OcrError> {
        Ok(Tensor::from_array((vec![1i64, HEADS, 0, HEAD_DIM], Vec::<f16>::new()))
            .map_err(local_err)?
            .into_dyn())
    };

    // Step 1 — no cache
    let mut past_dec: Vec<Kv> = Vec::with_capacity(N_LAYERS);
    let mut past_enc: Vec<Kv> = Vec::with_capacity(N_LAYERS);
    let mut cur: i64;
    {
        let mut inputs: Vec<(std::borrow::Cow<str>, Value)> = Vec::new();
        inputs.push(("input_ids".into(), Tensor::from_array(([1usize, 1], vec![BOS])).map_err(local_err)?.into_dyn()));
        inputs.push(("encoder_hidden_states".into(), Tensor::from_array((ehs_shape.clone(), ehs.clone())).map_err(local_err)?.into_dyn()));
        for l in 0..N_LAYERS {
            inputs.push((format!("past_key_values.{l}.decoder.key").into(), empty()?));
            inputs.push((format!("past_key_values.{l}.decoder.value").into(), empty()?));
            inputs.push((format!("past_key_values.{l}.encoder.key").into(), empty()?));
            inputs.push((format!("past_key_values.{l}.encoder.value").into(), empty()?));
        }
        inputs.push(("use_cache_branch".into(), Tensor::from_array(([1usize], vec![false])).map_err(local_err)?.into_dyn()));
        let out = m.decoder.run(inputs).map_err(local_err)?;
        let (ls, ld) = out["logits"].try_extract_tensor::<f16>().map_err(local_err)?;
        let vocab = *ls.last().unwrap() as usize;
        cur = argmax_f16(&ld[ld.len() - vocab..]);
        for l in 0..N_LAYERS {
            past_dec.push(extract_kv(&out, l, "decoder")?);
            past_enc.push(extract_kv(&out, l, "encoder")?);
        }
    }
    let mut tokens = vec![cur];

    // Cached steps
    for _ in 0..MAX_TOKENS {
        if cur == EOS {
            break;
        }
        let mut inputs: Vec<(std::borrow::Cow<str>, Value)> = Vec::new();
        inputs.push(("input_ids".into(), Tensor::from_array(([1usize, 1], vec![cur])).map_err(local_err)?.into_dyn()));
        inputs.push(("encoder_hidden_states".into(), Tensor::from_array((ehs_shape.clone(), ehs.clone())).map_err(local_err)?.into_dyn()));
        for l in 0..N_LAYERS {
            let (ks, kd, vs, vd) = &past_dec[l];
            inputs.push((format!("past_key_values.{l}.decoder.key").into(), Tensor::from_array((ks.clone(), kd.clone())).map_err(local_err)?.into_dyn()));
            inputs.push((format!("past_key_values.{l}.decoder.value").into(), Tensor::from_array((vs.clone(), vd.clone())).map_err(local_err)?.into_dyn()));
            let (eks, ekd, evs, evd) = &past_enc[l];
            inputs.push((format!("past_key_values.{l}.encoder.key").into(), Tensor::from_array((eks.clone(), ekd.clone())).map_err(local_err)?.into_dyn()));
            inputs.push((format!("past_key_values.{l}.encoder.value").into(), Tensor::from_array((evs.clone(), evd.clone())).map_err(local_err)?.into_dyn()));
        }
        inputs.push(("use_cache_branch".into(), Tensor::from_array(([1usize], vec![true])).map_err(local_err)?.into_dyn()));
        let out = m.decoder.run(inputs).map_err(local_err)?;
        let (ls, ld) = out["logits"].try_extract_tensor::<f16>().map_err(local_err)?;
        let vocab = *ls.last().unwrap() as usize;
        cur = argmax_f16(&ld[ld.len() - vocab..]);
        for l in 0..N_LAYERS {
            past_dec[l] = extract_kv(&out, l, "decoder")?;
        }
        tokens.push(cur);
        if let Some(strip) = detect_repeat(&tokens) {
            tokens.truncate(tokens.len() - strip);
            break;
        }
    }

    let ids: Vec<u32> = tokens
        .iter()
        .filter(|&&t| t != BOS && t != EOS && t != PAD)
        .map(|&t| t as u32)
        .collect();
    let raw = m.tok.decode(&ids, true).map_err(local_err)?;
    Ok(dedup_segments(&raw))
}

type Kv = (Vec<i64>, Vec<f16>, Vec<i64>, Vec<f16>);

fn extract_kv(out: &ort::session::SessionOutputs, l: usize, which: &str) -> Result<Kv, OcrError> {
    let (ks, kd) = out[format!("present.{l}.{which}.key").as_str()]
        .try_extract_tensor::<f16>()
        .map_err(local_err)?;
    let (vs, vd) = out[format!("present.{l}.{which}.value").as_str()]
        .try_extract_tensor::<f16>()
        .map_err(local_err)?;
    Ok((ks.to_vec(), kd.to_vec(), vs.to_vec(), vd.to_vec()))
}

fn preprocess(image_data_url: &str) -> Result<Vec<f16>, OcrError> {
    let (_mime, b64) = parse_data_url(image_data_url)?;
    let bytes = STANDARD
        .decode(b64.as_bytes())
        .map_err(|e| OcrError::MalformedImage(e.to_string()))?;
    let img = image::load_from_memory(&bytes)
        .map_err(|e| OcrError::MalformedImage(e.to_string()))?
        .to_rgb8();
    let (w, h) = img.dimensions();
    let scale = f32::min(SIZE as f32 / w as f32, SIZE as f32 / h as f32);
    let nw = ((w as f32 * scale).round() as u32).clamp(1, SIZE as u32);
    let nh = ((h as f32 * scale).round() as u32).clamp(1, SIZE as u32);
    let resized = image::imageops::resize(&img, nw, nh, image::imageops::FilterType::Triangle);
    let mut chw = vec![0f32; 3 * SIZE * SIZE];
    for c in 0..3 {
        let white = (1.0 - MEAN[c]) / STD[c];
        for i in 0..SIZE * SIZE {
            chw[c * SIZE * SIZE + i] = white;
        }
    }
    let ox = (SIZE - nw as usize) / 2;
    let oy = (SIZE - nh as usize) / 2;
    for y in 0..nh as usize {
        for x in 0..nw as usize {
            let px = resized.get_pixel(x as u32, y as u32);
            for c in 0..3 {
                let v = px[c] as f32 / 255.0;
                chw[c * SIZE * SIZE + (y + oy) * SIZE + (x + ox)] = (v - MEAN[c]) / STD[c];
            }
        }
    }
    Ok(chw.into_iter().map(f16::from_f32).collect())
}

fn argmax_f16(row: &[f16]) -> i64 {
    let mut bi = 0usize;
    let mut bv = f32::MIN;
    for (i, x) in row.iter().enumerate() {
        let f = x.to_f32();
        if f > bv {
            bv = f;
            bi = i;
        }
    }
    bi as i64
}

fn trailing_copies(tokens: &[i64], p: usize) -> usize {
    let n = tokens.len();
    let block = &tokens[n - p..n];
    let mut copies = 1;
    let mut end = n - p;
    while end >= p && &tokens[end - p..end] == block {
        copies += 1;
        end -= p;
    }
    copies
}

fn detect_repeat(tokens: &[i64]) -> Option<usize> {
    let max_p = 80.min(tokens.len() / 2);
    for p in 1..=max_p {
        let copies = trailing_copies(tokens, p);
        let need = if p >= 20 { 2 } else if p >= 4 { 3 } else { 6 };
        if copies >= need {
            return Some(p * (copies - 1));
        }
    }
    None
}

fn norm_lev(a: &str, b: &str) -> f32 {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let (n, m) = (a.len(), b.len());
    if n == 0 && m == 0 {
        return 0.0;
    }
    let mut prev: Vec<usize> = (0..=m).collect();
    let mut cur = vec![0usize; m + 1];
    for i in 1..=n {
        cur[0] = i;
        for j in 1..=m {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            cur[j] = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[m] as f32 / n.max(m) as f32
}

fn is_dup(a: &str, b: &str) -> bool {
    if norm_lev(a, b) < 0.18 {
        return true;
    }
    let ac: Vec<char> = a.chars().collect();
    let bc: Vec<char> = b.chars().collect();
    let (short, long) = if bc.len() <= ac.len() { (&bc, &ac) } else { (&ac, &bc) };
    if short.len() >= 12 && (short.len() as f32 / long.len() as f32) > 0.4 {
        let long_prefix: String = long[..short.len()].iter().collect();
        let short_s: String = short.iter().collect();
        if norm_lev(&long_prefix, &short_s) < 0.2 {
            return true;
        }
    }
    false
}

fn dedup_segments(text: &str) -> String {
    let segs: Vec<&str> = text.split("\n\n").map(str::trim).filter(|s| !s.is_empty()).collect();
    let mut kept: Vec<&str> = Vec::new();
    for seg in segs {
        if kept.iter().rev().take(3).any(|k| is_dup(k, seg)) {
            break;
        }
        kept.push(seg);
    }
    kept.join("\n\n")
}
