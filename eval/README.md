# texnap eval set

Measures how well each provider actually transcribes math, so the default
provider is a measured choice rather than "the one with a free tier".

## Adding cases

Drop screenshots into `eval/images/`. They're committed, so the set is
comparable across runs over time rather than a one-off exercise.

Real captures from material you actually use beat synthetic ones — the point
is to measure performance on your inputs, not on clean renders. Aim for
15–20 covering:

- a simple one-line equation
- fractions, nested sub/superscripts
- a matrix (`pmatrix` / `bmatrix`)
- integrals and sums with limits
- a multi-line aligned system
- Greek letters
- French interval notation like `]0,+∞[` — already caused a real failure once
- embedded prose inside the math (`\text{ tel que }`)
- at least one deliberately messy capture: a low-resolution crop, a
  photographed page, or a slide with compression artifacts

Name files so you can recognise them in the report (`matrix-2x2.png`,
`integral-limits.png`). Nothing parses the names.

## Running

From `src-tauri/`, with a key for each provider you want to measure:

```bash
GEMINI_API_KEY=... OPENAI_API_KEY=... cargo run --example eval
```

Providers without a key in the environment are skipped and named in the
output, so a partial run is fine — run what you have keys for and add more
later.

The runner calls the same `ocr::transcribe_to_latex` the app uses. An eval
that reimplements the API calls would measure the reimplementation.

## Scoring

It writes `eval/report.html` (generated, not committed). Open it: each
source image sits above every provider's rendered output, with Exact /
Close / Wrong buttons and a running tally per provider at the top.

- **Exact** — you'd paste it straight into a document
- **Close** — right structure, one fixable slip
- **Wrong** — misread the maths

Scores live in browser localStorage, so you can score in several sittings.

Judge against the *image*, not against the other providers — and remember
an amber "preview incomplete" note means KaTeX couldn't render it, which is
not the same as the LaTeX being wrong.

## Then what

Record the outcome in `Trinity/TEXNAP/DECISIONS.md` and set the winner as
the default in `src-tauri/src/provider.rs`. If the current free default wins
on merit, write that down too — a confirmed default is worth as much as a
changed one. Weigh accuracy against cost and latency: a free provider at 70%
may beat a paid one at 85% for this use.
