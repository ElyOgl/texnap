import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { renderLatex } from "../lib/latex";
import { isEditableTarget } from "../lib/dom";
import type { Session } from "../lib/session";
import { TagEditor } from "./Tags";
import { HintBar } from "./ui";
import { WanderingEyes } from "./WanderingEyes";
import "katex/dist/katex.min.css";

type Props = {
  session: Session;
  canUndo: boolean;
  /** Auto-start transcription (snips do this; paste/drop wait for ⏎). */
  autoRun: boolean;
  onResult: (imageId: string, latex: string, provider: string, seconds: number) => void;
  onLatexChange: (latex: string) => void;
  onClear: () => void;
  /** Tags on the saved library entry for this result (F1); undefined until it's
      been saved (i.e. after a fresh transcription, not a reopened entry). */
  entryTags?: string[];
  onEntryTags?: (tags: string[]) => void;
};

type Transcription = {
  latex: string;
  providerLabel: string;
  fellBackFrom: string | null;
};

type Verdict = {
  level: "match" | "minor" | "mismatch" | "unknown";
  note: string;
  providerLabel: string;
};

// Turn the raw Rust error into something actionable (in French).
function friendlyError(raw: string): string {
  if (raw.includes(" 429") || /quota|rate.?limit/i.test(raw))
    return "Quota gratuit quotidien atteint. Ajoute la clé d'un autre fournisseur dans les Réglages (⌘,), ou attends la réinitialisation.";
  if (/^Network error/.test(raw) || /network/i.test(raw))
    return "Problème réseau — vérifie ta connexion et réessaie.";
  if (/No API key/i.test(raw)) return "Aucune clé API configurée — ajoute-en une dans les Réglages (⌘,).";
  if (/401|403|invalid.*key|api.?key/i.test(raw))
    return "La clé API a été rejetée. Vérifie-la dans les Réglages (⌘,).";
  return raw;
}

