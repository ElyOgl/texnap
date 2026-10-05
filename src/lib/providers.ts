export type ProviderInfo = {
  id: string;
  label: string;
  freeTier: boolean;
  note: string;
  keyPlaceholder: string;
  getKeyUrl: string;
};

export type ConfigStatus = {
  configured: boolean;
  activeProvider: string;
  savedProviders: string[];
  /** Stored UI language code, or null when never chosen (auto-detect). */
  language: string | null;
};
