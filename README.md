# texnap

Paste or drag-and-drop a screenshot/photo of math content, get back rigorous, compilable LaTeX that renders identically.

Desktop web app, single-user, no auth. See [`CLAUDE.md`](./CLAUDE.md) for the project guide and stack decisions, and `Trinity/TEXNAP/ROADMAP.md` (in the vault) for the phased build plan.

## Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Copy `.env.example` to `.env.local` and fill in `ANTHROPIC_API_KEY` once P2 (OCR core) is wired up.
