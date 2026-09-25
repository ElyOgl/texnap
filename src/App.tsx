import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ApiKeySetup } from "./components/ApiKeySetup";
import { CaptureZone } from "./components/CaptureZone";
import { ImagePreview } from "./components/ImagePreview";
import { HintBar } from "./components/ui";
import { useImageCapture } from "./lib/useImageCapture";
import type { CapturedImage } from "./lib/image";
import type { ConfigStatus, ProviderInfo } from "./lib/providers";
import "./App.css";

function App() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [activeProviderLabel, setActiveProviderLabel] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [image, setImage] = useState<CapturedImage | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const handleCapture = useCallback((img: CapturedImage) => {
    setError(null);
    setImage(img);
  }, []);
  const handleError = useCallback((msg: string) => setError(msg), []);

  const captureEnabled = configured === true && !showSettings;
  const { isDragging, pickFile } = useImageCapture(handleCapture, handleError, captureEnabled);

  // ⌘, opens settings from anywhere in the tool (Esc / ⌘⏎ are owned by the
  // settings screen itself).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "," && e.metaKey && configured) {
        e.preventDefault();
        setShowSettings(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [configured]);

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
        ) : image ? (
          <ImagePreview image={image} onClear={() => setImage(null)} />
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
