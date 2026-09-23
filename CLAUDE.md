# texnap

Native macOS desktop app: paste or drag-and-drop a screenshot/photo of mathematical content, get back rigorous, compilable LaTeX that renders identically.

## What this is

Single-user personal tool (no auth, no accounts, no v1 database, no cloud deployment). The core loop:

1. User pastes (Cmd+V), drags-and-drops, or picks an image containing one or more math formulas, into the native window.
2. The image goes to a Rust command (Tauri backend) that calls a vision LLM with a strict LaTeX-transcription prompt.
3. The returned LaTeX is rendered in the webview (KaTeX) next to the original image so the user can visually verify fidelity.
4. User copies the LaTeX, or edits it inline with live re-render if the model got something wrong.

v1 scope is **isolated formulas** (Mathpix-Snip style), not full mixed text+math pages — that's a deliberate v2 boundary, see `Trinity/TEXNAP/DECISIONS.md`.

## Stack (locked decisions)

- **Tauri 2** (Rust) + React 19 + TypeScript + Vite + Tailwind CSS 4. Packages to a native `.app` / `.dmg` via `npm run tauri build`.
- **Not Next.js, not Vercel.** texnap started as a Next.js web app (2026-09-23) and pivoted to Tauri the same day, before any real UI was built — see `DECISIONS.md` § Tauri pivot for why. Nothing web-hosted remains; the app never needs to be deployed anywhere.
- OCR engine: **vision LLM (Anthropic Claude primary)**, called from a **Rust `#[tauri::command]`**, not from JS/the webview. Chosen over pix2tex/UniMERNet (needs GPU inference infra) and over Mathpix (closed, paid). Doing the API call in Rust rather than in the webview keeps the API key out of the JS/DOM context entirely. The call sits behind a small Rust-side abstraction so a fallback provider (Gemini, Mathpix, self-hosted) could be added later without touching the UI.
- Rendering: KaTeX for the live preview (fast, good coverage; MathJax only if KaTeX proves too limited for something we actually hit).
- API key: read from a local `.env` (via the `dotenvy` crate) for now during dev. Moving it to macOS Keychain via a Tauri plugin is a nice-to-have hardening step (P4), not a v1 blocker — this is a single-user local tool, not a hosted service.
- No database, no auth for v1. If this ever needs history persistence, that's a new decision, not an assumption baked in now.
- Packaging: `npm run tauri build` produces a `.dmg` under `src-tauri/target/release/bundle/dmg/`. **No Apple code signing / notarization** — this is for personal use only. Gatekeeper will flag the unsigned app on first launch; right-click → Open (or `xattr -cr` on the `.app`) clears it once. Only becomes a real requirement (Apple Developer Program, notarization) if texnap is ever given to someone else.

## Where things live

- Code + repo: `/Users/elyo/Desktop/TRINITY/texnap/` — private `github.com/ElyOgl/texnap`, branch `main`.
  - `src/` — React/TS frontend (Vite).
  - `src-tauri/` — Rust backend: window setup (`src/lib.rs`), Tauri commands (OCR call lands here in P2).
- Docs: `/Users/elyo/Desktop/TRINITY/Trinity/TEXNAP/` — hub is `TEXNAP-Index.md`, live state in `STATUS.md`, roadmap/phases in `ROADMAP.md`, locked calls in `DECISIONS.md`. Never write texnap notes into another project's Trinity folder.

## Local dev

```bash
npm run dev          # Vite only, for pure frontend iteration (no native window)
npm run tauri dev    # full app: opens the native window, hot-reloads the webview
npm run tauri build  # produces the .app / .dmg
```

`cargo check` inside `src-tauri/` is the fast way to catch Rust errors without a full build or opening a window.

## Known environment gotchas (this Mac)

- If `git push` fails with `403 Write access to repository not granted` despite a valid `gh auth status`, the keychain is serving a stale PAT. Fix per-repo:
  ```
  git config --local --replace-all credential.https://github.com.helper ""
  git config --local --add credential.https://github.com.helper "!gh auth git-credential"
  ```
- GitHub commits must use `273943543+ElyOgl@users.noreply.github.com` (email privacy is on) — set as both global and local `user.email`.
- No `bun` on this machine — always `npm`.
- Rust toolchain installed 2026-09-23 via `rustup` specifically for this project (`~/.cargo/`, stable channel). Xcode Command Line Tools were already present (required by Tauri on macOS).

## Working session plan

See `Trinity/TEXNAP/ROADMAP.md` for the phased plan (P0–P4) and per-phase verification checklists. Each phase is meant to be one working session with a clear gate before moving to the next.
