import { describe, expect, it } from "vitest";
import { en } from "./en";
import { fr } from "./fr";
import { it as itDict } from "./it";
import { de } from "./de";
import { es } from "./es";
import { pt } from "./pt";
import { providerCopy } from "./providers";
import type { Entry, Lang } from "./types";

const DICTS: Record<Lang, Record<keyof typeof en, Entry>> = { fr, en, it: itDict, de, es, pt };

// A tiny standalone copy of the provider's fill/plural logic, so the test
// doesn't need to mount React to exercise interpolation and plurals.
function resolve(lang: Lang, key: keyof typeof en, params?: Record<string, string | number>) {
  const entry = DICTS[lang][key];
  const tpl =
    typeof entry === "string"
      ? entry
      : new Intl.PluralRules(lang).select(Number(params?.count ?? 0)) === "one"
        ? entry.one
        : entry.other;
  return params ? tpl.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`)) : tpl;
}

describe("i18n dictionaries", () => {
  const nonCanonical: Lang[] = ["fr", "it", "de", "es", "pt"];

  it.each(nonCanonical)("%s covers exactly the en key set", (lang) => {
    expect(Object.keys(DICTS[lang]).sort()).toEqual(Object.keys(en).sort());
  });

  it.each(["fr", "en", "it", "de", "es", "pt"] as Lang[])("%s has provider copy for every provider", (lang) => {
    expect(Object.keys(providerCopy[lang]).sort()).toEqual(Object.keys(providerCopy.en).sort());
  });

  it("interpolates named params", () => {
    expect(resolve("en", "apiKey.getKey", { label: "OpenAI" })).toBe("Get a OpenAI key");
    expect(resolve("fr", "apiKey.getKey", { label: "OpenAI" })).toBe("Obtenir une clé OpenAI");
    expect(resolve("de", "apiKey.getKey", { label: "OpenAI" })).toBe("Einen OpenAI-Schlüssel erhalten");
  });

  it("selects plural forms by count", () => {
    // en: only 1 is "one"; fr: 0 and 1 are "one".
    expect(resolve("en", "fiche.formulaCount", { count: 1 })).toBe("1 formula");
    expect(resolve("en", "fiche.formulaCount", { count: 2 })).toBe("2 formulas");
    expect(resolve("fr", "fiche.formulaCount", { count: 0 })).toBe("0 formule");
    expect(resolve("fr", "fiche.formulaCount", { count: 2 })).toBe("2 formules");
    expect(resolve("es", "fiche.formulaCount", { count: 1 })).toBe("1 fórmula");
    expect(resolve("es", "fiche.formulaCount", { count: 2 })).toBe("2 fórmulas");
  });
});
