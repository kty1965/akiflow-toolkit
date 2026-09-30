import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Credentials, StoragePort } from "@core/ports/storage-port.ts";

const APP_NAME = "akiflow";
const AUTH_FILENAME = "auth.json";
const LOCK_FILENAME = "auth.json.lock";

// Longer than a worst-case refresh (two 10s attempts plus backoff), so a live
// holder is never robbed; a crashed holder's lock is reclaimed after this.
export const REFRESH_LOCK_STALE_MS = 30_000;
export const REFRESH_LOCK_POLL_MS = 100;

export interface XdgStorageOptions {
  lockStaleMs?: number;
  lockPollMs?: number;
}

function resolveConfigDir(): string {
  if (process.env.AF_CONFIG_DIR) {
    return process.env.AF_CONFIG_DIR;
  }
  const xdgConfigHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdgConfigHome, APP_NAME);
}

export class XdgStorage implements StoragePort {
  private readonly configDir: string;
  private readonly authFile: string;
  private readonly lockFile: string;
  private readonly lockStaleMs: number;
  private readonly lockPollMs: number;

  constructor(configDirOverride?: string, options: XdgStorageOptions = {}) {
    this.configDir = configDirOverride ?? resolveConfigDir();
    this.authFile = join(this.configDir, AUTH_FILENAME);
    this.lockFile = join(this.configDir, LOCK_FILENAME);
    this.lockStaleMs = options.lockStaleMs ?? REFRESH_LOCK_STALE_MS;
    this.lockPollMs = options.lockPollMs ?? REFRESH_LOCK_POLL_MS;
  }

  async withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireLock();
    try {
      return await fn();
    } finally {
      await unlink(this.lockFile).catch(() => {});
    }
  }

  private async acquireLock(): Promise<void> {
    await mkdir(this.configDir, { recursive: true, mode: 0o700 });
    for (;;) {
      try {
        const handle = await open(this.lockFile, "wx", 0o600);
        await handle.writeFile(String(process.pid));
        await handle.close();
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
      if (await this.isLockStale()) {
        await unlink(this.lockFile).catch(() => {});
        continue;
      }
      await Bun.sleep(this.lockPollMs);
    }
  }

  private async isLockStale(): Promise<boolean> {
    try {
      const { mtimeMs } = await stat(this.lockFile);
      return Date.now() - mtimeMs > this.lockStaleMs;
    } catch {
      return false;
    }
  }

  async saveCredentials(creds: Credentials): Promise<void> {
    await mkdir(this.configDir, { recursive: true, mode: 0o700 });
    const data = JSON.stringify(creds, null, 2);
    // The CLI and the MCP server share this file; write-then-rename keeps a
    // concurrent reader from seeing a truncated file and dropping the session.
    const tmpFile = `${this.authFile}.${process.pid}.tmp`;
    await writeFile(tmpFile, data, { encoding: "utf-8", mode: 0o600 });
    await rename(tmpFile, this.authFile);
  }

  async loadCredentials(): Promise<Credentials | null> {
    try {
      const data = await readFile(this.authFile, "utf-8");
      return JSON.parse(data) as Credentials;
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      console.error(`[akiflow] warning: failed to load credentials from ${this.authFile}:`, err);
      return null;
    }
  }

  async clearCredentials(): Promise<void> {
    try {
      await unlink(this.authFile);
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw err;
    }
  }

  getConfigDir(): string {
    return this.configDir;
  }
}