export function ImagePreview({ session, canUndo, autoRun, onResult, onLatexChange, onClear, entryTags, onEntryTags }: Props) {
  const { image, latex, provider, seconds } = session;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fellBackFrom, setFellBackFrom] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  // A new capture (or an undo/redo) is a different image — drop any transient
  // state tied to the previous one.
  useEffect(() => {
    setError(null);
    setCopied(false);
    setLoading(false);
    setFellBackFrom(null);
    setVerifying(false);
    setVerdict(null);
  }, [image.id]);

  // Editing the LaTeX invalidates a prior verdict.
  useEffect(() => {
    setVerdict(null);
  }, [latex]);

  const rendered = useMemo(() => (latex ? renderLatex(latex) : null), [latex]);

  const transcribe = async () => {
    setLoading(true);
    setError(null);
    const startedForImage = image.id;
    const started = performance.now();
    try {
      const result = await invoke<Transcription>("ocr_transcribe", {
        imageDataUrl: image.dataUrl,
      });
      setFellBackFrom(result.fellBackFrom);
      onResult(
        startedForImage,
        result.latex,
        result.providerLabel,
        (performance.now() - started) / 1000,
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!latex) return;
    await writeText(latex);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const verify = async () => {
    if (!latex) return;
    setVerifying(true);
    setVerdict(null);
    try {
      const result = await invoke<Verdict>("ocr_verify", {
        imageDataUrl: image.dataUrl,
        latex,
      });
      setVerdict(result);
    } catch (err) {
      setVerdict({ level: "unknown", note: String(err), providerLabel: "" });
    } finally {
      setVerifying(false);
    }
  };

  // ⏎ transcribe, ⌘C copy — deferring to native behaviour inside text fields.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.metaKey && !isEditableTarget(e.target)) {
        e.preventDefault();
        if (!loading) void transcribe();
      } else if (e.key === "c" && e.metaKey && latex && !isEditableTarget(e.target)) {
        e.preventDefault();
        void copy();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Snips auto-transcribe as soon as the image lands.
  useEffect(() => {
    if (autoRun && !latex && !loading) void transcribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, image.id]);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3.5">
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-ink-3">
            <span>Source</span>
            <button onClick={onClear} className="hover:text-ink-2">
              Effacer
            </button>
          </div>
          <div className="overflow-hidden rounded-lg border border-line bg-surface-2">
            <img
              src={image.dataUrl}
              alt={image.fileName}
              className="max-h-40 w-full object-contain"
            />
          </div>
        </div>

        {loading && (
          <div className="flex justify-center py-6">
            <WanderingEyes label="Transcription…" />
          </div>
        )}

        {!loading && !latex && !error && (
          <button
            type="button"
            onClick={() => void transcribe()}
            className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-ink hover:brightness-110"
          >
            Transcrire en LaTeX
            <span className="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[10.5px]">⏎</span>
          </button>
        )}

        {!loading && error && (
          <div className="rounded-lg border border-red-900 bg-red-950/60 px-3 py-2 text-[12px] text-red-300">
            {friendlyError(error)}
            <button
              onClick={() => void transcribe()}
              className="mt-2 block text-red-200 underline hover:text-red-100"
            >
              Réessayer
            </button>
          </div>
        )}

        {!loading && latex && (
          <>
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[11px] text-ink-3">
                <span>Rendu</span>
                {rendered && !rendered.hadError && <span className="text-ok">✓ rendu</span>}
              </div>
              <div
                className="tex-render overflow-x-auto rounded-lg bg-paper px-4 py-3 text-paper-ink"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: rendered?.html ?? "" }}
              />
              {rendered?.hadError && (
                <p className="mt-1.5 text-[11px] text-amber-400/90">
                  Aperçu incomplet — le LaTeX peut tout de même être correct (KaTeX n&rsquo;en
                  rend pas une partie).
                </p>
              )}
            </div>

            <div>
              <div className="mb-1.5 text-[11px] text-ink-3">LaTeX</div>
              <textarea
                value={latex}
                onChange={(e) => onLatexChange(e.currentTarget.value)}
                spellCheck={false}
                rows={Math.min(8, latex.split("\n").length + 1)}
                className="w-full resize-y rounded-lg border border-line-2 bg-surface-2 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink outline-none focus:border-accent/50"
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-ink-3">
                {copied ? (
                  <span className="text-ok">Copié dans le presse-papier</span>
                ) : fellBackFrom ? (
                  <span className="text-amber-400/90">
                    {fellBackFrom} indisponible — répondu par {provider}
                    {seconds !== null && ` · ${seconds.toFixed(1)}s`}
                  </span>
                ) : (
                  <>
                    via {provider}
                    {seconds !== null && ` · ${seconds.toFixed(1)}s`}
                  </>
                )}
              </span>
              <button
                type="button"
                onClick={() => void copy()}
                className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink hover:brightness-110"
              >
                Copier le LaTeX
                <span className="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[10px]">⌘C</span>
              </button>
            </div>

            {onEntryTags && (
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-[11px] text-ink-3">Tags</span>
                <TagEditor tags={entryTags ?? []} onChange={onEntryTags} compact />
              </div>
            )}

            {/* Optional accuracy check: a second LLM pass comparing the render to
                the source image. Off the critical path — user triggers it. */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void verify()}
                disabled={verifying}
                className="rounded-md border border-line-2 px-3 py-1.5 text-[12px] text-ink-2 hover:text-ink disabled:opacity-50"
              >
                {verifying ? "Vérification…" : "Vérifier la fidélité"}
              </button>
              {verdict && (
                <span
                  className={`text-[11px] ${
                    verdict.level === "match"
                      ? "text-ok"
                      : verdict.level === "mismatch"
                        ? "text-red-400"
                        : "text-amber-400/90"
                  }`}
                >
                  {verdict.level === "match"
                    ? "✓ semble fidèle"
                    : verdict.level === "minor"
                      ? `~ à vérifier : ${verdict.note}`
                      : verdict.level === "mismatch"
                        ? `✗ ${verdict.note}`
                        : verdict.note}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <HintBar
        hints={[
          ...(latex
            ? [
                { keys: ["⌘", "C"], label: "Copier" },
                { keys: ["⏎"], label: "Relancer" },
              ]
            : [{ keys: ["⏎"], label: "Transcrire" }]),
          { keys: ["⌘", "V"], label: "Nouveau" },
          ...(canUndo ? [{ keys: ["⌘", "Z"], label: "Annuler" }] : []),
          { keys: ["⌘", ","], label: "Réglages", right: true },
        ]}
      />
    </div>
  );
}
