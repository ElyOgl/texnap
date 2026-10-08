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
  it: {
    gemini: { note: "Modello di visione generico, piano gratuito generoso." },
    simpletex: {
      note: "OCR di formule dedicato, 2000 chiamate/giorno gratuite. Una formula per immagine; server in Cina.",
      keyPlaceholder: "il tuo token UAT SimpleTex",
    },
    openrouter: {
      note: "Instrada verso modelli di visione gratuiti. 50 richieste/giorno gratuite, 1000/giorno dopo una ricarica una tantum di 10 $.",
    },
    openai: {
      note: "Nessun piano gratuito, ma pochi centesimi al mese al volume di una cattura. Molto affidabile sull’output esatto.",
    },
    anthropic: { note: "Nessun piano gratuito permanente, solo crediti di prova." },
    local: {
      note: "Funziona sul tuo Mac — senza chiave, senza quota, offline. Scarica un modello (~600 MB) una sola volta.",
      label: "Local (offline)",
    },
  },
  de: {
    gemini: { note: "Allgemeines Vision-Modell, großzügiges Gratis-Kontingent." },
    simpletex: {
      note: "Spezialisiertes Formel-OCR, 2000 kostenlose Aufrufe/Tag. Eine Formel pro Bild; Server in China.",
      keyPlaceholder: "dein SimpleTex-UAT-Token",
    },
    openrouter: {
      note: "Leitet zu kostenlosen Vision-Modellen. 50 kostenlose Anfragen/Tag, 1000/Tag nach einer einmaligen Aufladung von 10 $.",
    },
    openai: {
      note: "Kein Gratis-Kontingent, aber wenige Cent pro Monat beim Volumen einer Aufnahme. Sehr zuverlässig bei der exakten Ausgabe.",
    },
    anthropic: { note: "Kein dauerhaftes Gratis-Kontingent, nur Testguthaben." },
    local: {
      note: "Läuft auf deinem Mac — kein Schlüssel, kein Kontingent, offline. Lade ein Modell (~600 MB) einmalig herunter.",
      label: "Local (offline)",
    },
  },
  es: {
    gemini: { note: "Modelo de visión de propósito general, plan gratuito generoso." },
    simpletex: {
      note: "OCR de fórmulas dedicado, 2000 llamadas/día gratis. Una fórmula por imagen; servidores en China.",
      keyPlaceholder: "tu token UAT de SimpleTex",
    },
    openrouter: {
      note: "Enruta a modelos de visión gratuitos. 50 solicitudes/día gratis, 1000/día tras una recarga única de 10 $.",
    },
    openai: {
      note: "Sin plan gratuito, pero unos céntimos al mes con el volumen de una captura. Muy fiable en la salida exacta.",
    },
    anthropic: { note: "Sin plan gratuito permanente, solo créditos de prueba." },
    local: {
      note: "Funciona en tu Mac — sin clave, sin cuota, sin conexión. Descarga un modelo (~600 MB) una sola vez.",
      label: "Local (sin conexión)",
    },
  },
};
