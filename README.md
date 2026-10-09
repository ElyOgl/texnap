# texnap

<div align="center">

▶️ **[Watch the ~80-second demo](https://raw.githubusercontent.com/ElyOgl/texnap/main/assets/demo.mp4)** — a quick tour of capturing math and getting LaTeX back.

</div>

**Snap a screenshot of any math, get clean LaTeX.** Press a shortcut, select a
region of your screen, and texnap transcribes the formula (or a whole
theorem/proof block) into rigorous, compilable LaTeX — rendered right next to
the source so you can check it at a glance.

A small, fast, keyboard-first macOS app. Single-user and local: run it **fully
offline with the built-in on-device model**, or **bring your own API key** for a
cloud provider — either way nothing is sent anywhere except the provider you
choose, and no secrets are shipped in the app.

## Features

- **Capture anywhere** — a global shortcut (default ⌃⌘M, customizable) opens a
  region selector; the snip is transcribed automatically.
- **Paste or drag** a screenshot in too (⌘V / drag-and-drop / file picker).
- **Mixed text + math** — whole lemma/proof blocks (bold, italic, lists, inline
  and display math) render correctly, not just bare formulas.
- **Offline, on-device OCR** — a built-in local model that needs **no API key
  and no network** (see [Offline mode](#offline-mode-on-device-ocr) below).
- **Six OCR engines** — the offline local model plus Google Gemini (free tier),
  SimpleTex, OpenRouter, OpenAI, and Anthropic — with **automatic fallback** to
  the local model if a cloud provider hits its quota or you lose connection.
- **Live editing** with KaTeX preview, one-key copy, and undo (⌘Z).
- **Formula library** — every transcription is saved automatically; tag it,
  pin it, and search across your formulas (see [Library](#library) below).
- **Revision sheets** — pick formulas from your library and export a printable
  *fiche* (PDF) or a compilable `.tex` file (see [Revision sheets](#revision-sheets-fiches)).
- **Accuracy check** (optional) — a second pass asks the model whether the
  LaTeX faithfully matches the source image.

> The app interface is available in **French, English, Italian, German, and
> Spanish** — switch anytime in Settings (⌘,); it auto-detects your Mac's
> language on first launch. This README is in English.

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

Don't want to deal with keys at all? Choose **Local (offline)** — see below.

## Offline mode (on-device OCR)

texnap ships with a **local OCR model that runs entirely on your Mac** — no API
key, no quota, no network, nothing leaves the machine.

1. Open **Settings** (⌘, — or click the **OCR · …** badge on the home screen).
2. Pick **Local (hors-ligne)** in the provider dropdown.
3. Click **Télécharger le modèle** once. The model (~600 MB) downloads with a
   per-file progress bar; it's stored under
   `~/Library/Application Support/fr.elyo.texnap/models/` and kept for good.
4. Click **Utiliser ce modèle**. From then on, transcription runs on-device.

The local engine is bundled into the app, so once the model is downloaded it
works with no internet. texnap also **falls back to it automatically** when a
cloud provider is unreachable or out of quota, so you're never stuck offline.

Notes: the model is Apple-Silicon only (like the rest of the app); the first
transcription after launch is a little slower while the model loads, then it's
fast. The terminal CLI stays cloud-only (keeps it lightweight) — offline OCR is
an app feature.

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

## Revision sheets (fiches)

Turn a selection of library formulas into a printable revision sheet — handy for
an *anti-sèche* or a chapter recap.

1. In the library, click **Créer une fiche**, tick the formulas you want
   (or **Tout sélectionner**), then **Créer la fiche →**.
2. Give it a title, choose 1–3 columns, and optionally **group by tag**.
3. Export it:
   - **Exporter PDF** — opens a clean, print-ready page in your browser; press
     ⌘P → *Save as PDF*.
   - **Exporter .tex** — saves a compilable LaTeX document you can drop into your
     own notes or compile directly.

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
| ⌃⌘, | (AZERTY) Capture a screen region (customizable in Settings) |
| ⌃⌘M | (QWERTY) Capture a screen region (customizable in Settings) |
| ⌘V | Paste / new capture |
| ⏎ | Transcribe |
| ⌘C | Copy the LaTeX |
| ⌘Z | Undo the last capture |
| ⌘F | Search the library (in the library view) |
| ⌘, | Settings |

The capture shortcut is bound to a **physical key position**, not a letter, so
it fires the same regardless of layout. The default is the key at the QWERTY
**M** position — which on an **AZERTY** keyboard is the **,** key (so AZERTY
users press ⌃⌘,). Re-record it for your own layout anytime in Settings.

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

## Background story 

The idea of making this app came to me, as a student in maths and economics, as teachers protect their pdfs against copy-pasting, 
which is fair to avoid plagiat or any kind of stealing, but which kinda bothered me when I wanted to make Anki cards out of the those documents.


<div align = "center">

[![Watch the texnap demo](https://raw.githubusercontent.com/ElyOgl/texnap/main/assets/demo-poster.png)](https://raw.githubusercontent.com/ElyOgl/texnap/main/assets/demo.mp4)

</div>
