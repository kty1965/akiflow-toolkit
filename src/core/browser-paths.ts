// ---------------------------------------------------------------------------
// Browser profile type — pure interface, no external imports (ADR-0006)
// Detection logic lives in src/adapters/browser/browser-detector.ts
// ---------------------------------------------------------------------------

export interface BrowserProfile {
  name: string; // "Chrome", "Arc", "Brave", "Edge"
  profilePath: string;
  cookiesDb: string;
  /**
   * Candidate leveldb directories to search, in priority order. The reader
   * tries each one until a usable token is found. Akiflow historically stored
   * SPA state under `web.akiflow.com` but newer releases split into
   * `auth.akiflow.com` (tokens) and `product.akiflow.com` (app state).
   */
  indexedDbPaths: string[];
  keychainService: string;
}
