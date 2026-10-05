import type { HistoryEntry } from "./history";

export type Group = { tag: string; entries: HistoryEntry[] };

const UNTAGGED = "Sans tag";

/// Group entries for the sheet. When `grouped`, bucket by each entry's first
/// tag (entries keep their order; untagged ones go last under the `untagged`
/// label). When not grouped, one bucket with everything. `untagged` defaults to
/// French so callers without a locale (and tests) keep the old behavior.
export function groupForSheet(
  entries: HistoryEntry[],
  grouped: boolean,
  untagged: string = UNTAGGED,
): Group[] {
  if (!grouped) return entries.length ? [{ tag: "", entries }] : [];
  const order: string[] = [];
  const buckets = new Map<string, HistoryEntry[]>();
  for (const e of entries) {
    const tag = e.tags?.[0] ?? untagged;
    if (!buckets.has(tag)) {
      buckets.set(tag, []);
      order.push(tag);
    }
    buckets.get(tag)!.push(e);
  }
  // Untagged bucket sorts last.
  order.sort((a, b) => (a === untagged ? 1 : 0) - (b === untagged ? 1 : 0));
  return order.map((tag) => ({ tag, entries: buckets.get(tag)! }));
}

// Escape the handful of LaTeX specials that can appear in a user-typed title.
function escapeTitle(s: string): string {
  return s.replace(/([&%#_$])/g, "\\$1");
}

/// A bare formula needs display-math wrapping to compile; a snippet that already
/// carries a math environment or text/markup goes in verbatim.
export function wrapForTex(latex: string): string {
  const s = latex.trim();
  const hasMathEnv =
    /\\begin\{(align|equation|gather|multline|cases|array|[pbvBV]?matrix|split)\*?\}/.test(s) ||
    s.includes("\\[") ||
    s.includes("$$") ||
    /(^|[^\\])\$/.test(s);
  const hasText = /\\(text|textbf|textit|section|subsection|item)\b|\\begin\{(itemize|enumerate)\}/.test(s);
  return hasMathEnv || hasText ? s : `\\[\n${s}\n\\]`;
}

/// Build a compilable standalone .tex document from the selected entries.
/// `babelLang` is the babel option (e.g. "french"/"english"); defaults to French
/// so callers without a locale (and tests) keep the old behavior.
export function buildTex(title: string, groups: Group[], babelLang: string = "french"): string {
  const head = [
    "\\documentclass[a4paper,11pt]{article}",
    "\\usepackage[utf8]{inputenc}",
    "\\usepackage[T1]{fontenc}",
    `\\usepackage[${babelLang}]{babel}`,
    "\\usepackage{amsmath,amssymb}",
    "\\usepackage[margin=2cm]{geometry}",
    "",
    "\\begin{document}",
    "",
    `\\begin{center}\\Large\\textbf{${escapeTitle(title)}}\\end{center}`,
    "\\medskip",
    "",
  ];
  const body: string[] = [];
  for (const g of groups) {
    if (g.tag) body.push(`\\section*{${escapeTitle(g.tag)}}`, "");
    for (const e of g.entries) {
      body.push(wrapForTex(e.latex), "\\bigskip", "");
    }
  }
  return [...head, ...body, "\\end{document}", ""].join("\n");
}
