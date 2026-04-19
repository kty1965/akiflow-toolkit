import type { BrowserDataPort } from "@core/ports/browser-data-port.ts";
import type { LoggerPort } from "@core/ports/logger-port.ts";
import { detectBrowsers } from "./browser-detector.ts";
import { ChromeCookieReader } from "./chrome-cookie.ts";
import { IndexedDbReader } from "./indexeddb-reader.ts";
import { SafariCookieReader } from "./safari-cookie.ts";

export { detectBrowsers } from "./browser-detector.ts";
export { CdpBrowserLogin, type CdpBrowserLoginOptions, parseTokenBody } from "./cdp-launcher.ts";
export { ChromeCookieReader } from "./chrome-cookie.ts";
export { IndexedDbReader } from "./indexeddb-reader.ts";
export { parseBinaryCookies, type SafariCookie, SafariCookieReader } from "./safari-cookie.ts";

/**
 * Create browser data readers for all detected browsers.
 * Order: Chromium IndexedDB (no keychain) → Chromium cookies (keychain) → Safari cookies (macOS only).
 */
export function createBrowserReaders(logger: LoggerPort): BrowserDataPort[] {
  const profiles = detectBrowsers();
  const readers: BrowserDataPort[] = [];

  // Tier A: Chromium IndexedDB (preferred — no keychain prompt)
  for (const profile of profiles) {
    readers.push(new IndexedDbReader(profile, logger));
  }

  // Tier B: Chromium cookies (requires keychain access)
  for (const profile of profiles) {
    readers.push(new ChromeCookieReader(profile, logger));
  }

  // Tier C: Safari cookies (macOS only — reader self-guards on non-darwin).
  if (process.platform === "darwin") {
    readers.push(new SafariCookieReader(logger));
  }

  return readers;
}
