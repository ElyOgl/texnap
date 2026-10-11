import { Kbd } from "./ui";
import { useI18n } from "../lib/i18n";

type Props = {
  isDragging: boolean;
  onPick: () => void;
  providerLabel: string | null;
  /** Layout-aware capture shortcut label (⌃⌘M / ⌃⌘,), shown on the snip chip. */
  captureShortcut: string;
  /** Click the OCR badge to jump straight to the provider settings. */
  onOpenSettings: () => void;
};

// Idle view. Capture itself (paste / drop / pick) lives in useImageCapture at
// the App level so it works in any view — this is just the drop-zone surface.
// The coral corner-bracket frame echoes the app icon's "capture" motif.
export function CaptureZone({ isDragging, onPick, providerLabel, captureShortcut, onOpenSettings }: Props) {
  const { t } = useI18n();
  const bracket = "pointer-events-none absolute h-5 w-5 border-accent transition-opacity";
  return (
    <div className="flex flex-col gap-3">
      <div className="pt-1 text-center">
        <div className="text-[15px] font-semibold text-ink">texnap</div>
        <div className="mt-0.5 text-[11px] text-ink-3">{t("captureZone.subtitle")}</div>
      </div>

      <button
        type="button"
        onClick={onPick}
        className={`group relative flex h-36 flex-col items-center justify-center gap-3 overflow-hidden rounded-xl px-4 text-center transition-colors duration-150 ${
          isDragging ? "bg-accent/10" : "bg-surface-2 hover:bg-surface-3"
        }`}
      >
        {/* Capture frame: four coral corner brackets (brighten on drag/hover). */}
        <span className={`${bracket} left-2.5 top-2.5 rounded-tl-md border-l-2 border-t-2 ${isDragging ? "opacity-100" : "opacity-70 group-hover:opacity-100"}`} />
        <span className={`${bracket} right-2.5 top-2.5 rounded-tr-md border-r-2 border-t-2 ${isDragging ? "opacity-100" : "opacity-70 group-hover:opacity-100"}`} />
        <span className={`${bracket} bottom-2.5 left-2.5 rounded-bl-md border-b-2 border-l-2 ${isDragging ? "opacity-100" : "opacity-70 group-hover:opacity-100"}`} />
        <span className={`${bracket} bottom-2.5 right-2.5 rounded-br-md border-b-2 border-r-2 ${isDragging ? "opacity-100" : "opacity-70 group-hover:opacity-100"}`} />

        <svg
          width="30"
          height="30"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-ink-3 transition-transform duration-150 group-hover:-translate-y-0.5"
        >
          <path d="M12 16V4" />
          <path d="m7 9 5-5 5 5" />
          <path d="M5 20h14" />
        </svg>
        <div className="text-[13px] font-medium text-ink">{t("captureZone.drop")}</div>
      </button>

      {/* Three ways in: paste / drag / global snip. */}
      <div className="grid grid-cols-3 gap-1.5">
        <div className="flex flex-col items-center gap-1 rounded-lg bg-surface-2 py-2 text-[11px] text-ink-2">
          <span className="flex items-center gap-0.5">
            <Kbd>⌘</Kbd>
            <Kbd>V</Kbd>
          </span>
          {t("captureZone.paste")}
        </div>
        <div className="flex flex-col items-center justify-center gap-1 rounded-lg bg-surface-2 py-2 text-[11px] text-ink-2">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-ink-3">
            <path d="M3 3h7v7H3z" /><path d="m14 14 7 7" /><path d="M14 21h7v-7" />
          </svg>
          {t("captureZone.drag")}
        </div>
        <div className="flex flex-col items-center gap-1 rounded-lg bg-surface-2 py-2 text-[11px] text-ink-2">
          <span className="font-mono text-[10.5px] text-ink">{captureShortcut || "⌃⌘M"}</span>
          {t("captureZone.snip")}
        </div>
      </div>

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
        <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-3">
          <span className="h-1.5 w-1.5 rounded-full bg-ok" />
          {t("captureZone.ready")}
        </span>
      </div>
    </div>
  );
}
