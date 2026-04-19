import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Credentials, StoragePort } from "@core/ports/storage-port.ts";

const APP_NAME = "akiflow";
const AUTH_FILENAME = "auth.json";

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

  constructor(configDirOverride?: string) {
    this.configDir = configDirOverride ?? resolveConfigDir();
    this.authFile = join(this.configDir, AUTH_FILENAME);
  }

  async saveCredentials(creds: Credentials): Promise<void> {
    await mkdir(this.configDir, { recursive: true, mode: 0o700 });
    const data = JSON.stringify(creds, null, 2);
    await writeFile(this.authFile, data, { encoding: "utf-8", mode: 0o600 });
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
