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
- **Formula library** — every transcription is saved automatically; tag it,
  pin it, and search across your formulas (see [Library](#library) below).
- **Accuracy check** (optional) — a second pass asks the model whether the
  LaTeX faithfully matches the source image.

## Install

Download the latest `.dmg` from
[Releases](https://github.com/ElyOgl/texnap/releases), open it, and drag
**texnap** to Applications. Apple Silicon (M-series) only for now — an Intel /
universal build comes with the signed release.

### First launch — getting past Gatekeeper

texnap is **not yet notarized by Apple** (We do not have that yet but it's underway !). Because you downloaded it, macOS quarantines it,
and on macOS 15 the old right-click → Open trick is gone. Do this once:

1. Try to open texnap. macOS blocks it ("Apple could not verify…").
2. Open **System Settings → Privacy & Security**, scroll down to the message
   "texnap was blocked", and click **Open Anyway**, then confirm with Touch ID
   / your password. texnap opens normally from then on.

If instead it says texnap is **"damaged and can't be opened"** (a stricter
quarantine some downloads get), clear the quarantine flag in Terminal, then open
it the normal way:

```bash
xattr -dr com.apple.quarantine /Applications/texnap.app
```

This is only because the app is unsigned — none of it phones home, and you bring
your own API key (below). Prefer no warnings at all? Use the CLI, which builds
from source (see [Command line](#command-line)).

## Setup

On first run, pick a provider and paste an API key (stored locally on your Mac,
never in the repo). Gemini has a free tier and is a good default —
[get a key](https://aistudio.google.com/apikey).

## Library

Every transcription is **saved automatically** — no "save" button. Open the
library from the bookmark icon in the top bar to browse, re-open, or re-copy
anything you've transcribed. Each entry keeps a thumbnail of the source, the
LaTeX, which provider produced it, and when.

- **Tags** — organize formulas by chapter or topic ("Séries entières",
  "Réduction", …). Add tags right after transcribing (a *Tags* row appears under
  the result) or on any entry in the library. Tags autocomplete from ones you've
  already used, and clicking a tag filters the list to it.
- **Pin** — pin the formulas you reach for often; they sort to the top in a
  *Pinned* section.
- **Search** — press ⌘F in the library to search across both the LaTeX and your
  tags.

### Keeping formulas vs. the rolling log

The library doubles as a recent-history log *and* a curated collection, with one
simple rule:

- **Untagged, unpinned** entries are a rolling log — only the most recent 100 are
  kept, older ones fall off.
- **Tagged or pinned** entries are kept **indefinitely** — they never fall off.

So to keep a formula around for good, just **tag or pin it**. The library's
*Clear untagged* button purges only the rolling log; your tagged and pinned
formulas are never touched.

Everything lives in `history.json` under
`~/Library/Application Support/fr.elyo.texnap/` (next to your API key) — local
to your Mac, never uploaded, kept across restarts, and shared with the CLI.

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
| ⌃⌘, | Capture a screen region (customizable in Settings) |
| ⌘V | Paste / new capture |
| ⏎ | Transcribe |
| ⌘C | Copy the LaTeX |
| ⌘Z | Undo the last capture |
| ⌘F | Search the library (in the library view) |
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
