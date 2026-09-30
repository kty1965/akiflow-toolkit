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
  /**
   * Run `fn` while holding a lock shared with other processes that use the
   * same credentials file, so only one of them spends the refresh token.
   */
  withRefreshLock?<T>(fn: () => Promise<T>): Promise<T>;
}
