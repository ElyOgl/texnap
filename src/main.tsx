import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { I18nProvider, detectLang, type Lang } from "./lib/i18n";
import type { ConfigStatus } from "./lib/providers";

// Resolve the UI language BEFORE the first render so even the initial loading
// line paints in the right language (no flash). A stored preference wins;
// otherwise auto-detect from the OS locale.
void (async () => {
  const lang: Lang = await invoke<ConfigStatus>("get_config_status")
    .then((s) => (s.language as Lang | null) ?? detectLang())
    .catch(() => detectLang());
  try {
    document.documentElement.lang = lang;
  } catch {
    /* no-op */
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <I18nProvider initialLang={lang}>
        <App />
      </I18nProvider>
    </React.StrictMode>,
  );
})();
