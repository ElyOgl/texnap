import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { renderLatex } from "../lib/latex";
import { isEditableTarget } from "../lib/dom";
import type { Session } from "../lib/session";
import { TagEditor } from "./Tags";
import { HintBar } from "./ui";
import { WanderingEyes } from "./WanderingEyes";
import { useI18n, type TKey } from "../lib/i18n";
import type { ConfigStatus, ProviderInfo } from "../lib/providers";
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

type NameInfo = {
  /** true = an established standard name; false = a suggested mnemonic name. */
  known: boolean;
  name: string;
};

type Transcription = {
  latex: string;
  providerLabel: string;
  /** Stable id ("local", "gemini", …) — used to show the feedback widget only
      for local-model results. */
  providerId: string;
  fellBackFrom: string | null;
  /** Cloud-only: produced in the same request as the LaTeX (no extra call). */
  name: NameInfo | null;
};

type ProviderTarget = { id: string; label: string };

type Verdict = {
  level: "match" | "minor" | "mismatch" | "unknown";
  note: string;
  providerLabel: string;
};

type Explanation = {
  text: string;
  providerLabel: string;
};

// Classify a raw Rust error into a translation key, or null to show it verbatim
// (unmatched backend errors — often English, embedding paths/HTTP bodies).
function classifyError(raw: string): TKey | null {
  if (raw.includes(" 429") || /quota|rate.?limit/i.test(raw)) return "error.quota";
  if (/^Network error/.test(raw) || /network/i.test(raw)) return "error.network";
  if (/No API key/i.test(raw)) return "error.noKey";
  if (/401|403|invalid.*key|api.?key/i.test(raw)) return "error.rejectedKey";
  return null;
}

