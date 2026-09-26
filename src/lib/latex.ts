import katex from "katex";

export type Rendered = {
  html: string;
  /** True when KaTeX couldn't fully render one of the math islands. */
  hadError: boolean;
};

// texnap's OCR often returns whole theorem/proof blocks — mixed prose, text
// formatting, lists AND math — not just a bare formula. KaTeX only renders
// *math*, so feeding it a whole LaTeX document throws ("No such environment:
// itemize"). This is a small text-mode LaTeX→HTML converter: it renders the
// math islands ($…$, \[…\], \(…\)) with KaTeX and turns the common text-mode
// constructs (\textbf, \textit, itemize/enumerate, spacing, …) into HTML.
// Unknown commands degrade gracefully (their brace content is kept as text),
// and it never throws — a mostly-correct document previews mostly right.

type State = { hadError: boolean };

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const escapeText = (s: string) => s.replace(/[&<>]/g, (c) => ESC[c]);

function renderMath(tex: string, display: boolean, state: State): string {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: true });
  } catch {
    state.hadError = true;
    try {
      return katex.renderToString(tex, { displayMode: display, throwOnError: false });
    } catch {
      return `<code>${escapeText(tex)}</code>`;
    }
  }
}

// s[i] must be "{"; returns [inner raw latex, index just past the matching "}"].
function readGroup(s: string, i: number): [string, number] {
  let depth = 0;
  let j = i;
  let inner = "";
  for (; j < s.length; j++) {
    const c = s[j];
    if (c === "{") {
      depth++;
      if (depth === 1) continue;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        j++;
        break;
      }
    }
    inner += c;
  }
  return [inner, j];
}

function findEnd(s: string, from: number, env: string): number {
  const beginTok = `\\begin{${env}}`;
  const endTok = `\\end{${env}}`;
  let depth = 1;
  let i = from;
  while (i < s.length) {
    if (s.startsWith(beginTok, i)) {
      depth++;
      i += beginTok.length;
    } else if (s.startsWith(endTok, i)) {
      depth--;
      if (depth === 0) return i;
      i += endTok.length;
    } else {
      i++;
    }
  }
  return -1;
}

const TEXT_WRAP: Record<string, string> = {
  textbf: "strong",
  textit: "em",
  emph: "em",
  textsl: "em",
  underline: "u",
  texttt: "code",
};
const PASSTHROUGH = new Set(["text", "mathrm", "textrm", "mbox", "textnormal", "textup", "textmd"]);
const DROP = new Set([
  "noindent", "centering", "par", "normalfont", "itshape", "bfseries",
  "small", "footnotesize", "large", "Large", "huge", "normalsize",
  "indent", "protect", "displaystyle", "textstyle",
]);
const BREAK = new Set(["medskip", "bigskip", "smallskip", "newline"]);
const SPACE = new Set(["hfill", "quad", "qquad", "enspace", "thinspace"]);
const SYM: Record<string, string> = {
  square: "□", blacksquare: "■", qed: "□", ldots: "…", dots: "…",
};

