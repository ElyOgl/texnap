import { describe, expect, it } from "vitest";
import { renderLatex } from "./latex";

describe("renderLatex", () => {
  it("renders a bare formula without error", () => {
    const r = renderLatex("\\forall x \\in U, \\; B(x,r) \\subset U.");
    expect(r.hadError).toBe(false);
    expect(r.html).toContain("katex");
  });

  it("renders a mixed theorem/proof block: text, bold, lists, inline math", () => {
    const src = `\\noindent\\textbf{Lemme.} \\textit{Soit $\\Omega$ non vide.}
\\begin{itemize}
\\item $\\emptyset \\in \\mathcal{F}$ car $\\emptyset = f^{-1}(\\emptyset)$.
\\item Deuxième point.
\\end{itemize}`;
    const r = renderLatex(src);
    expect(r.hadError).toBe(false);
    expect(r.html).toContain("<strong>");
    expect(r.html).toContain("<em>");
    expect(r.html).toContain("<ul>");
    expect((r.html.match(/<li>/g) || []).length).toBe(2);
    // No LaTeX control words should leak as raw text.
    expect(r.html).not.toContain("\\begin");
    expect(r.html).not.toContain("\\item");
    expect(r.html).not.toContain("\\textbf");
  });

  it("flags un-renderable LaTeX but still returns partial html", () => {
    const r = renderLatex("$\\foobarbaz{x} + \\frac{1}{2}$");
    expect(r.hadError).toBe(true);
    expect(r.html.length).toBeGreaterThan(0);
  });

  it("splits multiple blank-line-separated formulas", () => {
    const r = renderLatex("E = mc^2\n\n\\int_0^1 x\\,dx");
    expect(r.hadError).toBe(false);
    expect((r.html.match(/class="katex/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});
