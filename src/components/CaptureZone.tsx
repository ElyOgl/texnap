import { Kbd } from "./ui";
import { useI18n } from "../lib/i18n";

type Props = {
  isDragging: boolean;
  onPick: () => void;
  providerLabel: string | null;
  /** Click the OCR badge to jump straight to the provider settings. */
  onOpenSettings: () => void;
};

// Idle view. Capture itself (paste / drop / pick) lives in useImageCapture at
// the App level so it works in any view — this is just the drop-zone surface.
export function CaptureZone({ isDragging, onPick, providerLabel, onOpenSettings }: Props) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3">
      <div className="pt-1 text-center">
        <div className="text-[15px] font-semibold text-ink">texnap</div>
        <div className="mt-0.5 text-[11px] text-ink-3">{t("captureZone.subtitle")}</div>
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
        <div className="text-[13px] font-medium text-ink">{t("captureZone.drop")}</div>
        <div className="text-[12px] text-ink-3">
          {t("captureZone.pastePre")} <Kbd>⌘</Kbd>
          <Kbd>V</Kbd> {t("captureZone.pastePost")}
        </div>
      </button>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onOpenSettings}
          title={t("captureZone.changeEngine")}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-3 px-2 py-1 text-[11px] text-ink-2 transition-colors hover:border-line-2 hover:text-ink"
        >
          OCR · {providerLabel ?? "…"}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-3">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
        <span className="text-[11px] text-ink-3">{t("captureZone.ready")}</span>
      </div>
    </div>
  );
}
