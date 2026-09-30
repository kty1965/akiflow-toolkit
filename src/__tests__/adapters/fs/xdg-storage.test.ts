import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
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

  describe("atomic save", () => {
    test("overwriting leaves only auth.json behind (no temp file)", async () => {
      // Given: credentials already saved once
      await storage.saveCredentials(sampleCredentials);

      // When: saved again with a rotated token
      await storage.saveCredentials({ ...sampleCredentials, accessToken: "rotated" });

      // Then: the file holds the new token and the temp file was renamed away
      expect((await storage.loadCredentials())?.accessToken).toBe("rotated");
      expect(await readdir(tempDir)).toEqual(["auth.json"]);
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

  describe("withRefreshLock", () => {
    test("two storages on the same dir never run the critical section concurrently", async () => {
      // Given: two independent storage instances sharing one config dir
      const other = new XdgStorage(tempDir, { lockPollMs: 5 });
      const fast = new XdgStorage(tempDir, { lockPollMs: 5 });
      let active = 0;
      let maxActive = 0;
      const critical = async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await Bun.sleep(30);
        active--;
      };

      // When: both enter the lock at the same time
      await Promise.all([fast.withRefreshLock(critical), other.withRefreshLock(critical)]);

      // Then: they were serialized and the lock file is gone
      expect(maxActive).toBe(1);
      expect(await readdir(tempDir)).not.toContain("auth.json.lock");
    });

    test("lock is released when the critical section throws", async () => {
      // Given: a critical section that fails
      const failing = storage.withRefreshLock(async () => {
        throw new Error("boom");
      });

      // When/Then: the error propagates and the lock can be taken again
      await expect(failing).rejects.toThrow("boom");
      expect(await storage.withRefreshLock(async () => "again")).toBe("again");
    });

    test("stale lock left by a crashed process is reclaimed", async () => {
      // Given: an orphaned lock file older than the stale threshold
      const quick = new XdgStorage(tempDir, { lockStaleMs: 20, lockPollMs: 5 });
      await writeFile(join(tempDir, "auth.json.lock"), "99999");
      await Bun.sleep(40);

      // When: acquiring the lock
      const result = await quick.withRefreshLock(async () => "acquired");

      // Then: the stale lock did not block
      expect(result).toBe("acquired");
    });
  });
});
