import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import {
  type CapturedImage,
  blobToDataUrl,
  looksLikeImagePath,
  validateBlob,
} from "../lib/image";

type Props = {
  onCapture: (image: CapturedImage) => void;
  onError: (message: string) => void;
};

// Tauri's webview intercepts native OS file drops (dragDropEnabled: true in
// tauri.conf.json) before they reach the DOM, so plain HTML5 `drop` events
// never fire with file data here — this listens on the Tauri event instead.
// Clipboard paste is unaffected and uses the normal browser `paste` event,
// since a copied screenshot is image bytes on the clipboard, not a file path.
export function CaptureZone({ onCapture, onError }: Props) {
  const [isDragging, setIsDragging] = useState(false);

  const captureFromPath = useCallback(
    async (path: string) => {
      if (!looksLikeImagePath(path)) {
        onError(`"${path.split("/").pop()}" doesn't look like an image.`);
        return;
      }
      try {
        const result = await invoke<{ data_url: string; file_name: string }>(
          "read_image_as_base64",
          { path },
        );
        onCapture({ dataUrl: result.data_url, fileName: result.file_name });
      } catch (err) {
        onError(String(err));
      }
    },
    [onCapture, onError],
  );

  const pickFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
      ],
    });
    if (typeof selected === "string") {
      await captureFromPath(selected);
    }
  }, [captureFromPath]);

  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (!blob) continue;
          const error = validateBlob(blob);
          if (error) {
            onError(error);
            return;
          }
          const dataUrl = await blobToDataUrl(blob);
          onCapture({ dataUrl, fileName: `pasted-${Date.now()}.png` });
          return;
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [onCapture, onError]);

  useEffect(() => {
    const unlistenPromise = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        setIsDragging(false);
        const [firstPath] = event.payload.paths;
        if (firstPath) void captureFromPath(firstPath);
      } else if (event.payload.type === "enter" || event.payload.type === "over") {
        setIsDragging(true);
      } else {
        setIsDragging(false);
      }
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [captureFromPath]);

  return (
    <div
      className={`flex w-full max-w-lg flex-col items-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
        isDragging
          ? "border-blue-400 bg-blue-950/30"
          : "border-neutral-700 bg-neutral-900/40"
      }`}
    >
      <p className="text-neutral-300">
        Paste (⌘V) or drag a screenshot here
      </p>
      <p className="text-sm text-neutral-500">PNG, JPEG, WEBP, or GIF — up to 10 MB</p>
      <button
        type="button"
        onClick={() => void pickFile()}
        className="rounded-md bg-neutral-800 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-700"
      >
        Choose a file…
      </button>
    </div>
  );
}
