import type { Lang } from "./types";

// Provider display prose, owned by the frontend and keyed by the backend
// provider `id`. The Rust `note`/`label` from `list_providers` stay as a
// non-displayed fallback. Only `local` needs a translated label (the
// "(hors-ligne)" qualifier); the other labels are proper nouns rendered
// verbatim from the backend.
type ProviderCopy = {
  note: string;
  /** Full label override (used for `local` only). */
  label?: string;
  /** Key-field placeholder override (SimpleTex's is prose). */
  keyPlaceholder?: string;
};

export const providerCopy: Record<Lang, Record<string, ProviderCopy>> = {
  fr: {
    gemini: { note: "Modèle de vision généraliste, offre gratuite généreuse." },
    simpletex: {
      note: "OCR de formules dédié, 2000 appels/jour gratuits. Une formule par image ; serveurs en Chine.",
      keyPlaceholder: "ton jeton UAT SimpleTex",
    },
    openrouter: {
      note: "Route vers des modèles de vision gratuits. 50 requêtes/jour gratuites, 1000/jour après un rechargement unique de 10 $.",
    },
    openai: {
      note: "Pas d’offre gratuite, mais quelques centimes par mois au volume d’une capture. Très fiable sur la sortie exacte.",
    },
    anthropic: { note: "Pas d’offre gratuite permanente, seulement des crédits d’essai." },
    local: {
      note: "Tourne sur ton Mac — pas de clé, pas de quota, hors-ligne. Télécharge un modèle (~600 Mo) une seule fois.",
      label: "Local (hors-ligne)",
    },
  },
  en: {
    gemini: { note: "General-purpose vision model, generous free tier." },
    simpletex: {
      note: "Dedicated formula OCR, 2000 free calls/day. One formula per image; servers in China.",
      keyPlaceholder: "your SimpleTex UAT token",
    },
    openrouter: {
      note: "Routes to free vision models. 50 free requests/day, 1000/day after a one-time $10 top-up.",
    },
    openai: {
      note: "No free tier, but a few cents per month at one-capture volume. Very reliable on exact output.",
    },
    anthropic: { note: "No permanent free tier, only trial credits." },
    local: {
      note: "Runs on your Mac — no key, no quota, offline. Download a model (~600 MB) once.",
      label: "Local (offline)",
    },
  },
};
