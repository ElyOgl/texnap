import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ConfigStatus, ProviderInfo } from "../lib/providers";

type Props = {
  onDone: () => void;
  /** Present when reopened from Settings on an already-configured app. */
  onCancel?: () => void;
};

// Shown before the first OCR call if no provider is configured, and reused
// (with onCancel) as the "change provider" settings screen. The key is
// written Rust-side (save_provider_key) and never stored in JS state beyond
// the input field itself.
export function ApiKeySetup({ onDone, onCancel }: Props) {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [savedProviders, setSavedProviders] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [key, setKey] = useState("");
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

  const useSavedKey = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await invoke("set_active_provider", { provider: selected });
      onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveNewKey = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await invoke("save_provider_key", { provider: selected, key });
      onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!providers || !selected) {
    return <p className="text-sm text-neutral-500">Loading providers…</p>;
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-6">
      <h2 className="text-lg font-medium">
        {onCancel ? "OCR provider" : "An API key is required"}
      </h2>
      <p className="text-sm text-neutral-400">
        texnap calls the provider you pick directly to transcribe formulas —
        nothing else sees the image. Your key stays local to this Mac, never
        in the repo.
      </p>

      <select
        value={selected}
        onChange={(e) => {
          setSelected(e.currentTarget.value);
          setKey("");
          setError(null);
        }}
        className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
      >
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
            {p.freeTier ? " — free tier" : ""}
            {savedProviders.includes(p.id) ? " (key saved)" : ""}
          </option>
        ))}
      </select>

      {alreadySaved ? (
        <>
          <p className="text-sm text-neutral-400">
            A key is already saved for {info?.label}.
          </p>
          <button
            type="button"
            onClick={() => void useSavedKey()}
            disabled={busy}
            className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
          >
            {busy ? "Switching…" : `Use ${info?.label}`}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-neutral-400">
            {info && (
              <a
                href={info.getKeyUrl}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-neutral-200"
              >
                Get a {info.label} key
              </a>
            )}
          </p>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.currentTarget.value)}
            placeholder={info?.keyPlaceholder}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
          />
          <button
            type="button"
            onClick={() => void saveNewKey()}
            disabled={busy || key.trim().length === 0}
            className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save key"}
          </button>
        </>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-neutral-500 hover:text-neutral-300"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
