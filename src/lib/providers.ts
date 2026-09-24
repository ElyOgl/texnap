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
};
