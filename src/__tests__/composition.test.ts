import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StderrLogger } from "../adapters/observability/stderr-logger.ts";
import { composeApp } from "../composition.ts";
import { AuthService } from "../core/services/auth-service.ts";

describe("composeApp", () => {
  let tempDir: string;
  const originalEnv: Record<string, string | undefined> = {};
  const envKeys = ["AF_CONFIG_DIR", "AF_CACHE_DIR", "LOG_LEVEL", "LOG_FORMAT"];

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "af-compose-"));
    for (const k of envKeys) originalEnv[k] = process.env[k];
    process.env.AF_CONFIG_DIR = tempDir;
    process.env.AF_CACHE_DIR = tempDir;
    process.env.LOG_LEVEL = "silent";
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
    for (const k of envKeys) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k];
    }
  });

  test("returns all required components with correct types", () => {
    // Given: an environment with overridden config dir
    // When: composing the application
    const components = composeApp();

    // Then: logger, config, storage, authService are wired correctly
    expect(components.logger).toBeInstanceOf(StderrLogger);
    expect(components.authService).toBeInstanceOf(AuthService);
    expect(components.storage).toBeDefined();
    expect(components.storage.getConfigDir()).toBe(tempDir);
    expect(components.config.configDir).toBe(tempDir);
    expect(components.config.logLevel).toBe("silent");
  });

  test("config object returned by compose is frozen", () => {
    // Given/When: compose is called
    const { config } = composeApp();

    // Then: config is immutable
    expect(Object.isFrozen(config)).toBe(true);
  });
});
