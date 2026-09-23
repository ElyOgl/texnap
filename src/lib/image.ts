// Shared with the Rust side's limits in src-tauri/src/capture.rs — keep in sync.
export const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type CapturedImage = {
  dataUrl: string;
  fileName: string;
};

export function isAllowedImage(blob: Blob): boolean {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(blob.type);
}

export function validateBlob(blob: Blob): string | null {
  if (!isAllowedImage(blob)) {
    return `Unsupported file type "${blob.type || "unknown"}" — expected PNG, JPEG, WEBP, or GIF.`;
  }
  if (blob.size > MAX_BYTES) {
    return `Image is ${(blob.size / 1_048_576).toFixed(1)} MB, which is over the 10 MB limit.`;
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
