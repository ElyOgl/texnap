import { describe, expect, it } from "vitest";
import { buildTex, groupForSheet, wrapForTex } from "./fiche";
import type { HistoryEntry } from "./history";

const entry = (id: string, latex: string, tags: string[] = []): HistoryEntry => ({
  id,
  createdAt: 0,
  latex,
  provider: "gemini",
  thumbnail: "",
  tags,
});

describe("wrapForTex", () => {
  it("wraps a bare formula in display math", () => {
    expect(wrapForTex("a^2 + b^2 = c^2")).toBe("\\[\na^2 + b^2 = c^2\n\\]");
  });
  it("leaves an existing math environment verbatim", () => {
    const s = "\\begin{align*} x &= 1 \\end{align*}";
    expect(wrapForTex(s)).toBe(s);
  });
  it("leaves text/markup snippets verbatim", () => {
    const s = "\\textbf{Théorème} $x > 0$";
    expect(wrapForTex(s)).toBe(s);
  });
});

describe("groupForSheet", () => {
  it("buckets by first tag with untagged last", () => {
    const entries = [
      entry("a", "x", ["Algebra"]),
      entry("b", "y"),
      entry("c", "z", ["Algebra"]),
    ];
    const groups = groupForSheet(entries, true);
    expect(groups.map((g) => g.tag)).toEqual(["Algebra", "Sans tag"]);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["a", "c"]);
    expect(groups[1].entries.map((e) => e.id)).toEqual(["b"]);
  });
  it("returns a single bucket when not grouped", () => {
    const groups = groupForSheet([entry("a", "x", ["T"]), entry("b", "y")], false);
    expect(groups).toHaveLength(1);
    expect(groups[0].tag).toBe("");
  });
  it("uses the provided untagged label", () => {
    const groups = groupForSheet([entry("a", "x", ["Algebra"]), entry("b", "y")], true, "Untagged");
    expect(groups.map((g) => g.tag)).toEqual(["Algebra", "Untagged"]);
  });
});

describe("buildTex", () => {
  it("produces a compilable document with title, sections and formulas", () => {
    const groups = groupForSheet([entry("a", "e^{i\\pi} = -1", ["Complexes"])], true);
    const tex = buildTex("Ma fiche", groups);
    expect(tex).toContain("\\documentclass");
    expect(tex).toContain("\\begin{document}");
    expect(tex).toContain("\\textbf{Ma fiche}");
    expect(tex).toContain("\\section*{Complexes}");
    expect(tex).toContain("e^{i\\pi} = -1");
    expect(tex.trimEnd().endsWith("\\end{document}")).toBe(true);
  });
  it("defaults to french babel and honors an override", () => {
    const groups = groupForSheet([entry("a", "x")], false);
    expect(buildTex("t", groups)).toContain("\\usepackage[french]{babel}");
    expect(buildTex("t", groups, "english")).toContain("\\usepackage[english]{babel}");
  });
});
