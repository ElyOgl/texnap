import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { CapturedImage } from "../lib/image";
import { renderBlock, splitBlocks } from "../lib/latex";
import { HintBar } from "./ui";
import "katex/dist/katex.min.css";

type Props = {
  image: CapturedImage;
  onClear: () => void;
};

type Transcription = {
  latex: string;
  providerLabel: string;
};

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "TEXTAREA" || tag === "INPUT" || el.isContentEditable;
}

export function ImagePreview({ image, onClear }: Props) {
  const [latex, setLatex] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const blocks = useMemo(
    () => (latex ? splitBlocks(latex).map(renderBlock) : []),
    [latex],
  );
  const renderErrors = blocks.filter((b) => b.error !== null);

  const transcribe = async () => {
    setLoading(true);
    setError(null);
    setLatex(null);
    const started = performance.now();
    try {
      const result = await invoke<Transcription>("ocr_transcribe", {
        imageDataUrl: image.dataUrl,
      });
      setLatex(result.latex);
      setProvider(result.providerLabel);
      setSeconds((performance.now() - started) / 1000);
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

  // ⏎ transcribe (unless typing in a field), ⌘C copy (unless a field is
  // focused, so native copy still works while editing the LaTeX).
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

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3.5">
        {/* Source screenshot */}
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-ink-3">
            <span>Source</span>
            <button onClick={onClear} className="hover:text-ink-2">
              Clear
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

        {!latex && !error && (
          <button
            type="button"
            onClick={() => void transcribe()}
            disabled={loading}
            className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-60"
          >
            {loading ? "Transcribing…" : "Transcribe to LaTeX"}
            {!loading && (
              <span className="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[10.5px]">⏎</span>
            )}
          </button>
        )}

        {error && (
          <div className="rounded-lg border border-red-900 bg-red-950/60 px-3 py-2 text-[12px] text-red-300">
            {error}
            <button
              onClick={() => void transcribe()}
              className="mt-2 block text-red-200 underline hover:text-red-100"
            >
              Try again
            </button>
          </div>
        )}

        {latex && (
          <>
            {/* Rendered — white paper card, full width so the formula is readable */}
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[11px] text-ink-3">
                <span>Rendered</span>
                {renderErrors.length === 0 && (
                  <span className="text-ok">✓ renders</span>
                )}
              </div>
              <div className="overflow-x-auto rounded-lg bg-paper px-4 py-3 text-paper-ink">
                {blocks.map((block, i) => (
                  <div
                    key={i}
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: block.html }}
                  />
                ))}
              </div>
              {renderErrors.length > 0 && (
                <p className="mt-1.5 text-[11px] text-amber-400/90">
                  Preview incomplete — the LaTeX may still be correct (KaTeX can&rsquo;t
                  render part of it).
                </p>
              )}
            </div>

            {/* Editable LaTeX */}
            <div>
              <div className="mb-1.5 text-[11px] text-ink-3">LaTeX</div>
              <textarea
                ref={editorRef}
                value={latex}
                onChange={(e) => setLatex(e.currentTarget.value)}
                spellCheck={false}
                rows={Math.min(8, latex.split("\n").length + 1)}
                className="w-full resize-y rounded-lg border border-line-2 bg-surface-2 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink outline-none focus:border-accent/50"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-ink-3">
                {copied ? (
                  <span className="text-ok">Copied to clipboard</span>
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
                Copy LaTeX
                <span className="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[10px]">⌘C</span>
              </button>
            </div>
          </>
        )}
      </div>

      <HintBar
        hints={
          latex
            ? [
                { keys: ["⌘", "C"], label: "Copy" },
                { keys: ["⌘", "V"], label: "New" },
                { keys: ["⏎"], label: "Re-run" },
                { keys: ["⌘", ","], label: "Settings", right: true },
              ]
            : [
                { keys: ["⏎"], label: "Transcribe" },
                { keys: ["⌘", "V"], label: "New" },
                { keys: ["⌘", ","], label: "Settings", right: true },
              ]
        }
      />
    </div>
  );
}
