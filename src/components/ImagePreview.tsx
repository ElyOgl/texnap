import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { CapturedImage } from "../lib/image";
import { renderBlock, splitBlocks } from "../lib/latex";
import "katex/dist/katex.min.css";

type Props = {
  image: CapturedImage;
  onClear: () => void;
};

type Transcription = {
  latex: string;
  providerLabel: string;
};

// Layout note: source image and rendered preview are stacked, not side by
// side. Formula captures are wide, short strips — stacking gives each the
// full window width, which makes the visual diff far easier than halving both.
export function ImagePreview({ image, onClear }: Props) {
  const [latex, setLatex] = useState<string | null>(null);
  const [providerLabel, setProviderLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // KaTeX is synchronous and sub-millisecond for formula-sized input, so this
  // re-renders straight off the edited text — no debounce needed.
  const blocks = useMemo(
    () => (latex ? splitBlocks(latex).map(renderBlock) : []),
    [latex],
  );
  const renderErrors = blocks.filter((b) => b.error !== null);

  const transcribe = async () => {
    setLoading(true);
    setError(null);
    setLatex(null);
    try {
      const result = await invoke<Transcription>("ocr_transcribe", {
        imageDataUrl: image.dataUrl,
      });
      setLatex(result.latex);
      setProviderLabel(result.providerLabel);
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

  return (
    <div className="flex w-full max-w-2xl flex-col gap-3">
      <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
        <img
          src={image.dataUrl}
          alt={image.fileName}
          className="max-h-64 w-full object-contain"
        />
      </div>
      <div className="flex items-center justify-between text-sm text-neutral-400">
        <span className="truncate">{image.fileName}</span>
        <button
          type="button"
          onClick={onClear}
          className="text-neutral-500 hover:text-neutral-300"
        >
          Clear
        </button>
      </div>

      <button
        type="button"
        onClick={() => void transcribe()}
        disabled={loading}
        className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
      >
        {loading ? "Transcribing…" : latex ? "Transcribe again" : "Transcribe to LaTeX"}
      </button>

      {error && (
        <div className="rounded-md border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {latex !== null && (
        <>
          {/* White background mirrors how the source screenshot looks, so the
              rendered formula and the original are compared like for like. */}
          <div className="overflow-x-auto rounded-xl bg-white px-4 py-3 text-neutral-900">
            {blocks.map((block, i) => (
              <div
                key={i}
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: block.html }}
              />
            ))}
          </div>

          {renderErrors.length > 0 && (
            <div className="rounded-md border border-amber-900 bg-amber-950/50 px-3 py-2 text-sm text-amber-300">
              <p className="font-medium">Preview incomplete — the LaTeX may still be correct.</p>
              <p className="mt-1 text-amber-400/80">
                KaTeX supports a subset of LaTeX and couldn&rsquo;t render part of
                this. Check it in your own LaTeX editor before assuming the
                transcription is wrong. ({renderErrors[0].error})
              </p>
            </div>
          )}

          <textarea
            value={latex}
            onChange={(e) => setLatex(e.currentTarget.value)}
            spellCheck={false}
            rows={Math.min(12, latex.split("\n").length + 1)}
            className="w-full resize-y rounded-md bg-neutral-800 px-3 py-2 font-mono text-sm text-neutral-200 outline-none focus:ring-1 focus:ring-neutral-600"
          />

          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-500">
              {providerLabel && `via ${providerLabel}`}
            </span>
            <button
              type="button"
              onClick={() => void copy()}
              className="rounded-md bg-neutral-800 px-3 py-1.5 text-neutral-200 hover:bg-neutral-700"
            >
              {copied ? "Copied" : "Copy LaTeX"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
