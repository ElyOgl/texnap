import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import {
  type CapturedImage,
  blobToDataUrl,
  looksLikeImagePath,
  validateBlob,
} from "./image";

// Capture works in any view (idle or showing a result), so this lives above
// the views rather than inside the idle-only drop zone — pasting a new
// screenshot while a result is on screen just starts a new capture.
//
// Two paths, because Tauri intercepts OS-level file drops before the DOM sees
// them: clipboard paste comes through the browser `paste` event (already image
// bytes), while drag-and-drop and the native file picker come through Tauri
// and hand over a file path that Rust reads. `enabled` is false during the
// API-key screen so capture can't fire while typing a key.
export function useImageCapture(
  onCapture: (image: CapturedImage) => void,
  onError: (message: string) => void,
  enabled: boolean,
) {
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
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    if (typeof selected === "string") {
      await captureFromPath(selected);
    }
  }, [captureFromPath]);

  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled, onCapture, onError]);

  useEffect(() => {
    if (!enabled) {
      setIsDragging(false);
      return;
    }
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
  }, [enabled, captureFromPath]);

  return { isDragging, pickFile };
}
