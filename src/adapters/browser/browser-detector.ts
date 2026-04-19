import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BrowserProfile } from "@core/browser-paths.ts";

interface BrowserConfig {
  name: string;
  /** Relative to ~/Library/Application Support/ */
  relativeProfile: string;
  keychainService: string;
}

const MACOS_BROWSERS: BrowserConfig[] = [
  {
    name: "Chrome",
    relativeProfile: "Google/Chrome/Default",
    keychainService: "Chrome Safe Storage",
  },
  {
    name: "Arc",
    relativeProfile: "Arc/User Data/Default",
    keychainService: "Arc Safe Storage",
  },
  {
    name: "Brave",
    relativeProfile: "BraveSoftware/Brave-Browser/Default",
    keychainService: "Brave Safe Storage",
  },
  {
    name: "Edge",
    relativeProfile: "Microsoft Edge/Default",
    keychainService: "Microsoft Edge Safe Storage",
  },
];

/**
 * Candidate IndexedDB leveldb directories to scan for Akiflow tokens, in
 * priority order. Akiflow split its SPA across multiple origins over time;
 * `auth.akiflow.com` is the current home of OAuth tokens, `web.akiflow.com`
 * is the legacy main app, and `product.akiflow.com` holds newer app state.
 */
const AKIFLOW_INDEXEDDB_DIRS = [
  "IndexedDB/https_auth.akiflow.com_0.indexeddb.leveldb",
  "IndexedDB/https_web.akiflow.com_0.indexeddb.leveldb",
  "IndexedDB/https_product.akiflow.com_0.indexeddb.leveldb",
] as const;

export function detectBrowsers(home?: string): BrowserProfile[] {
  const h = home ?? homedir();
  const appSupport = join(h, "Library", "Application Support");

  const found: BrowserProfile[] = [];
  for (const browser of MACOS_BROWSERS) {
    const profilePath = join(appSupport, browser.relativeProfile);
    if (!existsSync(profilePath)) continue;

    found.push({
      name: browser.name,
      profilePath,
      cookiesDb: join(profilePath, "Cookies"),
      indexedDbPaths: AKIFLOW_INDEXEDDB_DIRS.map((rel) => join(profilePath, rel)),
      keychainService: browser.keychainService,
    });
  }

  return found;
}