function convert(s: string, state: State): string {
  let out = "";
  let i = 0;
  let buf = "";
  const flush = () => {
    if (buf) {
      out += escapeText(buf);
      buf = "";
    }
  };
  while (i < s.length) {
    const c = s[i];
    if (c === "$") {
      flush();
      if (s[i + 1] === "$") {
        const end = s.indexOf("$$", i + 2);
        out += renderMath(end === -1 ? s.slice(i + 2) : s.slice(i + 2, end), true, state);
        i = end === -1 ? s.length : end + 2;
      } else {
        const end = s.indexOf("$", i + 1);
        out += renderMath(end === -1 ? s.slice(i + 1) : s.slice(i + 1, end), false, state);
        i = end === -1 ? s.length : end + 1;
      }
      continue;
    }
    if (c === "\\") {
      const two = s[i + 1];
      if (two === "[") {
        flush();
        const e = s.indexOf("\\]", i + 2);
        out += renderMath(e === -1 ? s.slice(i + 2) : s.slice(i + 2, e), true, state);
        i = e === -1 ? s.length : e + 2;
        continue;
      }
      if (two === "(") {
        flush();
        const e = s.indexOf("\\)", i + 2);
        out += renderMath(e === -1 ? s.slice(i + 2) : s.slice(i + 2, e), false, state);
        i = e === -1 ? s.length : e + 2;
        continue;
      }
      if (two === "\\") {
        flush();
        out += "<br>";
        i += 2;
        continue;
      }
      if (two && "{}%&_#$".includes(two)) {
        buf += two;
        i += 2;
        continue;
      }
      if (two === "," || two === " " || two === ";" || two === ":" || two === "!") {
        buf += " ";
        i += 2;
        continue;
      }
      if (two && /[a-zA-Z]/.test(two)) {
        let j = i + 1;
        let name = "";
        while (j < s.length && /[a-zA-Z]/.test(s[j])) {
          name += s[j];
          j++;
        }
        if (s[j] === "*") j++;

        if (name === "begin") {
          flush();
          let k = j;
          while (s[k] === " ") k++;
          let env = "";
          if (s[k] === "{") {
            const [inner, nj] = readGroup(s, k);
            env = inner.trim();
            k = nj;
          }
          if (env === "itemize" || env === "enumerate") {
            const e = findEnd(s, k, env);
            out += renderList(e === -1 ? s.slice(k) : s.slice(k, e), env, state);
            i = e === -1 ? s.length : e + `\\end{${env}}`.length;
          } else if (env) {
            // Assume a math environment (cases, pmatrix, align…) and let KaTeX try.
            const e = findEnd(s, k, env);
            const body = e === -1 ? s.slice(k) : s.slice(k, e);
            out += renderMath(`\\begin{${env}}${body}\\end{${env}}`, true, state);
            i = e === -1 ? s.length : e + `\\end{${env}}`.length;
          } else {
            i = k;
          }
          continue;
        }
        if (name === "end") {
          let k = j;
          while (s[k] === " ") k++;
          if (s[k] === "{") {
            const [, nj] = readGroup(s, k);
            k = nj;
          }
          i = k;
          continue;
        }
        if (name === "item") {
          flush();
          out += "<br>• ";
          i = j;
          continue;
        }
        if (name === "vspace" || name === "hspace") {
          let k = j;
          while (s[k] === " ") k++;
          if (s[k] === "{") {
            const [, nj] = readGroup(s, k);
            k = nj;
          }
          if (name === "vspace") {
            flush();
            out += '<div style="height:6px"></div>';
          } else {
            buf += " ";
          }
          i = k;
          continue;
        }
        if (BREAK.has(name)) {
          flush();
          out += '<div style="height:8px"></div>';
          i = j;
          continue;
        }
        if (SPACE.has(name)) {
          buf += " ";
          i = j;
          continue;
        }
        if (DROP.has(name)) {
          i = j;
          continue;
        }
        if (TEXT_WRAP[name] || PASSTHROUGH.has(name)) {
          let k = j;
          while (s[k] === " ") k++;
          let arg = "";
          if (s[k] === "{") {
            const [inner, nj] = readGroup(s, k);
            arg = inner;
            k = nj;
          }
          flush();
          const inner = convert(arg, state);
          out += TEXT_WRAP[name] ? `<${TEXT_WRAP[name]}>${inner}</${TEXT_WRAP[name]}>` : inner;
          i = k;
          continue;
        }
        if (SYM[name]) {
          buf += SYM[name];
          i = j;
          continue;
        }
        // Unknown command: keep any braced argument as text, drop the command.
        let k = j;
        while (s[k] === " ") k++;
        if (s[k] === "{") {
          const [inner, nj] = readGroup(s, k);
          flush();
          out += convert(inner, state);
          i = nj;
          continue;
        }
        i = j;
        continue;
      }
      // Unknown escape — drop the backslash.
      i += 1;
      continue;
    }
    if (c === "{") {
      const [inner, nj] = readGroup(s, i);
      flush();
      out += convert(inner, state);
      i = nj;
      continue;
    }
    if (c === "}") {
      i++;
      continue;
    }
    if (c === "~") {
      buf += " ";
      i++;
      continue;
    }
    if (c === "\n") {
      let k = i + 1;
      let nl = 1;
      while (k < s.length && (s[k] === " " || s[k] === "\t" || s[k] === "\n")) {
        if (s[k] === "\n") nl++;
        k++;
      }
      flush();
      out += nl >= 2 ? '<div style="height:8px"></div>' : " ";
      i = k;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

function renderList(body: string, env: string, state: State): string {
  const parts = body.split(/\\item\b/);
  const items: string[] = [];
  for (let p = 1; p < parts.length; p++) {
    items.push(`<li>${convert(parts[p], state)}</li>`);
  }
  const tag = env === "enumerate" ? "ol" : "ul";
  return `<${tag}>${items.join("")}</${tag}>`;
}

export function renderLatex(src: string): Rendered {
  const state: State = { hadError: false };
  const hasDelim = /\$|\\\[|\\\(/.test(src);
  const hasTextMode =
    /\\begin\{(itemize|enumerate)\}/.test(src) ||
    /\\(noindent|textbf|textit|emph|section|item)\b/.test(src);

  let html: string;
  if (!hasDelim && !hasTextMode) {
    // Bare formula (or a few separated by blank lines) — the original case:
    // no delimiters, so the whole thing is one math expression.
    const blocks = src.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    html = blocks.map((b) => renderMath(b, true, state)).join('<div style="height:6px"></div>');
  } else {
    html = convert(src, state);
  }
  return { html, hadError: state.hadError };
}
