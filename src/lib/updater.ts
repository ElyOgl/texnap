import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// Thin wrappers over the Tauri updater. Everything is defensive: in a dev/non-
// Tauri context (or when the endpoint/signature isn't reachable) these resolve
// to "no update" instead of throwing, so `npm run dev` and first-run are never
// broken by the updater.

export type PendingUpdate = {
  version: string;
  notes: string;
  /** The raw Update handle, used by `runUpdate`. */
  handle: Update;
};

/** Returns a pending update, or null when up to date / unavailable. */
export async function checkForUpdate(): Promise<PendingUpdate | null> {
  try {
    const update = await check();
    if (!update) return null;
    return { version: update.version, notes: update.body ?? "", handle: update };
  } catch {
    // No updater in this context, offline, or endpoint unreachable — treat as
    // "nothing to do" rather than surfacing a scary error on launch.
    return null;
  }
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
