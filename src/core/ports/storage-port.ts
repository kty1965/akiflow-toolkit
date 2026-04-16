export interface Credentials {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  expiresAt: number;
  savedAt: string;
  source: "indexeddb" | "cookie" | "cdp" | "manual";
}

export interface StoragePort {
  saveCredentials(creds: Credentials): Promise<void>;
  loadCredentials(): Promise<Credentials | null>;
  clearCredentials(): Promise<void>;
  getConfigDir(): string;
}
