import { describe, expect, it } from "vitest";
import { en } from "./en";
import { fr } from "./fr";

// A tiny standalone copy of the provider's fill/plural logic, so the test
// doesn't need to mount React to exercise interpolation and plurals.
function resolve(lang: "fr" | "en", key: keyof typeof en, params?: Record<string, string | number>) {
  const entry = (lang === "fr" ? fr : en)[key];
  const tpl =
    typeof entry === "string"
      ? entry
      : new Intl.PluralRules(lang).select(Number(params?.count ?? 0)) === "one"
        ? entry.one
        : entry.other;
  return params ? tpl.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`)) : tpl;
}

describe("i18n dictionaries", () => {
  it("fr covers exactly the en key set", () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  it("interpolates named params", () => {
    expect(resolve("en", "apiKey.getKey", { label: "OpenAI" })).toBe("Get a OpenAI key");
    expect(resolve("fr", "apiKey.getKey", { label: "OpenAI" })).toBe("Obtenir une clé OpenAI");
  });

  it("selects plural forms by count", () => {
    // en: only 1 is "one"; fr: 0 and 1 are "one".
    expect(resolve("en", "fiche.formulaCount", { count: 1 })).toBe("1 formula");
    expect(resolve("en", "fiche.formulaCount", { count: 2 })).toBe("2 formulas");
    expect(resolve("fr", "fiche.formulaCount", { count: 0 })).toBe("0 formule");
    expect(resolve("fr", "fiche.formulaCount", { count: 2 })).toBe("2 formules");
  });
});
