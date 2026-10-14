# texnap — local-model feedback tooling

Offline tools that turn the in-app feedback (the Bad / Mid / Correct ratings you
give on **Local (offline)** transcriptions) into a dataset you can **evaluate**
and **fine-tune** the local OCR model from.

> The app itself does **not** train the model — the on-device model is a fixed
> ONNX graph loaded at runtime. These scripts are the offline half that makes
> "better over time" real and measurable. Tracked in
> [issue #15](https://github.com/ElyOgl/texnap/issues/15).

Pure standard-library Python 3.10+, no `pip install`.

## Where the feedback lives

```
~/Library/Application Support/fr.elyo.texnap/feedback/
  feedback.jsonl        one record per rating
  images/<id>.<ext>     the source capture
```

## Usage

```bash
# 1. See what you've collected
python3 tools/feedback/feedback_tool.py stats

# 2. Export the gold image -> LaTeX pairs (train/val split)
python3 tools/feedback/feedback_tool.py export out/

# 3. After running the local model on out/images, score it
python3 tools/feedback/feedback_tool.py eval --pred preds.jsonl
```

A **gold pair** is produced when the target LaTeX is known:

- you rated the result **Correct** → the model's own LaTeX is the label, or
- you rated it **Bad/Mid** and then **regenerated with a cloud model (or edited
  the LaTeX)** → that corrected LaTeX is the label.

Bad/Mid entries with no correction are kept in `stats` as signal but can't be
training targets — there's no known-correct answer. The in-app widget nudges you
to capture one.

`export out/` writes:

```
out/dataset.jsonl   every gold pair: {id, image, latex, source, rating, comment, lang}
out/train.jsonl     dataset minus the validation slice
out/val.jsonl       the held-out slice (default 10%)
out/images/         the source PNGs for each pair
```

## Producing predictions for `eval`

`eval` compares a predictions file (`{"id": ..., "latex": ...}` per line) against
the gold labels and reports **exact-match %** and **mean similarity**
(1 − normalized edit distance). To generate predictions you run the current local
model over `out/images` — e.g. a small script using `onnxruntime` + the texify
model already downloaded at
`~/Library/Application Support/fr.elyo.texnap/models/texify/`, emitting one
`{id, latex}` line per image. Re-run `eval` after a fine-tune to measure the gain.

## Fine-tune path (next, issue #15)

1. Collect enough gold pairs (aim for ~50–100 corrected examples).
2. `export` them.
3. Fine-tune `texify` (Donut Swin encoder + mBART decoder) on `train.jsonl` with
   a GPU (local or Colab); validate on `val.jsonl`.
4. Re-export to ONNX, bump the model's sha in `src-tauri/src/lib.rs`
   (`LOCAL_MODEL_FILES`), and ship it — the app downloads the new weights.
5. `eval` before/after to confirm the improvement.
