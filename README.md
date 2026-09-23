# texnap

Paste or drag-and-drop a screenshot/photo of math content, get back rigorous, compilable LaTeX that renders identically.

Native macOS app (Tauri — Rust + React/Vite), single-user, no auth, no deployment. See [`CLAUDE.md`](./CLAUDE.md) for the project guide and stack decisions, and `Trinity/TEXNAP/ROADMAP.md` (in the vault) for the phased build plan.

## Development

```bash
npm install
npm run tauri dev   # opens the native window, hot-reloads the webview
```

`npm run dev` alone runs just the Vite frontend in a browser tab, without the native shell — useful for pure UI iteration but won't have the Rust bridge (OCR calls) available.

Copy `.env.example` to `.env` and fill in `ANTHROPIC_API_KEY` once P2 (OCR core) is wired up.

## Build

```bash
npm run tauri build   # produces .app / .dmg under src-tauri/target/release/bundle/
```

Unsigned (personal use only) — macOS will flag it as from an unidentified developer on first launch; right-click → Open once to clear it.
