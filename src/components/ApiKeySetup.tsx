import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ConfigStatus, ProviderInfo } from "../lib/providers";
import { HintBar } from "./ui";

type Props = {
  onDone: () => void;
  /** Present when reopened from Settings on an already-configured app. */
  onCancel?: () => void;
};

export function ApiKeySetup({ onDone, onCancel }: Props) {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [savedProviders, setSavedProviders] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const [providerList, status] = await Promise.all([
        invoke<ProviderInfo[]>("list_providers"),
        invoke<ConfigStatus>("get_config_status"),
      ]);
      setProviders(providerList);
      setSavedProviders(status.savedProviders);
      setSelected(status.activeProvider);
    })();
  }, []);

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
