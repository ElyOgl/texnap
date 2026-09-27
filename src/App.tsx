import { useCallback, useEffect, useReducer, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ApiKeySetup } from "./components/ApiKeySetup";
import { CaptureZone } from "./components/CaptureZone";
import { ImagePreview } from "./components/ImagePreview";
import { HintBar } from "./components/ui";
import { useImageCapture } from "./lib/useImageCapture";
import { isEditableTarget } from "./lib/dom";
import { historyReducer, initialHistory } from "./lib/session";
import type { CapturedImage } from "./lib/image";
import type { ConfigStatus, ProviderInfo } from "./lib/providers";
import "./App.css";

function App() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [activeProviderLabel, setActiveProviderLabel] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, dispatch] = useReducer(historyReducer, initialHistory);
  const session = history.present;

  const refresh = useCallback(async () => {
    const [status, list] = await Promise.all([
      invoke<ConfigStatus>("get_config_status"),
      invoke<ProviderInfo[]>("list_providers"),
    ]);
    setConfigured(status.configured);
    setActiveProviderLabel(
      list.find((p) => p.id === status.activeProvider)?.label ?? null,
    );
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A new capture resets the result view; the previous session is kept on the
  // undo stack so ⌘Z brings it (and its LaTeX) back.
  const handleCapture = useCallback((img: CapturedImage) => {
    setError(null);
    dispatch({ type: "capture", image: img });
  }, []);
  const handleError = useCallback((msg: string) => setError(msg), []);

  // Region snips triggered by the global shortcut arrive as a data URL from
  // Rust — feed them into the same capture pipeline and leave the settings view.
  useEffect(() => {
    const unlisten = listen<string>("capture-region", (event) => {
      setShowSettings(false);
      handleCapture({
        id: crypto.randomUUID(),
        dataUrl: event.payload,
        fileName: `snip-${Date.now()}.png`,
      });
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [handleCapture]);

  const captureEnabled = configured === true && !showSettings;
  const { isDragging, pickFile } = useImageCapture(handleCapture, handleError, captureEnabled);

  // ⌘, settings, and ⌘Z / ⌘⇧Z session undo-redo — but not while a text field
  // is focused, where ⌘Z is the textarea's own undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "," && e.metaKey && configured) {
        e.preventDefault();
        setShowSettings(true);
        return;
      }
      if (e.metaKey && e.key.toLowerCase() === "z" && !showSettings && !isEditableTarget(e.target)) {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [configured, showSettings]);

  const settingsDone = () => {
    setShowSettings(false);
    void refresh();
  };

  return (
    <div className="flex h-full flex-col bg-surface text-ink">
      <header className="flex h-9 items-center justify-end gap-2.5 border-b border-line bg-titlebar px-3">
        <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
          <span className="h-1.5 w-1.5 rounded-full bg-ok shadow-[0_0_0_3px_rgba(70,211,138,0.16)]" />
          {activeProviderLabel ?? "…"}
        </span>
        {configured && !showSettings && (
          <button
            onClick={() => setShowSettings(true)}
            title="OCR provider settings (⌘,)"
            className="text-ink-3 hover:text-ink-2"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
            </svg>
          </button>
        )}
      </header>

      {error && (
        <div className="border-b border-red-900 bg-red-950/60 px-3.5 py-2 text-[12px] text-red-300">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {configured === null ? (
          <p className="p-3.5 text-[12px] text-ink-3">Checking configuration…</p>
        ) : configured === false || showSettings ? (
          <ApiKeySetup
            onDone={settingsDone}
            onCancel={configured ? () => setShowSettings(false) : undefined}
          />
        ) : session ? (
          <ImagePreview
            session={session}
            canUndo={history.past.length > 0}
            onResult={(imageId, latex, provider, seconds) =>
              dispatch({ type: "result", imageId, latex, provider, seconds })
            }
            onLatexChange={(latex) => dispatch({ type: "editLatex", latex })}
            onClear={() => dispatch({ type: "clear" })}
          />
        ) : (
          <div className="flex flex-1 flex-col">
            <div className="flex-1 overflow-y-auto p-3.5">
              <CaptureZone
                isDragging={isDragging}
                onPick={() => void pickFile()}
                providerLabel={activeProviderLabel}
              />
            </div>
            <HintBar
              hints={[
                { keys: ["⌘", "V"], label: "Paste" },
                ...(history.past.length > 0 ? [{ keys: ["⌘", "Z"], label: "Undo" }] : []),
                { keys: ["⌘", ","], label: "Settings", right: true },
              ]}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
