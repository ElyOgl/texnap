// Shared with the Rust side's limits in src-tauri/src/capture.rs — keep in sync.
export const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type CapturedImage = {
  /** Stable per-capture id — identifies a capture across the undo history. */
  id: string;
  dataUrl: string;
  fileName: string;
};

export function isAllowedImage(blob: Blob): boolean {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(blob.type);
}

// A structured validation failure the UI layer localizes (so the message is in
// the user's language rather than hardcoded English here).
export type BlobError =
  | { code: "unsupportedType"; type: string }
  | { code: "tooLarge"; mb: string };

export function validateBlob(blob: Blob): BlobError | null {
  if (!isAllowedImage(blob)) {
    return { code: "unsupportedType", type: blob.type || "unknown" };
  }
  if (blob.size > MAX_BYTES) {
    return { code: "tooLarge", mb: (blob.size / 1_048_576).toFixed(1) };
  }
  return null;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image"));
    reader.readAsDataURL(blob);
  });
}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"];

export function looksLikeImagePath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.includes(ext);
}
