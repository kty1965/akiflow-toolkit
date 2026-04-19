import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadConfig } from "@config";

describe("loadConfig", () => {
  test("applies hardcoded defaults when env is empty (CLI mode)", () => {
    // Given: empty env and non-MCP argv
    const config = loadConfig({ env: { HOME: "/home/tester" }, argv: ["bun", "src/index.ts"] });

    // Then: CLI defaults apply (info level, text format, Akiflow URLs)
    expect(config.logLevel).toBe("info");
    expect(config.logFormat).toBe("text");
    expect(config.apiBaseUrl).toBe("https://api.akiflow.com");
    expect(config.authBaseUrl).toBe("https://web.akiflow.com");
    expect(config.cdpPort).toBe(9222);
    expect(config.cacheTtlSeconds).toBe(30);
  });

  test("MCP mode defaults logLevel to warn (quieter)", () => {
    // Given: --mcp in argv, no LOG_LEVEL override
    const config = loadConfig({ env: { HOME: "/home/tester" }, argv: ["bun", "src/index.ts", "--mcp"] });

    // Then: logLevel is warn to minimize stderr noise during JSON-RPC
    expect(config.logLevel).toBe("warn");
  });

  test("AF_DEBUG=1 overrides default level to debug", () => {
    // Given: AF_DEBUG=1 and no explicit LOG_LEVEL
    const config = loadConfig({ env: { HOME: "/home/tester", AF_DEBUG: "1" }, argv: ["bun"] });

    // Then: debug level is applied
    expect(config.logLevel).toBe("debug");
  });

  test("LOG_LEVEL env var wins over AF_DEBUG and MCP defaults", () => {
    // Given: both LOG_LEVEL and AF_DEBUG set with --mcp
    const config = loadConfig({
      env: { HOME: "/home/tester", LOG_LEVEL: "error", AF_DEBUG: "1" },
      argv: ["bun", "--mcp"],
    });

    // Then: explicit LOG_LEVEL wins
    expect(config.logLevel).toBe("error");
  });

  test("rejects invalid LOG_LEVEL and falls back", () => {
    // Given: bogus LOG_LEVEL value
    const config = loadConfig({ env: { HOME: "/home/tester", LOG_LEVEL: "loud" }, argv: ["bun"] });

    // Then: falls back to default info
    expect(config.logLevel).toBe("info");
  });

  test("AF_CONFIG_DIR and AF_CACHE_DIR override XDG defaults", () => {
    // Given: explicit config/cache dirs
    const config = loadConfig({
      env: { HOME: "/home/tester", AF_CONFIG_DIR: "/tmp/af-cfg", AF_CACHE_DIR: "/tmp/af-cache" },
      argv: ["bun"],
    });

    // Then: overrides are respected
    expect(config.configDir).toBe("/tmp/af-cfg");
    expect(config.cacheDir).toBe("/tmp/af-cache");
  });

  test("XDG_CONFIG_HOME / XDG_CACHE_HOME used when AF_* unset", () => {
    // Given: XDG vars provided but not AF_*
    const config = loadConfig({
      env: { HOME: "/home/tester", XDG_CONFIG_HOME: "/xdg/config", XDG_CACHE_HOME: "/xdg/cache" },
      argv: ["bun"],
    });

    // Then: XDG paths + APP_NAME are composed
    expect(config.configDir).toBe(join("/xdg/config", "akiflow"));
    expect(config.cacheDir).toBe(join("/xdg/cache", "akiflow"));
  });

  test("parses numeric env vars and falls back on invalid values", () => {
    // Given: valid and invalid numeric overrides
    const config = loadConfig({
      env: {
        HOME: "/home/tester",
        AF_CDP_PORT: "9999",
        AF_CACHE_TTL_SECONDS: "not-a-number",
      },
      argv: ["bun"],
    });

    // Then: valid value is kept; invalid falls back to default
    expect(config.cdpPort).toBe(9999);
    expect(config.cacheTtlSeconds).toBe(30);
  });

  test("returned config is frozen (immutable)", () => {
    // Given: a loaded config
    const config = loadConfig({ env: { HOME: "/home/tester" }, argv: ["bun"] });

    // Then: mutating is forbidden
    expect(Object.isFrozen(config)).toBe(true);
  });

  test("LOG_FORMAT=json switches to json format", () => {
    // Given: LOG_FORMAT=json
    const config = loadConfig({ env: { HOME: "/home/tester", LOG_FORMAT: "json" }, argv: ["bun"] });

    // Then: logFormat is json
    expect(config.logFormat).toBe("json");
  });

  // -------------------------------------------------------------------------
  // Security — base URL validation (SECURITY-AUDIT-REPORT.md S-2)
  // Prevents MITM / credential exfiltration via a poisoned env var pointing
  // the HTTP adapter at an attacker-controlled host.
  // -------------------------------------------------------------------------

  describe("base URL validation", () => {
    test("accepts valid https URL and strips trailing slash", () => {
      const config = loadConfig({
        env: { HOME: "/home/tester", AF_API_BASE_URL: "https://api.example.com/" },
        argv: ["bun"],
      });
      expect(config.apiBaseUrl).toBe("https://api.example.com");
    });

    test("rejects http:// by default", () => {
      expect(() =>
        loadConfig({
          env: { HOME: "/home/tester", AF_API_BASE_URL: "http://attacker.example.com" },
          argv: ["bun"],
        }),
      ).toThrow(/scheme must be https/);
    });

    test("rejects non-URL garbage", () => {
      expect(() =>
        loadConfig({
          env: { HOME: "/home/tester", AF_AUTH_BASE_URL: "not a url at all" },
          argv: ["bun"],
        }),
      ).toThrow(/not a parseable URL/);
    });

    test("rejects other schemes (file:, javascript:, data:)", () => {
      for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,x"]) {
        expect(() =>
          loadConfig({
            env: { HOME: "/home/tester", AF_API_BASE_URL: bad },
            argv: ["bun"],
          }),
        ).toThrow(/scheme must be https/);
      }
    });

    test("AF_ALLOW_INSECURE_BASE_URL=1 opts into http:// for local dev", () => {
      const config = loadConfig({
        env: {
          HOME: "/home/tester",
          AF_API_BASE_URL: "http://localhost:4000",
          AF_ALLOW_INSECURE_BASE_URL: "1",
        },
        argv: ["bun"],
      });
      expect(config.apiBaseUrl).toBe("http://localhost:4000");
    });

    test("AF_ALLOW_INSECURE_BASE_URL=1 still rejects file:/javascript:", () => {
      expect(() =>
        loadConfig({
          env: {
            HOME: "/home/tester",
            AF_API_BASE_URL: "file:///etc/passwd",
            AF_ALLOW_INSECURE_BASE_URL: "1",
          },
          argv: ["bun"],
        }),
      ).toThrow(/scheme must be https/);
    });

    test("empty string AF_API_BASE_URL falls back to default (not thrown)", () => {
      const config = loadConfig({
        env: { HOME: "/home/tester", AF_API_BASE_URL: "" },
        argv: ["bun"],
      });
      expect(config.apiBaseUrl).toBe("https://api.akiflow.com");
    });
  });
});
