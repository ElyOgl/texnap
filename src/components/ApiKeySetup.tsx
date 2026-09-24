import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Props = {
  onSaved: () => void;
};

// Shown once, before the first OCR call, if no key was found via the P2a
// resolution order (env/.env in dev, config.json otherwise). The key is
// written Rust-side (save_api_key) and never stored anywhere in JS state.
export function ApiKeySetup({ onSaved }: Props) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await invoke("save_api_key", { key });
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex w-full max-w-md flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-6">
      <h2 className="text-lg font-medium">Anthropic API key required</h2>
      <p className="text-sm text-neutral-400">
        texnap calls Claude directly to transcribe formulas — nothing is sent
        anywhere else. Your key is stored locally on this Mac, never in the
        repo.{" "}
        <a
          href="https://console.anthropic.com/settings/keys"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-neutral-200"
        >
          Get a key
        </a>
        .
      </p>
      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.currentTarget.value)}
        placeholder="sk-ant-..."
        className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || key.trim().length === 0}
        className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save key"}
      </button>
    </div>
  );
}
