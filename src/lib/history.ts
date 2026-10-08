export type HistoryEntry = {
  id: string;
  createdAt: number;
  latex: string;
  provider: string;
  thumbnail: string;
  /** Library tags (F1). Absent on entries saved before F1 → treat as []. */
  tags?: string[];
  /** Pinned entries sort first and survive the cap (F1). */
  pinned?: boolean;
};

// Downscale a captured image to a small data URL for the history list, so
// history.json stays small even after many captures.
export function makeThumbnail(dataUrl: string, maxWidth = 280): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

import type { Lang } from "./i18n/types";

// Locale-aware relative time. Uses the platform Intl.RelativeTimeFormat for
// minutes/hours/days (correct for any language); the sub-minute case has its own
// short phrase per language.
const JUST_NOW: Record<Lang, string> = {
  fr: "à l'instant",
  en: "just now",
  it: "proprio ora",
  de: "gerade eben",
  es: "ahora mismo",
};

export function relativeTime(ms: number, lang: Lang = "fr"): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return JUST_NOW[lang];
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const m = Math.round(s / 60);
  if (m < 60) return rtf.format(-m, "minute");
  const h = Math.round(m / 60);
  if (h < 24) return rtf.format(-h, "hour");
  const d = Math.round(h / 24);
  return rtf.format(-d, "day");
}
