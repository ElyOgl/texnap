import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { renderLatex } from "../lib/latex";
import { buildTex, groupForSheet, type Group } from "../lib/fiche";
import type { HistoryEntry } from "../lib/history";
import { HintBar } from "./ui";
import { useI18n, type Lang } from "../lib/i18n";
import "katex/dist/katex.min.css";

type Props = {
  entries: HistoryEntry[];
  onClose: () => void;
};

const LOCALES: Record<Lang, string> = {
  fr: "fr-FR",
  en: "en-US",
  it: "it-IT",
  de: "de-DE",
  es: "es-ES",
};
const localeOf = (lang: Lang) => LOCALES[lang];
// babel package option per UI language (ngerman = modern German orthography).
const BABEL: Record<Lang, string> = {
  fr: "french",
  en: "english",
  it: "italian",
  de: "ngerman",
  es: "spanish",
};
const today = (lang: Lang) =>
  new Date().toLocaleDateString(localeOf(lang), { day: "numeric", month: "long", year: "numeric" });

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A self-contained printable page: KaTeX from CDN (crisp vector math), the same
// rendered HTML as the in-app preview, and an auto-print once fonts are ready.
// Opened in the user's real browser because WKWebView's window.print() is a
// no-op inside Tauri on macOS.
function buildStandaloneHtml(
  title: string,
  date: string,
  groups: Group[],
  cols: number,
  countLabel: string,
  htmlLang: string,
): string {
  const sections = groups
    .map((g) => {
      const items = g.entries
        .map((e) => `<div class="item tex-render">${renderLatex(e.latex).html}</div>`)
        .join("");
      const head = g.tag ? `<div class="sec">${escapeHtml(g.tag)}</div>` : "";
      return `${head}<div class="cols">${items}</div>`;
    })
    .join("");
  const safe = escapeHtml(title || "Fiche");
  return `<!DOCTYPE html>
<html lang="${htmlLang}"><head><meta charset="utf-8"><title>${safe}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script>window.addEventListener('load',function(){var p=(document.fonts&&document.fonts.ready)||Promise.resolve();p.then(function(){setTimeout(function(){window.print();},200);});});</script>
<style>
  @page { margin: 1.4cm; }
  body { font-family: Georgia,'Times New Roman',serif; color:#14141a; margin:0; padding:24px; }
  .head { display:flex; justify-content:space-between; align-items:baseline; border-bottom:2px solid #14141a; padding-bottom:8px; margin-bottom:14px; }
  .head h1 { font-size:18px; margin:0; }
  .head .meta { font-family:-apple-system,system-ui,sans-serif; font-size:10px; color:#666; }
  .sec { font-family:-apple-system,system-ui,sans-serif; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:#d85a30; margin:12px 0 8px; }
  .cols { column-count:${cols}; column-gap:22px; }
  .item { break-inside:avoid; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid #eee; font-size:13px; line-height:1.5; }
  .tex-render ul,.tex-render ol{margin:.4em 0;padding-left:1.3em;} .tex-render li{margin:.2em 0;}
  .katex-display{margin:.4em 0;}
</style></head>
<body>
  <div class="head"><h1>${safe}</h1><span class="meta">texnap · ${escapeHtml(date)} · ${escapeHtml(countLabel)}</span></div>
  ${sections}
</body></html>`;
}

