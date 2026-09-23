@AGENTS.md

# texnap

Desktop web app: paste or drag-and-drop a screenshot/photo of mathematical content, get back rigorous, compilable LaTeX that renders identically.

## What this is

Single-user personal tool (no auth, no accounts, no v1 database). The core loop:

1. User pastes (Cmd+V), drags-and-drops, or picks an image containing one or more math formulas.
2. Image goes to a server route that calls a vision LLM with a strict LaTeX-transcription prompt.
3. The returned LaTeX is rendered client-side (KaTeX) next to the original image so the user can visually verify fidelity.
4. User copies the LaTeX, or edits it inline with live re-render if the model got something wrong.

v1 scope is **isolated formulas** (Mathpix-Snip style), not full mixed text+math pages — that's a deliberate v2 boundary, see `Trinity/TEXNAP/DECISIONS.md`.

## Stack (locked decisions)

- Next.js 16 App Router + TypeScript + Tailwind CSS 4 — `create-next-app` default, matches [[commyo-project]] conventions.
- OCR engine: **vision LLM (Anthropic Claude primary)**, called from a server route, not a self-hosted specialized model. Chosen over pix2tex/UniMERNet because it needs no GPU inference infra and deploys straight to Vercel; chosen over Mathpix because it's free/cheap at personal volume and lets us iterate on rigor via prompting. The OCR call sits behind an adapter interface (`src/lib/ocr/`) so a specialized or fallback provider (Gemini, Mathpix, self-hosted) can be swapped in later without touching the UI.
- Rendering: KaTeX for the live preview (fast, good coverage; MathJax only if KaTeX proves too limited for something we actually hit).
- Deploy: Vercel, deployed from P0 (empty shell) onward — don't wait until the app is "done" to put it online.
- No database, no auth for v1. If this ever becomes multi-user or needs history persistence, that's a new decision, not an assumption baked in now.

## Where things live

- Code + repo: `/Users/elyo/Desktop/TRINITY/texnap/` — private `github.com/ElyOgl/texnap`, branch `main`.
- Docs: `/Users/elyo/Desktop/TRINITY/Trinity/TEXNAP/` — hub is `TEXNAP-Index.md`, live state in `STATUS.md`, roadmap/phases in `ROADMAP.md`, locked calls in `DECISIONS.md`. Never write texnap notes into another project's Trinity folder.

## Known environment gotchas (this Mac)

- If `git push` fails with `403 Write access to repository not granted` despite a valid `gh auth status`, the keychain is serving a stale PAT. Fix per-repo:
  ```
  git config --local --replace-all credential.https://github.com.helper ""
  git config --local --add credential.https://github.com.helper "!gh auth git-credential"
  ```
- GitHub commits must use `273943543+ElyOgl@users.noreply.github.com` (email privacy is on) — already set as both global and local `user.email` for this repo as of setup.
- No `bun` on this machine — always `npm`.

## Working session plan

See `Trinity/TEXNAP/ROADMAP.md` for the phased plan (P0–P4) and per-phase verification checklists. Each phase is meant to be one working session with a clear gate before moving to the next.
