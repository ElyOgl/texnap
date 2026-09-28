import { Kbd } from "./ui";

type Props = {
  isDragging: boolean;
  onPick: () => void;
  providerLabel: string | null;
};

// Idle view. Capture itself (paste / drop / pick) lives in useImageCapture at
// the App level so it works in any view — this is just the drop-zone surface.
export function CaptureZone({ isDragging, onPick, providerLabel }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="pt-1 text-center">
        <div className="text-[15px] font-semibold text-ink">texnap</div>
        <div className="mt-0.5 text-[11px] text-ink-3">screenshot → LaTeX</div>
      </div>
      <button
        type="button"
        onClick={onPick}
        className={`flex h-36 flex-col items-center justify-center gap-3 rounded-lg border-[1.5px] border-dashed px-4 text-center transition-colors ${
          isDragging
            ? "border-accent bg-accent/10"
            : "border-line-2 bg-surface-2 hover:border-ink-3"
        }`}
      >
        <svg
          width="30"
          height="30"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-ink-3"
        >
          <path d="M12 16V4" />
          <path d="m7 9 5-5 5 5" />
          <path d="M5 20h14" />
        </svg>
        <div className="text-[13px] font-medium text-ink">Drop a formula screenshot</div>
        <div className="text-[12px] text-ink-3">
          or press <Kbd>⌘</Kbd>
          <Kbd>V</Kbd> to paste from clipboard
        </div>
      </button>

      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-3 px-2 py-1 text-[11px] text-ink-2">
          OCR · {providerLabel ?? "…"}
        </span>
        <span className="text-[11px] text-ink-3">Ready</span>
      </div>
    </div>
  );
}
