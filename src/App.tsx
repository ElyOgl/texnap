import { useCallback, useEffect, useReducer, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ApiKeySetup } from "./components/ApiKeySetup";
import { CaptureZone } from "./components/CaptureZone";
import { ImagePreview } from "./components/ImagePreview";
import { LibraryPanel } from "./components/LibraryPanel";
import { FichePanel } from "./components/FichePanel";
import { HintBar } from "./components/ui";
import { useImageCapture } from "./lib/useImageCapture";
import { checkForUpdate, runUpdate, updateProgressLabel, type PendingUpdate } from "./lib/updater";
import { useI18n } from "./lib/i18n";
import { isEditableTarget } from "./lib/dom";
import { historyReducer, initialHistory } from "./lib/session";
import { type HistoryEntry, makeThumbnail } from "./lib/history";
import type { CapturedImage } from "./lib/image";
import type { ConfigStatus, ProviderInfo } from "./lib/providers";
import "./App.css";

function App() {
  const { t } = useI18n();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [activeProviderLabel, setActiveProviderLabel] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRunId, setAutoRunId] = useState<string | null>(null);
  const [history, dispatch] = useReducer(historyReducer, initialHistory);
  const session = history.present;
  // The library entry saved for the current result, so it can be tagged right
  // from the result view (F1). Tied to the image it came from — cleared on a
  // new capture so tags never leak to the next formula.
  const [savedEntry, setSavedEntry] = useState<{ id: string; imageId: string; tags: string[] } | null>(null);
  // F2: the selected library entries being turned into a fiche (PDF/.tex).
  const [sheetEntries, setSheetEntries] = useState<HistoryEntry[] | null>(null);
  // Auto-update: a pending update found at launch (null = none / dismissed),
  // and the in-progress download state driving the banner button.
  const [update, setUpdate] = useState<PendingUpdate | null>(null);
  const [updating, setUpdating] = useState<false | { pct: number | null }>(false);

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

  // Silent check for a newer release at launch; the banner only appears if one
  // is actually found (errors are ignored here — Settings surfaces them).
  useEffect(() => {
    void checkForUpdate().then((r) => {
      if (r.kind === "update") setUpdate(r.update);
    });
  }, []);

  const applyUpdate = useCallback(async () => {
    if (!update) return;
    setError(null);
    setUpdating({ pct: null });
    try {
      await runUpdate(update, (pct) => setUpdating({ pct }));
      // relaunch() replaces the process; nothing runs past here on success.
    } catch (e) {
      setUpdating(false);
      setError(t("update.error", { error: String(e) }));
    }
  }, [update, t]);

  // A new capture resets the result view; the previous session is kept on the
  // undo stack so ⌘Z brings it (and its LaTeX) back.
  const handleCapture = useCallback((img: CapturedImage) => {
    setError(null);
    setSavedEntry(null);
    dispatch({ type: "capture", image: img });
  }, []);
  const handleError = useCallback((msg: string) => setError(msg), []);

  // Region snips triggered by the global shortcut arrive as a data URL from
  // Rust — feed them into the same capture pipeline and leave the settings view.
  useEffect(() => {
    const unlisten = listen<string>("capture-region", (event) => {
      setShowSettings(false);
      const id = crypto.randomUUID();
      // Snips auto-transcribe (unlike paste/drop, which wait for ⏎).
      setAutoRunId(id);
      handleCapture({ id, dataUrl: event.payload, fileName: `snip-${Date.now()}.png` });
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
      if (e.key === "Escape" && sheetEntries) {
        e.preventDefault();
        setSheetEntries(null); // fiche → back to the library
        return;
      }
      if (e.key === "Escape" && showHistory) {
        e.preventDefault();
        setShowHistory(false);
        return;
      }
      if (
        e.metaKey &&
        e.key.toLowerCase() === "z" &&
        !showSettings &&
        !showHistory &&
        !isEditableTarget(e.target)
      ) {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [configured, showSettings, showHistory, sheetEntries]);

  const openHistoryEntry = (entry: HistoryEntry) => {
    dispatch({
      type: "load",
      session: {
        image: { id: crypto.randomUUID(), dataUrl: entry.thumbnail, fileName: "from-history.png" },
        latex: entry.latex,
        provider: entry.provider,
        seconds: null,
      },
    });
    setShowHistory(false);
  };

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
        {configured && !showSettings && !showHistory && (
          <>
            <button
              onClick={() => setShowHistory(true)}
              title={t("header.library")}
              className="text-ink-3 hover:text-ink-2"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 4h11a1 1 0 0 1 1 1v15l-6-3.5L6 20V4z" />
              </svg>
            </button>
            <button
              onClick={() => setShowSettings(true)}
              title={t("header.settings")}
              className="text-ink-3 hover:text-ink-2"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
              </svg>
            </button>
          </>
        )}
      </header>

      {update && configured === true && !showSettings && (
        <div className="flex items-center gap-2 border-b border-accent/30 bg-accent/10 px-3.5 py-2 text-[12px] text-ink-2">
          <span className="flex-1">{t("update.available", { version: update.version })}</span>
          <button
            onClick={() => void applyUpdate()}
            disabled={!!updating}
            className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-60"
          >
            {updating ? updateProgressLabel(t, updating.pct) : t("update.action")}
          </button>
          {!updating && (
            <button
              onClick={() => setUpdate(null)}
              className="text-[11px] text-ink-3 hover:text-ink-2"
            >
              {t("update.dismiss")}
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="border-b border-red-900 bg-red-950/60 px-3.5 py-2 text-[12px] text-red-300">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {configured === null ? (
          <p className="p-3.5 text-[12px] text-ink-3">{t("app.checkingConfig")}</p>
        ) : configured === false || showSettings ? (
          <ApiKeySetup
            onDone={settingsDone}
            onCancel={configured ? () => setShowSettings(false) : undefined}
          />
        ) : sheetEntries ? (
          <FichePanel entries={sheetEntries} onClose={() => setSheetEntries(null)} />
        ) : showHistory ? (
          <LibraryPanel
            onOpen={openHistoryEntry}
            onClose={() => setShowHistory(false)}
            onCreateSheet={(entries) => setSheetEntries(entries)}
          />
        ) : session ? (
          <ImagePreview
            session={session}
            canUndo={history.past.length > 0}
            autoRun={session.image.id === autoRunId}
            entryTags={savedEntry?.imageId === session.image.id ? savedEntry.tags : undefined}
            onEntryTags={
              savedEntry?.imageId === session.image.id
                ? (tags) => {
                    setSavedEntry((prev) => (prev ? { ...prev, tags } : prev));
                    void invoke("set_entry_tags", { id: savedEntry.id, tags });
                  }
                : undefined
            }
            onResult={(imageId, latex, provider, seconds) => {
              dispatch({ type: "result", imageId, latex, provider, seconds });
              // Save to the library (a downscaled thumbnail keeps history.json
              // small). Keep the new entry's id so the result view can tag it.
              if (session && session.image.id === imageId) {
                const id = crypto.randomUUID();
                void makeThumbnail(session.image.dataUrl).then(async (thumbnail) => {
                  await invoke("add_history_entry", {
                    entry: { id, createdAt: Date.now(), latex, provider, thumbnail, tags: [], pinned: false },
                  });
                  setSavedEntry({ id, imageId, tags: [] });
                });
              }
            }}
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
                onOpenSettings={() => setShowSettings(true)}
              />
            </div>
            <HintBar
              hints={[
                { keys: ["⌘", "V"], label: t("hint.paste") },
                ...(history.past.length > 0 ? [{ keys: ["⌘", "Z"], label: t("hint.undo") }] : []),
                { keys: ["⌘", ","], label: t("hint.settings"), right: true },
              ]}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
