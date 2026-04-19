import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectBrowsers } from "@adapters/browser/browser-detector.ts";

describe("detectBrowsers", () => {
  let fakeHome: string;

  beforeEach(async () => {
    fakeHome = await mkdtemp(join(tmpdir(), "akiflow-home-"));
  });

  afterEach(async () => {
    await rm(fakeHome, { recursive: true, force: true });
  });

  test("returns empty array when no browser profiles exist", () => {
    // Given: a home directory with no Library/Application Support entries

    // When: detectBrowsers is called with the empty home
    const result = detectBrowsers(fakeHome);

    // Then: no browsers are detected
    expect(result).toEqual([]);
  });

  test("detects Chrome profile when Default directory exists", async () => {
    // Given: a fake Chrome profile at the expected macOS path
    const chromeProfile = join(fakeHome, "Library", "Application Support", "Google", "Chrome", "Default");
    await mkdir(chromeProfile, { recursive: true });

    // When: detectBrowsers scans the fake home
    const result = detectBrowsers(fakeHome);

    // Then: Chrome is detected with the expected fields
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Chrome");
    expect(result[0].profilePath).toBe(chromeProfile);
    expect(result[0].cookiesDb).toBe(join(chromeProfile, "Cookies"));
    expect(result[0].indexedDbPaths).toEqual([
      join(chromeProfile, "IndexedDB/https_auth.akiflow.com_0.indexeddb.leveldb"),
      join(chromeProfile, "IndexedDB/https_web.akiflow.com_0.indexeddb.leveldb"),
      join(chromeProfile, "IndexedDB/https_product.akiflow.com_0.indexeddb.leveldb"),
    ]);
    expect(result[0].keychainService).toBe("Chrome Safe Storage");
  });

  test("detects multiple browsers in priority order", async () => {
    // Given: Chrome, Arc, Brave, Edge profiles all exist
    const appSupport = join(fakeHome, "Library", "Application Support");
    await mkdir(join(appSupport, "Google", "Chrome", "Default"), { recursive: true });
    await mkdir(join(appSupport, "Arc", "User Data", "Default"), { recursive: true });
    await mkdir(join(appSupport, "BraveSoftware", "Brave-Browser", "Default"), { recursive: true });
    await mkdir(join(appSupport, "Microsoft Edge", "Default"), { recursive: true });

    // When: detectBrowsers scans the fake home
    const result = detectBrowsers(fakeHome);

    // Then: all four are detected in the canonical order
    const names = result.map((p) => p.name);
    expect(names).toEqual(["Chrome", "Arc", "Brave", "Edge"]);
  });

  test("returned profiles have non-empty keychain service names", async () => {
    // Given: all browser profiles exist
    const appSupport = join(fakeHome, "Library", "Application Support");
    await mkdir(join(appSupport, "Google", "Chrome", "Default"), { recursive: true });
    await mkdir(join(appSupport, "Arc", "User Data", "Default"), { recursive: true });

    // When: detectBrowsers scans
    const result = detectBrowsers(fakeHome);

    // Then: every profile has a non-empty keychainService used later by chrome-cookie
    for (const profile of result) {
      expect(profile.keychainService.length).toBeGreaterThan(0);
      expect(profile.keychainService).toContain("Safe Storage");
    }
  });
});
