import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { XdgStorage } from "@adapters/fs/xdg-storage.ts";
import type { Credentials } from "@core/ports/storage-port.ts";

const sampleCredentials: Credentials = {
  accessToken: "ak_test_access_token_123",
  refreshToken: "ak_test_refresh_token_456",
  clientId: "test-client-id",
  expiresAt: Date.now() + 3600_000,
  savedAt: new Date().toISOString(),
  source: "manual",
};

describe("XdgStorage", () => {
  let tempDir: string;
  let storage: XdgStorage;
  const originalAfConfigDir = process.env.AF_CONFIG_DIR;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "akiflow-test-"));
    storage = new XdgStorage(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    process.env.AF_CONFIG_DIR = originalAfConfigDir;
    if (originalAfConfigDir === undefined) {
      process.env.AF_CONFIG_DIR = undefined;
    }
  });

  describe("save and load roundtrip", () => {
    test("saved credentials are loaded back identically", async () => {
      // Given: a set of credentials to persist
      const creds = { ...sampleCredentials };

      // When: credentials are saved and then loaded
      await storage.saveCredentials(creds);
      const loaded = await storage.loadCredentials();

      // Then: loaded credentials match the saved ones exactly
      expect(loaded).toEqual(creds);
    });
  });

  describe("file permissions", () => {
    test("auth.json has 0o600 permissions after save", async () => {
      // Given: credentials to save
      await storage.saveCredentials(sampleCredentials);

      // When: checking the file permissions
      const authFilePath = join(tempDir, "auth.json");
      const fileStat = await stat(authFilePath);

      // Then: file mode is 0o600 (owner read/write only)
      const mode = fileStat.mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });

  describe("clearCredentials", () => {
    test("load returns null after clearing", async () => {
      // Given: credentials have been saved
      await storage.saveCredentials(sampleCredentials);

      // When: credentials are cleared
      await storage.clearCredentials();

      // Then: loading returns null
      const loaded = await storage.loadCredentials();
      expect(loaded).toBeNull();
    });

    test("clearing when no file exists does not throw", async () => {
      // Given: no credentials file exists

      // When/Then: clearCredentials does not throw
      expect(storage.clearCredentials()).resolves.toBeUndefined();
    });
  });

  describe("corrupted JSON", () => {
    test("load returns null for malformed JSON", async () => {
      // Given: a corrupted auth.json file
      const authFilePath = join(tempDir, "auth.json");
      await writeFile(authFilePath, "{ broken json !!!", { mode: 0o600 });

      // When: loading credentials
      const loaded = await storage.loadCredentials();

      // Then: returns null instead of crashing
      expect(loaded).toBeNull();
    });
  });

  describe("AF_CONFIG_DIR env override", () => {
    test("respects AF_CONFIG_DIR environment variable", async () => {
      // Given: AF_CONFIG_DIR is set to a custom temp directory
      const customDir = await mkdtemp(join(tmpdir(), "akiflow-env-test-"));
      process.env.AF_CONFIG_DIR = customDir;

      // When: creating storage without explicit override (uses env)
      const envStorage = new XdgStorage();

      // Then: config dir matches the env variable
      expect(envStorage.getConfigDir()).toBe(customDir);

      // Cleanup
      await rm(customDir, { recursive: true, force: true });
    });
  });

  describe("missing file", () => {
    test("load returns null when auth.json does not exist", async () => {
      // Given: an empty config directory (no auth.json)

      // When: loading credentials
      const loaded = await storage.loadCredentials();

      // Then: returns null (not an error)
      expect(loaded).toBeNull();
    });
  });

  describe("getConfigDir", () => {
    test("returns the resolved config directory path", () => {
      // Given: storage initialized with a specific directory

      // When: querying the config directory
      const dir = storage.getConfigDir();

      // Then: returns the directory passed at construction
      expect(dir).toBe(tempDir);
    });
  });
});
