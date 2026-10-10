// Supported UI languages. Add a code here, add a dictionary + a providerCopy
// entry + a dropdown <option>, and the app gains a language — nothing else.
export type Lang = "fr" | "en" | "it" | "de" | "es" | "pt";

// A dictionary entry is either a plain (optionally interpolated) string, or a
// plural pair chosen by `Intl.PluralRules` on a `{count}` param.
export type Plural = { one: string; other: string };
export type Entry = string | Plural;
