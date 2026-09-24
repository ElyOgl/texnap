import katex from "katex";

export type RenderedBlock = {
  html: string;
  /** Non-null when KaTeX couldn't fully render this block. */
  error: string | null;
};

// The OCR prompt tells the model to separate independent formulas with a
// blank line, so one transcription can legitimately be several standalone
// snippets. KaTeX renders a single expression at a time, so split first —
// otherwise a perfectly good two-formula transcription fails to render.
export function splitBlocks(latex: string): string[] {
  return latex
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

export function renderBlock(block: string): RenderedBlock {
  try {
    // Strict first: this is the only way to know definitively whether KaTeX
    // covers the expression, rather than silently rendering it half-wrong.
    return {
      html: katex.renderToString(block, { displayMode: true, throwOnError: true }),
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      // Still show a best-effort render — KaTeX marks the parts it couldn't
      // parse in red. The LaTeX itself may be perfectly correct and simply
      // outside the subset KaTeX supports, which is a preview limitation,
      // not a transcription failure. The UI must say which.
      return {
        html: katex.renderToString(block, { displayMode: true, throwOnError: false }),
        error: message,
      };
    } catch {
      return { html: "", error: message };
    }
  }
}
