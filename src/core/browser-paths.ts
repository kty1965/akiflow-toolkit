// ---------------------------------------------------------------------------
// Browser profile type — pure interface, no external imports (ADR-0006)
// Detection logic lives in src/adapters/browser/browser-detector.ts
// ---------------------------------------------------------------------------

export interface BrowserProfile {
  name: string; // "Chrome", "Arc", "Brave", "Edge"
  profilePath: string;
  cookiesDb: string;
  indexedDbPath: string;
  keychainService: string;
}