export function ImagePreview({ session, canUndo, autoRun, onResult, onLatexChange, onClear, entryTags, onEntryTags }: Props) {
  const { t, lang } = useI18n();
  const { image, latex, provider, seconds } = session;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fellBackFrom, setFellBackFrom] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  // Name (folded into the transcription result) + on-demand plain-language explanation.
  const [name, setName] = useState<NameInfo | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  // Whether "plain language" is offered at all for the active provider
  // (cloud always; local only if this build ships the on-device LLM) and,
  // if so, whether it can run now (a key, or the local model downloaded).
  const [explainSupported, setExplainSupported] = useState(true);
  const [explainReady, setExplainReady] = useState(false);
  // Local-model feedback (F8): rate the on-device result, optionally say what's
  // wrong and regenerate with another model; everything is logged as a dataset.
  const [providerId, setProviderId] = useState<string | null>(null);
  const [rating, setRating] = useState<"bad" | "mid" | "correct" | null>(null);
  const [fbNote, setFbNote] = useState("");
  const [fbOriginalLatex, setFbOriginalLatex] = useState("");
  const [fbCorrectedVia, setFbCorrectedVia] = useState<string | null>(null);
  const [fbCorrectedId, setFbCorrectedId] = useState<string | null>(null);
  const [fbDone, setFbDone] = useState(false);
  const [fbError, setFbError] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState<string | null>(null);
  const [regenTargets, setRegenTargets] = useState<ProviderTarget[]>([]);
  // Guards async name/explain results against a newer capture arriving meanwhile.
  const imageIdRef = useRef(image.id);

  // A new capture (or an undo/redo) is a different image — drop any transient
  // state tied to the previous one.
  useEffect(() => {
    imageIdRef.current = image.id;
    setError(null);
    setCopied(false);
    setLoading(false);
    setFellBackFrom(null);
    setVerifying(false);
    setVerdict(null);
    setName(null);
    setExplanation(null);
    setExplaining(false);
    setExplainError(null);
    setProviderId(null);
    setRating(null);
    setFbNote("");
    setFbCorrectedVia(null);
    setFbCorrectedId(null);
    setFbDone(false);
    setFbError(null);
    setRegenBusy(null);
  }, [image.id]);

  // Editing the LaTeX invalidates a prior verdict.
  useEffect(() => {
    setVerdict(null);
  }, [latex]);

  // Is "plain language" available? Explanation is a *cloud reasoning* feature:
  // it ships whenever any cloud key (non-SimpleTex, non-local) is configured —
  // independent of which engine does the OCR, so it still works while Local is
  // the active OCR provider. Only when no cloud key exists does it fall to the
  // on-device model, which is deferred (local_llm off) and so stays hidden.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await invoke<ConfigStatus>("get_config_status");
        const hasCloudReasoning = status.savedProviders.some(
          (p) => p !== "simpletex" && p !== "local",
        );
        let supported = true;
        let ready = false;
        if (hasCloudReasoning) {
          ready = true;
        } else if (status.activeProvider === "local") {
          // No cloud key: only the (deferred) on-device model could explain.
          supported = await invoke<boolean>("local_llm_available");
          ready = supported && (await invoke<string>("local_llm_status")) === "ready";
        }
        if (!cancelled) {
          setExplainSupported(supported);
          setExplainReady(ready);
        }
      } catch {
        if (!cancelled) {
          setExplainSupported(false);
          setExplainReady(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [image.id]);

  const rendered = useMemo(() => (latex ? renderLatex(latex) : null), [latex]);

  const transcribe = async () => {
    setLoading(true);
    setError(null);
    const startedForImage = image.id;
    const started = performance.now();
    try {
      const result = await invoke<Transcription>("ocr_transcribe", {
        imageDataUrl: image.dataUrl,
        lang,
      });
      setFellBackFrom(result.fellBackFrom);
      setProviderId(result.providerId);
      // The name comes folded into the same response (no extra API call).
      if (imageIdRef.current === startedForImage) {
        setName(result.name && result.name.name.trim() ? result.name : null);
      }
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

  // When a local result is on screen, load the saved cloud providers to offer as
  // "regenerate with" targets in the feedback widget.
  useEffect(() => {
    if (providerId !== "local") return;
    let cancelled = false;
    void (async () => {
      try {
        const [status, list] = await Promise.all([
          invoke<ConfigStatus>("get_config_status"),
          invoke<ProviderInfo[]>("list_providers"),
        ]);
        if (cancelled) return;
        setRegenTargets(
          status.savedProviders
            .filter((id) => id !== "local")
            .map((id) => ({ id, label: list.find((p) => p.id === id)?.label ?? id })),
        );
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [providerId]);

  const recordFeedback = async (
    r: "bad" | "mid" | "correct",
    opts?: { note?: string | null; correctedLatex?: string | null; correctedProvider?: string | null },
  ) => {
    try {
      await invoke("record_feedback", {
        feedback: {
          id: crypto.randomUUID(),
          imageDataUrl: image.dataUrl,
          modelProvider: "local",
          modelLatex: (r === "correct" ? latex : fbOriginalLatex || latex) ?? "",
          rating: r,
          comment: opts?.note ?? null,
          correctedLatex: opts?.correctedLatex ?? null,
          correctedProvider: opts?.correctedProvider ?? null,
          lang,
        },
      });
      setFbError(null);
      setFbDone(true);
    } catch (e) {
      setFbError(t("feedback.error", { error: String(e) }));
    }
  };

  const rate = (r: "bad" | "mid" | "correct") => {
    if (r === "correct") {
      setRating("correct");
      void recordFeedback("correct");
      return;
    }
    setRating(r);
    setFbOriginalLatex(latex ?? ""); // snapshot the model's output before any regenerate
  };

  // Regenerate the current capture with a specific model (local retry or a saved
  // cloud provider). The result replaces the editable LaTeX; providerId stays
  // "local" so the feedback widget remains open to submit.
  const regenerate = async (pid: string) => {
    setRegenBusy(pid);
    setFbError(null);
    try {
      const result = await invoke<Transcription>("ocr_transcribe_with", {
        provider: pid,
        imageDataUrl: image.dataUrl,
        lang,
      });
      onLatexChange(result.latex);
      setFbCorrectedVia(result.providerLabel);
      setFbCorrectedId(result.providerId);
      if (result.name && result.name.name.trim()) setName(result.name);
    } catch (e) {
      setFbError(String(e));
    } finally {
      setRegenBusy(null);
    }
  };

  const submitFeedback = () =>
    void recordFeedback(rating === "mid" ? "mid" : "bad", {
      note: fbNote.trim() || null,
      correctedLatex: fbCorrectedId ? latex : null,
      correctedProvider: fbCorrectedId,
    });

  // On-demand: reformulate the statement in plain language (selected UI language).
  const explain = async () => {
    if (!latex) return;
    setExplaining(true);
    setExplanation(null);
    setExplainError(null);
    try {
      const r = await invoke<Explanation>("ocr_explain", {
        imageDataUrl: image.dataUrl,
        latex,
        name: name?.name ?? null,
        lang,
      });
      setExplanation(r.text);
    } catch (err) {
      setExplainError(String(err));
    } finally {
      setExplaining(false);
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
            <span>{t("preview.source")}</span>
            <button onClick={onClear} className="hover:text-ink-2">
              {t("preview.clear")}
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
          <div className="flex flex-col gap-3">
            <div className="flex justify-center py-4">
              <WanderingEyes label={t("preview.transcribing")} />
            </div>
            {/* Shimmer placeholders so the result doesn't pop in abruptly. */}
            <div className="skeleton h-16 rounded-lg" />
            <div className="skeleton h-20 rounded-lg" />
          </div>
        )}

        {!loading && !latex && !error && (
          <button
            type="button"
            onClick={() => void transcribe()}
            className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-ink hover:brightness-110"
          >
            {t("preview.transcribe")}
            <span className="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[10.5px]">⏎</span>
          </button>
        )}

        {!loading && error && (
          <div className="rounded-lg border border-red-900 bg-red-950/60 px-3 py-2 text-[12px] text-red-300">
            {(() => {
              const key = classifyError(error);
              return key ? t(key) : error;
            })()}
            <button
              onClick={() => void transcribe()}
              className="mt-2 block text-red-200 underline hover:text-red-100"
            >
              {t("preview.retry")}
            </button>
          </div>
        )}

        {!loading && latex && (
          <div className="result-in flex flex-col gap-3">
            {name && name.name && (
              <div className="flex items-center gap-2.5 rounded-lg border border-line bg-surface-2 px-3 py-2">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`shrink-0 ${name.known ? "text-accent" : "text-ink-3"}`}
                >
                  {name.known ? (
                    <>
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    </>
                  ) : (
                    <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  )}
                </svg>
                <span className="flex min-w-0 flex-col">
                  {!name.known && (
                    <span className="text-[9.5px] uppercase tracking-wide text-ink-3">{t("name.suggested")}</span>
                  )}
                  <span className="truncate text-[12.5px] font-medium text-ink">{name.name}</span>
                </span>
              </div>
            )}

            <div>
              <div className="mb-1.5 flex items-center justify-between text-[11px] text-ink-3">
                <span>{t("preview.render")}</span>
                {rendered && !rendered.hadError && <span className="text-ok">{t("preview.renderOk")}</span>}
              </div>
              <div
                className="tex-render overflow-x-auto rounded-lg bg-paper px-4 py-3 text-paper-ink"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: rendered?.html ?? "" }}
              />
              {rendered?.hadError && (
                <p className="mt-1.5 text-[11px] text-amber-400/90">{t("preview.partial")}</p>
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

            {/* Action toolbar: Copy is the single primary; Check + Plain-language
                are secondary. Rerun stays on ⏎ (see the hint bar). */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => void copy()}
                className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink transition hover:brightness-110 active:scale-[0.98]"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                {t("preview.copy")}
                <span className="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[10px]">⌘C</span>
              </button>
              <button
                type="button"
                onClick={() => void verify()}
                disabled={verifying}
                className="flex items-center gap-1.5 rounded-md border border-line-2 px-3 py-1.5 text-[12px] text-ink-2 transition hover:text-ink active:scale-[0.98] disabled:opacity-50"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m1.5 12 4 4L10 9" />
                  <path d="m13 12 4 4 5.5-8" />
                </svg>
                {verifying ? t("preview.verifying") : t("preview.verify")}
              </button>
              {explainSupported && (
                <button
                  type="button"
                  onClick={() => void explain()}
                  disabled={explaining || !explainReady}
                  title={explainReady ? t("explain.title") : t("explain.unavailable")}
                  className="ml-auto flex items-center gap-1.5 rounded-md border border-line-2 px-3 py-1.5 text-[12px] text-ink-2 transition hover:text-ink active:scale-[0.98] disabled:opacity-50"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  {explaining ? t("explain.loading") : t("explain.button")}
                </button>
              )}
            </div>

            {/* Provenance + verdict — quiet, below the toolbar. */}
            <div className="flex flex-col gap-1 text-[11px]">
              <span className="text-ink-3">
                {copied ? (
                  <span className="text-ok">{t("preview.copied")}</span>
                ) : fellBackFrom ? (
                  <span className="text-amber-400/90">
                    {t("preview.fellBack", { from: fellBackFrom, provider: provider ?? "" })}
                    {seconds !== null && ` · ${seconds.toFixed(1)}s`}
                  </span>
                ) : (
                  <>
                    {t("preview.via", { provider: provider ?? "" })}
                    {seconds !== null && ` · ${seconds.toFixed(1)}s`}
                  </>
                )}
              </span>
              {verdict && (
                <span
                  className={
                    verdict.level === "match"
                      ? "text-ok"
                      : verdict.level === "mismatch"
                        ? "text-red-400"
                        : "text-amber-400/90"
                  }
                >
                  {verdict.level === "match"
                    ? t("preview.verdictMatch")
                    : verdict.level === "minor"
                      ? t("preview.verdictMinor", { note: verdict.note })
                      : verdict.level === "mismatch"
                        ? t("preview.verdictMismatch", { note: verdict.note })
                        : verdict.note}
                </span>
              )}
            </div>

            {onEntryTags && (
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-[11px] text-ink-3">{t("preview.tags")}</span>
                <TagEditor tags={entryTags ?? []} onChange={onEntryTags} compact />
              </div>
            )}

            {(explanation || explainError) && (
              <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[12.5px] leading-relaxed">
                {explainError ? (
                  <span className="text-red-400">{explainError}</span>
                ) : (
                  // Render through the same text-mode LaTeX→HTML converter as the
                  // preview, so inline $…$ symbols and \textbf emphasis show.
                  <div
                    className="text-ink-2 [&_.katex]:text-ink"
                    dangerouslySetInnerHTML={{ __html: renderLatex(explanation ?? "").html }}
                  />
                )}
              </div>
            )}

            {/* F8: local-model feedback — rate, optionally say what's wrong and
                regenerate with another model. Logged as a labeled dataset. */}
            {providerId === "local" && !fbDone && (
              <div className="rounded-xl border border-line bg-surface-2 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-ink-3">{t("feedback.prompt")}</span>
                  <div className="ml-auto flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => rate("bad")}
                      className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${rating === "bad" ? "bg-red-500/20 text-red-300" : "border border-line-2 text-ink-2 hover:text-ink"}`}
                    >
                      {t("feedback.bad")}
                    </button>
                    <button
                      type="button"
                      onClick={() => rate("mid")}
                      className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${rating === "mid" ? "bg-amber-500/20 text-amber-300" : "border border-line-2 text-ink-2 hover:text-ink"}`}
                    >
                      {t("feedback.mid")}
                    </button>
                    <button
                      type="button"
                      onClick={() => rate("correct")}
                      className="rounded-md border border-line-2 px-2.5 py-1 text-[11px] text-ink-2 transition-colors hover:border-ok/50 hover:text-ok"
                    >
                      {t("feedback.correct")}
                    </button>
                  </div>
                </div>

                {(rating === "bad" || rating === "mid") && (
                  <div className="mt-2.5 flex flex-col gap-2">
                    <textarea
                      value={fbNote}
                      onChange={(e) => setFbNote(e.currentTarget.value)}
                      placeholder={t("feedback.notePlaceholder")}
                      rows={2}
                      spellCheck={false}
                      className="w-full resize-y rounded-lg border border-line bg-surface-3 px-3 py-2 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-accent/50"
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10.5px] text-ink-3">{t("feedback.regenerateWith")}</span>
                      <button
                        type="button"
                        onClick={() => void regenerate("local")}
                        disabled={!!regenBusy}
                        className="rounded-full bg-surface-3 px-2.5 py-1 text-[11px] text-ink-2 transition-colors hover:text-ink disabled:opacity-50"
                      >
                        {regenBusy === "local" ? t("feedback.regenerating") : t("feedback.retryLocal")}
                      </button>
                      {regenTargets.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => void regenerate(p.id)}
                          disabled={!!regenBusy}
                          className="rounded-full bg-surface-3 px-2.5 py-1 text-[11px] text-ink-2 transition-colors hover:text-ink disabled:opacity-50"
                        >
                          {regenBusy === p.id ? t("feedback.regenerating") : p.label}
                        </button>
                      ))}
                    </div>
                    {fbCorrectedVia && (
                      <span className="text-[10.5px] text-ok">{t("feedback.correctedBy", { provider: fbCorrectedVia })}</span>
                    )}
                    <button
                      type="button"
                      onClick={submitFeedback}
                      className="self-start rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink transition hover:brightness-110 active:scale-[0.98]"
                    >
                      {t("feedback.submit")}
                    </button>
                  </div>
                )}
                {fbError && <p className="mt-1.5 text-[11px] text-red-400">{fbError}</p>}
              </div>
            )}
            {fbDone && (
              <div className="flex items-center gap-2 rounded-xl border border-ok/40 bg-surface-2 px-3 py-2 text-[11px] text-ok">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" />
                </svg>
                {t("feedback.thanks")}
              </div>
            )}
          </div>
        )}
      </div>

      <HintBar
        hints={[
          ...(latex
            ? [
                { keys: ["⌘", "C"], label: t("hint.copy") },
                { keys: ["⏎"], label: t("hint.rerun") },
              ]
            : [{ keys: ["⏎"], label: t("hint.transcribe") }]),
          { keys: ["⌘", "V"], label: t("hint.new") },
          ...(canUndo ? [{ keys: ["⌘", "Z"], label: t("hint.undo") }] : []),
          { keys: ["⌘", ","], label: t("hint.settings"), right: true },
        ]}
      />
    </div>
  );
}
