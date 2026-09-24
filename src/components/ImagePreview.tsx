import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CapturedImage } from "../lib/image";

type Props = {
  image: CapturedImage;
  onClear: () => void;
};

// Raw LaTeX text only for now — KaTeX side-by-side rendering, copy button,
// and inline editing are P3. This is just proving the OCR call works.
export function ImagePreview({ image, onClear }: Props) {
  const [latex, setLatex] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const transcribe = async () => {
    setLoading(true);
    setError(null);
    setLatex(null);
    try {
      const result = await invoke<string>("ocr_transcribe", {
        imageDataUrl: image.dataUrl,
      });
      setLatex(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex w-full max-w-lg flex-col gap-3">
      <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
        <img
          src={image.dataUrl}
          alt={image.fileName}
          className="max-h-80 w-full object-contain"
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
        {loading ? "Transcribing…" : "Transcribe to LaTeX"}
      </button>

      {error && (
        <div className="rounded-md border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {latex && (
        <pre className="whitespace-pre-wrap break-words rounded-md bg-neutral-800 px-3 py-2 font-mono text-sm text-neutral-200">
          {latex}
        </pre>
      )}
    </div>
  );
}
