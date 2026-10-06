import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ConfigStatus, ProviderInfo } from "../lib/providers";
import { HintBar } from "./ui";
import { useI18n } from "../lib/i18n";
import { providerCopy } from "../lib/i18n/providers";

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
  const { t, lang, setLang } = useI18n();
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
  // F6 local model (offline provider).
  const [localStatus, setLocalStatus] = useState<"unknown" | "not-downloaded" | "downloading" | "ready">("unknown");
  const [dlFiles, setDlFiles] = useState<{ name: string; received: number; total: number }[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  // F6b: optional on-device explanation LLM (separate download). Only shown when
  // this build ships it (the lean release hides it).
  const [llmAvailable, setLlmAvailable] = useState(false);
  const [llmStatus, setLlmStatus] = useState<"unknown" | "not-downloaded" | "downloading" | "ready">("unknown");
  const [llmDlFiles, setLlmDlFiles] = useState<{ name: string; received: number; total: number }[]>([]);
  const [llmError, setLlmError] = useState<string | null>(null);

  const isLocal = selected === "local";

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

  // Check whether the local model is already downloaded when Local is selected.
  useEffect(() => {
    if (!isLocal) return;
    void invoke<string>("local_model_status")
      .then((s) => setLocalStatus(s === "ready" ? "ready" : "not-downloaded"))
      .catch(() => setLocalStatus("not-downloaded"));
  }, [isLocal]);

  // Follow per-file download progress while downloading.
  useEffect(() => {
    if (localStatus !== "downloading") return;
    const un = listen<{ received: number; total: number; index: number; count: number }>(
      "local-model-progress",
      (e) =>
        setDlFiles((prev) =>
          prev.map((f, i) =>
            i === e.payload.index ? { ...f, received: e.payload.received, total: e.payload.total } : f,
          ),
        ),
    );
    return () => {
      void un.then((f) => f());
    };
  }, [localStatus]);

  const DL_LABELS = [t("apiKey.file.encoder"), t("apiKey.file.decoder"), t("apiKey.file.vocab")];
  const downloadModel = async () => {
    setLocalError(null);
    setDlFiles(DL_LABELS.map((name) => ({ name, received: 0, total: 0 })));
    setLocalStatus("downloading");
    try {
      await invoke("download_local_model");
      setLocalStatus("ready");
    } catch (err) {
      setLocalError(String(err));
      setLocalStatus("not-downloaded");
    }
  };

  const useLocal = async () => {
    setLocalError(null);
    try {
      await invoke("set_active_provider", { provider: "local" });
      onDone();
    } catch (err) {
      setLocalError(String(err));
    }
  };

  // Explanation LLM: availability + status when Local is selected.
  useEffect(() => {
    if (!isLocal) return;
    void invoke<boolean>("local_llm_available").then(setLlmAvailable).catch(() => setLlmAvailable(false));
    void invoke<string>("local_llm_status")
      .then((s) => setLlmStatus(s === "ready" ? "ready" : "not-downloaded"))
      .catch(() => setLlmStatus("not-downloaded"));
  }, [isLocal]);

  useEffect(() => {
    if (llmStatus !== "downloading") return;
    const un = listen<{ received: number; total: number; index: number; count: number }>(
      "local-llm-progress",
      (e) =>
        setLlmDlFiles((prev) =>
          prev.map((f, i) =>
            i === e.payload.index ? { ...f, received: e.payload.received, total: e.payload.total } : f,
          ),
        ),
    );
    return () => {
      void un.then((f) => f());
    };
  }, [llmStatus]);

  const LLM_DL_LABELS = [t("apiKey.llm.fileModel"), t("apiKey.llm.fileVocab")];
  const downloadLlm = async () => {
    setLlmError(null);
    setLlmDlFiles(LLM_DL_LABELS.map((name) => ({ name, received: 0, total: 0 })));
    setLlmStatus("downloading");
    try {
      await invoke("download_local_llm");
      setLlmStatus("ready");
    } catch (err) {
      setLlmError(String(err));
      setLlmStatus("not-downloaded");
    }
  };

  const mb = (n: number) => Math.round(n / 1048576);

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
    return <p className="p-3.5 text-[12px] text-ink-3">{t("apiKey.loading")}</p>;
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3.5">
        {onCancel && (
          <button onClick={onCancel} className="-mb-1 self-start text-[11px] text-ink-3 hover:text-ink-2">
            {t("common.back")}
          </button>
        )}
        <div>
          <label className="mb-1.5 block text-[11px] text-ink-3">{t("apiKey.providerLabel")}</label>
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
                  {providerCopy[lang][p.id]?.label ?? p.label}
                  {p.freeTier ? t("apiKey.freeTier") : ""}
                  {savedProviders.includes(p.id) ? t("apiKey.keySaved") : ""}
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
          {info && (
            <p className="mt-1.5 text-[11px] text-ink-3">
              {providerCopy[lang][info.id]?.note ?? info.note}
            </p>
          )}
        </div>

        {isLocal ? (
          <div>
            {localStatus === "ready" ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-ok/40 bg-surface-2 p-3">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-ok">
                  <circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" />
                </svg>
                <div className="flex min-w-0 flex-col">
                  <span className="text-[12.5px] text-ink">{t("apiKey.local.readyTitle")}</span>
                  <span className="text-[10.5px] text-ink-3">{t("apiKey.local.readySubtitle")}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void useLocal()}
                  className="ml-auto shrink-0 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink hover:brightness-110"
                >
                  {t("apiKey.local.use")}
                </button>
              </div>
            ) : localStatus === "downloading" ? (
              <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-3">
                <span className="text-[12px] text-ink-2">{t("apiKey.local.downloading")}</span>
                {dlFiles.map((f) => (
                  <div key={f.name} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[10.5px] text-ink-3">
                      <span>{f.name}</span>
                      <span className="font-mono">
                        {f.total ? t("apiKey.mbProgress", { received: mb(f.received), total: mb(f.total) }) : "…"}
                      </span>
                    </div>
                    <div className="h-1 overflow-hidden rounded bg-surface-3">
                      <div
                        className="h-full bg-accent transition-[width] duration-150"
                        style={{ width: f.total ? `${Math.round((f.received / f.total) * 100)}%` : "0%" }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface-2 p-3">
                <span className="text-[12px] leading-relaxed text-ink-2">
                  {t("apiKey.local.introPre")}
                  <span className="text-ink">{t("apiKey.local.introEm")}</span>
                  {t("apiKey.local.introPost")}
                </span>
                <button
                  type="button"
                  onClick={() => void downloadModel()}
                  className="self-start rounded-md bg-accent px-3.5 py-2 text-[12px] font-medium text-accent-ink hover:brightness-110"
                >
                  {t("apiKey.local.download")}
                </button>
              </div>
            )}
            {localError && <p className="mt-1.5 text-[11px] text-red-400">{localError}</p>}
            <p className="mt-1.5 text-[11px] text-ink-3">{t("apiKey.local.autoHint")}</p>

            {/* F6b: optional on-device explanation model (explanation-only).
                Hidden in the lean release (local explanation deferred). */}
            {llmAvailable && (
            <div className="mt-3 border-t border-line pt-3">
              <div className="mb-1.5 text-[11px] text-ink-3">{t("apiKey.llm.title")}</div>
              {llmStatus === "ready" ? (
                <div className="flex items-center gap-2.5 rounded-lg border border-ok/40 bg-surface-2 p-3">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-ok">
                    <circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" />
                  </svg>
                  <span className="text-[12px] text-ink">{t("apiKey.llm.ready")}</span>
                </div>
              ) : llmStatus === "downloading" ? (
                <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-3">
                  <span className="text-[12px] text-ink-2">{t("apiKey.llm.downloading")}</span>
                  {llmDlFiles.map((f) => (
                    <div key={f.name} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-[10.5px] text-ink-3">
                        <span>{f.name}</span>
                        <span className="font-mono">
                          {f.total ? t("apiKey.mbProgress", { received: mb(f.received), total: mb(f.total) }) : "…"}
                        </span>
                      </div>
                      <div className="h-1 overflow-hidden rounded bg-surface-3">
                        <div
                          className="h-full bg-accent transition-[width] duration-150"
                          style={{ width: f.total ? `${Math.round((f.received / f.total) * 100)}%` : "0%" }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface-2 p-3">
                  <span className="text-[12px] leading-relaxed text-ink-2">{t("apiKey.llm.intro")}</span>
                  <button
                    type="button"
                    onClick={() => void downloadLlm()}
                    className="self-start rounded-md border border-line-2 px-3.5 py-2 text-[12px] font-medium text-ink-2 hover:text-ink"
                  >
                    {t("apiKey.llm.download")}
                  </button>
                </div>
              )}
              {llmError && <p className="mt-1.5 text-[11px] text-red-400">{llmError}</p>}
            </div>
            )}
          </div>
        ) : (
        <div>
          <label className="mb-1.5 block text-[11px] text-ink-3">
            {t("apiKey.keyLabel")}
            {alreadySaved && <span className="text-ink-2">{t("apiKey.keyAlreadySaved")}</span>}
          </label>
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              value={key}
              onChange={(e) => setKey(e.currentTarget.value)}
              placeholder={
                alreadySaved
                  ? t("apiKey.keyPlaceholderSaved")
                  : providerCopy[lang][selected]?.keyPlaceholder ?? info?.keyPlaceholder
              }
              spellCheck={false}
              className="w-full rounded-lg border border-line-2 bg-surface-2 px-3 py-2.5 pr-16 font-mono text-[12px] text-ink outline-none focus:border-accent/50"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-3 hover:text-ink-2"
            >
              {show ? t("apiKey.hide") : t("apiKey.show")}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-ink-3">
            {info && (
              <a href={info.getKeyUrl} target="_blank" rel="noreferrer" className="underline hover:text-ink-2">
                {t("apiKey.getKey", { label: info.label })}
              </a>
            )}
            {t("apiKey.keyHintSuffix")}
          </p>
        </div>
        )}

        <div className="border-t border-line pt-3">
          <label className="mb-1.5 block text-[11px] text-ink-3">{t("apiKey.shortcutLabel")}</label>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-line-2 bg-surface-2 px-2.5 py-1.5 font-mono text-[12px] text-ink">
              {recording ? t("apiKey.shortcutRecording") : shortcutLabel ?? "—"}
            </span>
            <button
              type="button"
              onClick={() => {
                setShortcutError(null);
                setRecording((r) => !r);
              }}
              className="rounded-md border border-line-2 px-3 py-1.5 text-[12px] text-ink-2 hover:text-ink"
            >
              {recording ? t("common.cancel") : t("apiKey.shortcutEdit")}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-ink-3">
            {recording ? t("apiKey.shortcutHintRecording") : t("apiKey.shortcutHintIdle")}
          </p>
          {shortcutError && <p className="mt-1 text-[11px] text-red-400">{shortcutError}</p>}
        </div>

        <div className="border-t border-line pt-3">
          <label className="mb-1.5 block text-[11px] text-ink-3">{t("apiKey.langLabel")}</label>
          <div className="relative">
            <select
              value={lang}
              onChange={(e) => setLang(e.currentTarget.value as "fr" | "en")}
              className="w-full appearance-none rounded-lg border border-line-2 bg-surface-2 px-3 py-2 pr-9 text-[13px] text-ink outline-none focus:border-accent/50"
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
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
          <p className="mt-1.5 text-[11px] text-ink-3">{t("apiKey.langHint")}</p>
        </div>

        {error && <p className="text-[12px] text-red-400">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-0.5">
          {onCancel && (
            <button
              type="button"
              onClick={() => {
                // Confirm = apply the current choice and close. For a saved
                // provider or the ready local model this activates it; otherwise
                // it just closes (the primary button handles saving a new key).
                if (isLocal) {
                  if (localStatus === "ready") void useLocal();
                  else onCancel();
                } else if (canSubmit) {
                  void submit();
                } else {
                  onCancel();
                }
              }}
              className="rounded-md border border-line-2 px-3 py-1.5 text-[12px] text-ink-2 hover:text-ink"
            >
              {t("apiKey.confirm")}
            </button>
          )}
          {!isLocal && (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !canSubmit}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
            >
              {busy
                ? t("apiKey.saving")
                : alreadySaved && key.trim().length === 0
                  ? t("apiKey.useProvider")
                  : t("apiKey.saveKey")}
              <span className="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[10px]">⌘⏎</span>
            </button>
          )}
        </div>
      </div>

      <HintBar
        hints={[
          { keys: ["⌘", "⏎"], label: t("hint.save") },
          ...(onCancel ? [{ keys: ["esc"], label: t("hint.close"), right: true }] : []),
        ]}
      />
    </div>
  );
}
