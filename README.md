# texnap

**Snap a screenshot of any math, get clean LaTeX.** Press a shortcut, select a
region of your screen, and texnap transcribes the formula (or a whole
theorem/proof block) into rigorous, compilable LaTeX — rendered right next to
the source so you can check it at a glance.

A small, fast, keyboard-first macOS app. Single-user, local, **bring your own
API key** — nothing is sent anywhere except the provider you choose, and no
secrets are shipped in the app.

## Features

- **Capture anywhere** — a global shortcut (default ⌃⌘M, customizable) opens a
  region selector; the snip is transcribed automatically.
- **Paste or drag** a screenshot in too (⌘V / drag-and-drop / file picker).
- **Mixed text + math** — whole lemma/proof blocks (bold, italic, lists, inline
  and display math) render correctly, not just bare formulas.
- **Five OCR providers** — Google Gemini (free tier), SimpleTex, OpenRouter,
  OpenAI, Anthropic — with **automatic fallback** if one hits its quota.
- **Live editing** with KaTeX preview, one-key copy, and undo (⌘Z).
- **History** of past transcriptions, and an optional **accuracy check** that
  asks the model whether the LaTeX matches the image.

## Install

Download the latest `.dmg` from
[Releases](https://github.com/ElyOgl/texnap/releases), open it, and drag
**texnap** to Applications.

The app is currently **unsigned** (personal build). On first launch macOS will
say it's from an unidentified developer — open **System Settings → Privacy &
Security** and click **Open Anyway**, or right-click the app → **Open**.

## Setup

On first run, pick a provider and paste an API key (stored locally on your Mac,
never in the repo). Gemini has a free tier and is a good default —
[get a key](https://aistudio.google.com/apikey).

## Command line

texnap also ships as a terminal tool that reuses the exact same engine — handy
for scripts, pipelines, or a quick transcription without the window. It needs
the [Rust toolchain](https://rustup.rs) (it compiles from source, so there's no
Gatekeeper/notarization step):

```bash
cargo install --git https://github.com/ElyOgl/texnap texnap-cli
```

That installs a `texnap` command:

```bash
texnap formula.png                 # LaTeX to stdout
texnap shot.png --verify           # + a confidence check on stderr
texnap shot.png --provider openai  # force a provider
texnap shot.png --copy             # also copy to the clipboard
pbpaste | texnap - --json          # read image bytes from stdin, emit JSON
```

Keys are resolved env-first: set `TEXNAP_API_KEY` (and optionally
`TEXNAP_PROVIDER`) to run standalone, otherwise the CLI reuses whatever you
configured in the desktop app. Like the app, it falls back to another
configured provider if one hits its quota.

## Shortcuts

| Key | Action |
| --- | --- |
| ⌃⌘M | Capture a screen region (customizable in Settings) |
| ⌘V | Paste / new capture |
| ⏎ | Transcribe |
| ⌘C | Copy the LaTeX |
| ⌘Z | Undo the last capture |
| ⌘, | Settings |

## Development

```bash
npm install
npm run tauri dev     # native window, hot reload
npm run tauri build   # produce a .dmg under src-tauri/target/release/bundle/
```

Requires Node and the Rust toolchain (Tauri 2). Copy `.env.example` to `.env`
for a dev-only provider key, or just set one in the app's Settings.

The Rust side is a Cargo workspace under `src-tauri/`: **`core/`** is the
Tauri-free OCR engine (providers, transcription, verification, key rules),
shared by the desktop app (`src-tauri/`) and the CLI (`cli/`). `cargo test
--workspace` runs everything.

Built with Tauri 2 (Rust) + React + Vite + KaTeX.
