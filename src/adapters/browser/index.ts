import type { BrowserDataPort } from "../../core/ports/browser-data-port.ts";
import type { LoggerPort } from "../../core/ports/logger-port.ts";
import { detectBrowsers } from "./browser-detector.ts";
import { ChromeCookieReader } from "./chrome-cookie.ts";
import { IndexedDbReader } from "./indexeddb-reader.ts";

export { detectBrowsers } from "./browser-detector.ts";
export { IndexedDbReader } from "./indexeddb-reader.ts";
export { ChromeCookieReader } from "./chrome-cookie.ts";

/**
 * Create browser data readers for all detected browsers.
 * IndexedDB readers come first (Method 1 priority), then Chrome cookie readers (Method 2 fallback).
 */
export function createBrowserReaders(logger: LoggerPort): BrowserDataPort[] {
  const profiles = detectBrowsers();
  const readers: BrowserDataPort[] = [];

  // Method 1: IndexedDB (preferred — no keychain prompt)
  for (const profile of profiles) {
    readers.push(new IndexedDbReader(profile, logger));
  }

  // Method 2: Chrome cookies (requires keychain access)
  for (const profile of profiles) {
    readers.push(new ChromeCookieReader(profile, logger));
  }

  return readers;
}
