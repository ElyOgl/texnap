#!/usr/bin/env python3
"""texnap local-model feedback tool — turn the in-app feedback log into a
trainable / evaluable dataset. Standard library only (no pip installs).

The app writes feedback to, by default:
  ~/Library/Application Support/fr.elyo.texnap/feedback/
    feedback.jsonl          one JSON object per rating
    images/<id>.<ext>       the source capture for each entry

Each feedback record has: id, timestampMs, modelProvider, modelLatex, rating
("bad"|"mid"|"correct"), comment, correctedLatex, correctedProvider, lang, image.

A *gold pair* (image -> correct LaTeX) is derived as:
  - rating == "correct"            -> gold = modelLatex   (the model got it right)
  - correctedLatex is non-empty    -> gold = correctedLatex (you fixed it)
Entries rated bad/mid with no correction are signal (kept in stats) but are NOT
gold pairs — there's no known-correct target to train on.

Commands:
  stats                      summarize the log
  export <outdir>            copy images + write dataset.jsonl (+ train/val split)
  eval --pred preds.jsonl    score model predictions against the gold labels

See README.md for the fine-tune path (issue #15). The app does NOT train the
model; this is the offline side that makes "better over time" real + measurable.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import shutil
import sys
from pathlib import Path

DEFAULT_DIR = Path.home() / "Library/Application Support/fr.elyo.texnap/feedback"


def load(feedback_dir: Path) -> list[dict]:
    jsonl = feedback_dir / "feedback.jsonl"
    if not jsonl.exists():
        sys.exit(f"No feedback log at {jsonl}\n(Give --dir if it's elsewhere.)")
    rows = []
    for ln, line in enumerate(jsonl.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as e:
            print(f"warning: skipping malformed line {ln}: {e}", file=sys.stderr)
    return rows


def gold_for(rec: dict) -> tuple[str, str] | None:
    """Return (gold_latex, source) for a record that yields a training target."""
    corrected = (rec.get("correctedLatex") or "").strip()
    if corrected:
        src = rec.get("correctedProvider") or "corrected"
        return corrected, f"corrected:{src}"
    if rec.get("rating") == "correct" and (rec.get("modelLatex") or "").strip():
        return rec["modelLatex"].strip(), "correct"
    return None


def cmd_stats(rows: list[dict], _dir: Path) -> None:
    by_rating: dict[str, int] = {}
    by_lang: dict[str, int] = {}
    gold = 0
    comments = []
    for r in rows:
        by_rating[r.get("rating", "?")] = by_rating.get(r.get("rating", "?"), 0) + 1
        by_lang[r.get("lang", "?")] = by_lang.get(r.get("lang", "?"), 0) + 1
        if gold_for(r):
            gold += 1
        if (r.get("comment") or "").strip():
            comments.append((r.get("rating", "?"), r["comment"].strip()))
    print(f"entries           {len(rows)}")
    print(f"by rating         {dict(sorted(by_rating.items()))}")
    print(f"by language       {dict(sorted(by_lang.items()))}")
    print(f"gold pairs usable {gold}   (correct, or bad/mid with a saved correction)")
    print(f"needs a correction {len(rows) - gold}   (rate+regenerate/edit to make these trainable)")
    if comments:
        print("\ncomments:")
        for rating, c in comments:
            print(f"  [{rating}] {c}")


def cmd_export(rows: list[dict], feedback_dir: Path, outdir: Path, val: float, seed: int) -> None:
    pairs = []
    img_out = outdir / "images"
    img_out.mkdir(parents=True, exist_ok=True)
    for r in rows:
        g = gold_for(r)
        if not g:
            continue
        gold_latex, source = g
        rel_img = r.get("image")
        out_img = None
        if rel_img:
            src_img = feedback_dir / rel_img
            if src_img.exists():
                out_img = f"images/{Path(rel_img).name}"
                shutil.copy2(src_img, outdir / out_img)
        pairs.append({
            "id": r.get("id"),
            "image": out_img,
            "latex": gold_latex,
            "source": source,
            "rating": r.get("rating"),
            "comment": r.get("comment"),
            "lang": r.get("lang"),
        })
    if not pairs:
        print("No gold pairs yet. Rate results 'correct', or on bad/mid regenerate "
              "with a cloud model (or edit the LaTeX) so a correction is saved.")
        return
    (outdir / "dataset.jsonl").write_text(
        "\n".join(json.dumps(p, ensure_ascii=False) for p in pairs) + "\n", encoding="utf-8")
    random.Random(seed).shuffle(pairs)
    n_val = max(1, round(len(pairs) * val)) if len(pairs) > 1 else 0
    split = {"val": pairs[:n_val], "train": pairs[n_val:]}
    for name, items in split.items():
        (outdir / f"{name}.jsonl").write_text(
            "".join(json.dumps(p, ensure_ascii=False) + "\n" for p in items), encoding="utf-8")
    print(f"wrote {len(pairs)} gold pairs -> {outdir}")
    print(f"  dataset.jsonl   ({len(pairs)})")
    print(f"  train.jsonl     ({len(split['train'])})")
    print(f"  val.jsonl       ({len(split['val'])})")
    print(f"  images/         ({len(list(img_out.iterdir()))} files)")


def _lev(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def cmd_eval(rows: list[dict], _dir: Path, pred_path: Path) -> None:
    gold = {r["id"]: gold_for(r)[0] for r in rows if r.get("id") and gold_for(r)}
    if not gold:
        sys.exit("No gold labels to score against — collect corrections first (see export).")
    preds: dict[str, str] = {}
    for line in pred_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        obj = json.loads(line)
        preds[obj["id"]] = (obj.get("latex") or "")
    scored = [(gid, g, preds[gid]) for gid, g in gold.items() if gid in preds]
    if not scored:
        sys.exit("No prediction ids overlap the gold set. preds.jsonl needs {id, latex} lines.")
    exact = sum(1 for _, g, p in scored if g.strip() == p.strip())
    sims = []
    for _, g, p in scored:
        d = _lev(g, p)
        sims.append(1 - d / max(len(g), len(p), 1))
    print(f"scored            {len(scored)} / {len(gold)} gold (missing preds: {len(gold) - len(scored)})")
    print(f"exact match       {exact}/{len(scored)}  ({100 * exact / len(scored):.1f}%)")
    print(f"mean similarity   {100 * sum(sims) / len(sims):.1f}%   (1 - normalized edit distance)")


def main() -> None:
    ap = argparse.ArgumentParser(description="texnap feedback dataset tool")
    ap.add_argument("--dir", type=Path, default=DEFAULT_DIR, help="feedback directory")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("stats", help="summarize the feedback log")
    pe = sub.add_parser("export", help="write a gold image->LaTeX dataset")
    pe.add_argument("outdir", type=Path)
    pe.add_argument("--val", type=float, default=0.1, help="validation fraction (default 0.1)")
    pe.add_argument("--seed", type=int, default=0)
    pv = sub.add_parser("eval", help="score predictions against gold labels")
    pv.add_argument("--pred", type=Path, required=True, help="jsonl of {id, latex} predictions")
    args = ap.parse_args()

    rows = load(args.dir)
    if args.cmd == "stats":
        cmd_stats(rows, args.dir)
    elif args.cmd == "export":
        cmd_export(rows, args.dir, args.outdir, args.val, args.seed)
    elif args.cmd == "eval":
        cmd_eval(rows, args.dir, args.pred)


if __name__ == "__main__":
    main()
