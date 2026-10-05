import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { en, type TKey } from "./en";
import { fr } from "./fr";
import type { Entry, Lang } from "./types";

export type { Lang } from "./types";
export type { TKey } from "./en";

const DICTS: Record<Lang, Record<TKey, Entry>> = { fr, en };

type Params = Record<string, string | number>;

// Replace {placeholders}; a missing param is left visible (e.g. "{x}") to make
// the omission obvious rather than silently blank.
function fill(tpl: string, params?: Params): string {
  if (!params) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`));
}

type I18n = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey, params?: Params) => string;
};

const I18nContext = createContext<I18n | null>(null);

/** Guess the UI language from the OS locale when no preference is stored yet. */
export function detectLang(): Lang {
  return (navigator.language || "").toLowerCase().startsWith("en") ? "en" : "fr";
}

export function I18nProvider({ initialLang, children }: { initialLang: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const t = useCallback(
    (key: TKey, params?: Params) => {
      const entry = DICTS[lang][key] ?? en[key];
      if (typeof entry === "string") return fill(entry, params);
      const form = new Intl.PluralRules(lang).select(Number(params?.count ?? 0));
      return fill(form === "one" ? entry.one : entry.other, params);
    },
    [lang],
  );

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      document.documentElement.lang = l;
    } catch {
      /* no-op */
    }
    // Persist in config.json (no OS side effect); mirrors set_active_provider.
    void invoke("set_language", { language: l }).catch(() => {});
  }, []);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