/// F2: build a printable revision sheet ("fiche") from selected library
/// formulas. Preview renders with KaTeX (same as the app); "Export PDF" prints
/// it via the OS "Save as PDF"; "Export .tex" writes a compilable document.
export function FichePanel({ entries, onClose }: Props) {
  const { t, lang } = useI18n();
  const [title, setTitle] = useState(() => t("fiche.defaultTitle"));
  const [grouped, setGrouped] = useState(true);
  const [cols, setCols] = useState(2);
  const [savedTex, setSavedTex] = useState(false);

  const groups = useMemo(
    () => groupForSheet(entries, grouped, t("fiche.untagged")),
    [entries, grouped, t],
  );
  const date = useMemo(() => today(lang), [lang]);
  const countLabel = t("fiche.formulaCount", { count: entries.length });

  const [pdfError, setPdfError] = useState<string | null>(null);
  const exportPdf = async () => {
    setPdfError(null);
    try {
      const html = buildStandaloneHtml(title || t("fiche.fallbackTitle"), date, groups, cols, countLabel, lang);
      const path = await invoke<string>("write_temp_html", { contents: html });
      await openPath(path); // opens in the default browser; Cmd+P → Save as PDF
    } catch (e) {
      setPdfError(String(e));
    }
  };

  const exportTex = async () => {
    const fallback = t("fiche.fallbackTitle");
    const safe = (title || fallback).replace(/[^\p{L}\p{N} _-]/gu, "").trim() || fallback;
    const path = await save({
      defaultPath: `${safe}.tex`,
      filters: [{ name: "LaTeX", extensions: ["tex"] }],
    });
    if (!path) return;
    await invoke("save_text_file", { path, contents: buildTex(title, groups, BABEL[lang]) });
    setSavedTex(true);
    window.setTimeout(() => setSavedTex(false), 2000);
  };

  return (
    <div className="flex flex-1 flex-col">
      {/* Controls — hidden when printing */}
      <div className="no-print flex flex-col gap-2.5 border-b border-line p-3.5">
        <div className="flex items-center justify-between">
          <button onClick={onClose} className="text-[11px] text-ink-3 hover:text-ink-2">
            {t("common.back")}
          </button>
          <span className="text-[13px] font-medium text-ink">{t("fiche.panelTitle", { count: entries.length })}</span>
          <span className="w-8" />
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          placeholder={t("fiche.titlePlaceholder")}
          className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink outline-none focus:border-accent/50"
        />
        <div className="flex items-center gap-4 text-[11px] text-ink-2">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.currentTarget.checked)} />
            {t("fiche.groupByTag")}
          </label>
          <label className="flex items-center gap-1.5">
            {t("fiche.columns")}
            <select
              value={cols}
              onChange={(e) => setCols(Number(e.currentTarget.value))}
              className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-ink outline-none"
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </label>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => void exportTex()}
              className="rounded-md border border-line-2 px-3 py-1.5 text-[12px] text-ink-2 hover:text-ink"
            >
              {savedTex ? t("fiche.texSaved") : t("fiche.exportTex")}
            </button>
            <button
              onClick={() => void exportPdf()}
              title={t("fiche.exportPdfTitle")}
              className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink hover:brightness-110"
            >
              {t("fiche.exportPdf")}
            </button>
          </div>
          {pdfError && <p className="text-[11px] text-red-400">{t("fiche.pdfError", { error: pdfError })}</p>}
        </div>
      </div>

      {/* The sheet — the only thing that prints (see @media print in App.css) */}
      <div className="flex-1 overflow-y-auto bg-surface p-4">
        <div className="fiche-print mx-auto max-w-[720px] bg-paper px-8 py-7 text-paper-ink">
          <div className="mb-4 flex items-baseline justify-between border-b-2 border-paper-ink pb-2">
            <span className="text-[18px] font-bold">{title || t("fiche.fallbackTitle")}</span>
            <span className="font-sans text-[10px] text-neutral-500">
              texnap · {date} · {countLabel}
            </span>
          </div>

          {groups.map((g, gi) => (
            <div key={g.tag || gi}>
              {g.tag && (
                <div className="mb-2 mt-1 font-sans text-[11px] font-bold uppercase tracking-wide text-accent">
                  {g.tag}
                </div>
              )}
              <div style={{ columnCount: cols, columnGap: "22px" }}>
                {g.entries.map((e) => {
                  const r = renderLatex(e.latex);
                  return (
                    <div
                      key={e.id}
                      className="tex-render mb-3 break-inside-avoid border-b border-neutral-200 pb-2.5 text-[13px]"
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{ __html: r.html }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <HintBar hints={[{ keys: ["esc"], label: t("hint.close"), right: true }]} />
    </div>
  );
}
