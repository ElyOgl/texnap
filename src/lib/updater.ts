import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { TKey } from "./i18n";

// Thin wrappers over the Tauri updater.

export type PendingUpdate = {
  version: string;
  notes: string;
  /** The raw Update handle, used by `runUpdate`. */
  handle: Update;
};

// A check distinguishes three outcomes so callers can tell "up to date" from a
// real failure (offline, endpoint 5xx, bad signature) — the launch path ignores
// everything but `update`, while Settings surfaces `error` instead of silently
// claiming "up to date".
export type UpdateCheck =
  | { kind: "update"; update: PendingUpdate }
  | { kind: "current" }
  | { kind: "error"; error: string };

export async function checkForUpdate(): Promise<UpdateCheck> {
  try {
    const update = await check();
    if (!update) return { kind: "current" };
    return {
      kind: "update",
      update: { version: update.version, notes: update.body ?? "", handle: update },
    };
  } catch (e) {
    // No updater in this context (dev), offline, or endpoint unreachable.
    return { kind: "error", error: String(e) };
  }
}

/** Shared label for the download-progress button, used by the banner and Settings. */
export function updateProgressLabel(t: (k: TKey, p?: Record<string, string | number>) => string, pct: number | null): string {
  if (pct === 100) return t("update.restarting");
  if (pct === null) return t("update.downloadingIndet");
  return t("update.downloading", { pct });
}

/**
 * Download + install the update, reporting download progress as a 0–100
 * percentage (null total → indeterminate), then relaunch into the new version.
 * Throws on failure so the caller can show an error.
 */
export async function runUpdate(
  update: PendingUpdate,
  onProgress?: (pct: number | null) => void,
): Promise<void> {
  let downloaded = 0;
  let total = 0;
  await update.handle.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        onProgress?.(total ? 0 : null);
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.(total ? Math.min(100, Math.round((downloaded / total) * 100)) : null);
        break;
      case "Finished":
        onProgress?.(100);
        break;
    }
  });
  await relaunch();
}
