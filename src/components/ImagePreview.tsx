import type { CapturedImage } from "../lib/image";

type Props = {
  image: CapturedImage;
  onClear: () => void;
};

// OCR isn't wired up yet — P2 replaces the stub panel with the real call and
// a KaTeX-rendered result (P3).
export function ImagePreview({ image, onClear }: Props) {
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
      <div className="rounded-md bg-neutral-800 px-3 py-2 text-sm text-neutral-400">
        OCR not implemented yet — coming in P2.
      </div>
    </div>
  );
}
