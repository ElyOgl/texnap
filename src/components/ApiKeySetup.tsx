import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ConfigStatus, ProviderInfo } from "../lib/providers";
import { HintBar } from "./ui";

type Props = {
  onDone: () => void;
  /** Present when reopened from Settings on an already-configured app. */
  onCancel?: () => void;
};

const SYMBOLS: Record<string, string> = { Cmd: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };

// The binding uses e.code (the PHYSICAL key) so the shortcut fires regardless of
// keyboard layout — macOS matches hotkeys by physical position, so binding "M"
// by character breaks on AZERTY. The display label uses e.key (the character the
// user actually pressed) so what they see matches what they typed.
function accelFromEvent(e: KeyboardEvent): { accel: string; label: string } | null {
  const mods: string[] = [];
  if (e.metaKey) mods.push("Cmd");
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  const code = e.code;
  // Ignore lone modifier presses — keep waiting for a real key.
  if (/^(Meta|Control|Alt|Shift|OS)(Left|Right)?$/.test(code)) return null;
  if (mods.length === 0) return null; // a global shortcut needs a modifier
  const labelKey =
    e.key && e.key.length === 1 ? e.key.toUpperCase() : code === "Space" ? "Space" : e.key || code;
  return {
    accel: [...mods, code].join("+"),
    label: [...mods.map((m) => SYMBOLS[m] ?? m), labelKey].join(" "),
  };
}

// Cold-load display of a stored (code-based) accelerator.
function prettyShortcut(accel: string): string {
  return accel
    .split("+")
    .map((part) => {
      if (SYMBOLS[part]) return SYMBOLS[part];
      if (/^Key[A-Z]$/.test(part)) return part.slice(3);
      if (/^Digit[0-9]$/.test(part)) return part.slice(5);
      const punct: Record<string, string> = {
        Semicolon: ";", Comma: ",", Period: ".", Slash: "/", Quote: "'",
        Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
        Backslash: "\\",
      };
      return punct[part] ?? part;
    })
    .join(" ");
}

export function ApiKeySetup({ onDone, onCancel }: Props) {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [savedProviders, setSavedProviders] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shortcutLabel, setShortcutLabel] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [shortcutError, setShortcutError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [providerList, status, sc] = await Promise.all([
        invoke<ProviderInfo[]>("list_providers"),
        invoke<ConfigStatus>("get_config_status"),
        invoke<string>("get_shortcut"),
      ]);
      setProviders(providerList);
      setSavedProviders(status.savedProviders);
      setSelected(status.activeProvider);
      setShortcutLabel(prettyShortcut(sc));
    })();
  }, []);

  // Records the next modifier+key combo and saves it as the global shortcut.
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        setRecording(false);
        return;
      }
      const result = accelFromEvent(e);
      if (!result) return; // modifier-only — keep waiting
      setRecording(false);
      void (async () => {
        try {
          await invoke("set_shortcut", { shortcut: result.accel });
          setShortcutLabel(result.label);
          setShortcutError(null);
        } catch (err) {
          setShortcutError(String(err));
        }
      })();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording]);

  const info = providers?.find((p) => p.id === selected) ?? null;
  const alreadySaved = selected !== null && savedProviders.includes(selected);

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      if (alreadySaved && key.trim().length === 0) {
        await invoke("set_active_provider", { provider: selected });
      } else {
        await invoke("save_provider_key", { provider: selected, key });
      }
      onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = selected !== null && (alreadySaved || key.trim().length > 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (recording) return; // the recorder owns the keyboard while active
      if (e.key === "Enter" && e.metaKey && canSubmit && !busy) {
        e.preventDefault();
        void submit();
      } else if (e.key === "Escape" && onCancel) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!providers || !selected) {
    return <p className="p-3.5 text-[12px] text-ink-3">Loading providers…</p>;
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3.5">
        <div>
          <label className="mb-1.5 block text-[11px] text-ink-3">OCR provider</label>
          <div className="relative">
            <select
              value={selected}
              onChange={(e) => {
                setSelected(e.currentTarget.value);
                setKey("");
                setError(null);
              }}
              className="w-full appearance-none rounded-lg border border-line-2 bg-surface-2 px-3 py-2.5 pr-9 text-[13px] text-ink outline-none focus:border-accent/50"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.freeTier ? " — free tier" : ""}
                  {savedProviders.includes(p.id) ? " (key saved)" : ""}
                </option>
              ))}
            </select>
            <svg
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
          {info && <p className="mt-1.5 text-[11px] text-ink-3">{info.note}</p>}
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] text-ink-3">
            API key
            {alreadySaved && <span className="text-ink-2"> — a key is already saved</span>}
          </label>
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              value={key}
              onChange={(e) => setKey(e.currentTarget.value)}
              placeholder={alreadySaved ? "Leave blank to keep the saved key" : info?.keyPlaceholder}
              spellCheck={false}
              className="w-full rounded-lg border border-line-2 bg-surface-2 px-3 py-2.5 pr-16 font-mono text-[12px] text-ink outline-none focus:border-accent/50"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-3 hover:text-ink-2"
            >
              {show ? "Hide" : "Show"}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-ink-3">
            {info && (
              <a href={info.getKeyUrl} target="_blank" rel="noreferrer" className="underline hover:text-ink-2">
                Get a {info.label} key
              </a>
            )}
            {" · stored locally on this Mac, never in the repo."}
          </p>
        </div>

        <div className="border-t border-line pt-3">
          <label className="mb-1.5 block text-[11px] text-ink-3">Global capture shortcut</label>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-line-2 bg-surface-2 px-2.5 py-1.5 font-mono text-[12px] text-ink">
              {recording ? "Press keys…" : shortcutLabel ?? "—"}
            </span>
            <button
              type="button"
              onClick={() => {
                setShortcutError(null);
                setRecording((r) => !r);
              }}
              className="rounded-md border border-line-2 px-3 py-1.5 text-[12px] text-ink-2 hover:text-ink"
            >
              {recording ? "Cancel" : "Change"}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-ink-3">
            {recording
              ? "Press a combo with a modifier (⌘/⌃/⌥/⇧), or Esc to cancel."
              : "Snips a screen region from anywhere, then transcribes it. Needs macOS Screen Recording permission."}
          </p>
          {shortcutError && <p className="mt-1 text-[11px] text-red-400">{shortcutError}</p>}
        </div>

        {error && <p className="text-[12px] text-red-400">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-0.5">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-line-2 px-3 py-1.5 text-[12px] text-ink-2 hover:text-ink"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !canSubmit}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Saving…" : alreadySaved && key.trim().length === 0 ? "Use provider" : "Save key"}
            <span className="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[10px]">⌘⏎</span>
          </button>
        </div>
      </div>

      <HintBar
        hints={[
          { keys: ["⌘", "⏎"], label: "Save" },
          ...(onCancel ? [{ keys: ["esc"], label: "Close", right: true }] : []),
        ]}
      />
    </div>
  );
}
