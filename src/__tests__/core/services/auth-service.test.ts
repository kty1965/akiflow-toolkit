import { describe, expect, test } from "bun:test";
import { AuthExpiredError, AuthSourceMissingError, NetworkError } from "../../../core/errors/index.ts";
import type { BrowserDataPort } from "../../../core/ports/browser-data-port.ts";
import type { LoggerPort } from "../../../core/ports/logger-port.ts";
import type { StoragePort } from "../../../core/ports/storage-port.ts";
import { AuthService, type AuthServiceDeps } from "../../../core/services/auth-service.ts";
import type { Credentials, ExtractedToken, TokenRefreshResponse } from "../../../core/types.ts";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

interface StorageState {
  current: Credentials | null;
  saveCalls: Credentials[];
  clearCalls: number;
}

function createStorage(initial: Credentials | null = null): {
  port: StoragePort;
  state: StorageState;
} {
  const state: StorageState = { current: initial, saveCalls: [], clearCalls: 0 };
  const port: StoragePort = {
    async saveCredentials(creds) {
      state.saveCalls.push(creds);
      state.current = creds;
    },
    async loadCredentials() {
      return state.current;
    },
    async clearCredentials() {
      state.clearCalls++;
      state.current = null;
    },
    getConfigDir() {
      return "/tmp/test-config";
    },
  };
  return { port, state };
}

class StubReader implements BrowserDataPort {
  public calls = 0;
  constructor(
    private readonly behavior: { type: "ok"; value: ExtractedToken } | { type: "null" } | { type: "throw"; err: Error },
  ) {}
  async extract(): Promise<ExtractedToken | null> {
    this.calls++;
    if (this.behavior.type === "throw") throw this.behavior.err;
    if (this.behavior.type === "null") return null;
    return this.behavior.value;
  }
}

interface RefreshState {
  calls: string[];
  response: TokenRefreshResponse;
  errorOnCall?: { at: number; err: Error };
}

function createRefresher(initial: Partial<TokenRefreshResponse> = {}): {
  fn: (token: string) => Promise<TokenRefreshResponse>;
  state: RefreshState;
} {
  const state: RefreshState = {
    calls: [],
    response: {
      token_type: "Bearer",
      expires_in: 3600,
      access_token: "refreshed_access_token",
      refresh_token: "refreshed_refresh_token",
      ...initial,
    },
  };
  const fn = async (token: string): Promise<TokenRefreshResponse> => {
    state.calls.push(token);
    if (state.errorOnCall && state.errorOnCall.at === state.calls.length) {
      throw state.errorOnCall.err;
    }
    return state.response;
  };
  return { fn, state };
}

function createLogger(): LoggerPort {
  return {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function makeCredentials(overrides: Partial<Credentials> = {}): Credentials {
  return {
    accessToken: "stored_access_token",
    refreshToken: "stored_refresh_token",
    clientId: "client-id-123",
    expiresAt: Date.now() + 60 * 60 * 1000,
    savedAt: new Date().toISOString(),
    source: "indexeddb",
    ...overrides,
  };
}

function buildService(overrides: Partial<AuthServiceDeps> = {}): {
  service: AuthService;
  deps: AuthServiceDeps;
} {
  const storage = createStorage();
  const refresher = createRefresher();
  const deps: AuthServiceDeps = {
    storage: overrides.storage ?? storage.port,
    browserReaders: overrides.browserReaders ?? [],
    refreshAccessToken: overrides.refreshAccessToken ?? refresher.fn,
    logger: overrides.logger ?? createLogger(),
    clientId: overrides.clientId,
  };
  return { service: new AuthService(deps), deps };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuthService", () => {
  describe("authenticate — Tier 1 (disk)", () => {
    test("valid stored creds → return immediately (no browser access)", async () => {
      // Given: storage has unexpired credentials
      const storage = createStorage(makeCredentials());
      const reader = new StubReader({ type: "null" });
      const { service } = buildService({
        storage: storage.port,
        browserReaders: [reader],
      });

      // When: authenticate
      const creds = await service.authenticate();

      // Then: returns stored creds and never touches browser readers
      expect(creds.accessToken).toBe("stored_access_token");
      expect(reader.calls).toBe(0);
      expect(storage.state.saveCalls.length).toBe(0);
    });

    test("expired stored creds → fall through to Tier 2", async () => {
      // Given: storage has expired credentials and a browser reader returns a token
      const storage = createStorage(makeCredentials({ expiresAt: Date.now() - 1000 }));
      const reader = new StubReader({
        type: "ok",
        value: {
          accessToken: "browser_access",
          refreshToken: "browser_refresh",
          browser: "Chrome",
        },
      });
      const refresher = createRefresher({ access_token: "fresh_from_browser" });
      const { service } = buildService({
        storage: storage.port,
        browserReaders: [reader],
        refreshAccessToken: refresher.fn,
      });

      // When: authenticate
      const creds = await service.authenticate();

      // Then: browser reader was consulted and creds came from it
      expect(reader.calls).toBe(1);
      expect(creds.accessToken).toBe("fresh_from_browser");
      expect(creds.source).toBe("indexeddb");
      expect(storage.state.saveCalls.length).toBe(1);
    });
  });

  describe("authenticate — Tier 2 (browser readers)", () => {
    test("first browser reader succeeds → save + return", async () => {
      // Given: no stored creds; first reader returns an extracted token
      const storage = createStorage(null);
      const r1 = new StubReader({
        type: "ok",
        value: {
          accessToken: "r1_access",
          refreshToken: "r1_refresh",
          browser: "Chrome",
        },
      });
      const r2 = new StubReader({ type: "null" });
      const refresher = createRefresher({ access_token: "exchanged_token" });
      const { service } = buildService({
        storage: storage.port,
        browserReaders: [r1, r2],
        refreshAccessToken: refresher.fn,
      });

      // When: authenticate
      const creds = await service.authenticate();

      // Then: first reader used, second untouched, creds saved
      expect(r1.calls).toBe(1);
      expect(r2.calls).toBe(0);
      expect(creds.accessToken).toBe("exchanged_token");
      expect(storage.state.saveCalls.length).toBe(1);
      expect(storage.state.saveCalls[0].source).toBe("indexeddb");
    });

    test("first throws, second returns null, third succeeds → resilience", async () => {
      // Given: a throwing reader, a null-returning reader, and a successful one
      const storage = createStorage(null);
      const r1 = new StubReader({ type: "throw", err: new Error("locked db") });
      const r2 = new StubReader({ type: "null" });
      const r3 = new StubReader({
        type: "ok",
        value: { accessToken: "cookie_access", browser: "Brave" },
      });
      const { service } = buildService({
        storage: storage.port,
        browserReaders: [r1, r2, r3],
      });

      // When: authenticate
      const creds = await service.authenticate();

      // Then: every reader was given a chance and the last produced a result
      expect(r1.calls).toBe(1);
      expect(r2.calls).toBe(1);
      expect(r3.calls).toBe(1);
      expect(creds.accessToken).toBe("cookie_access");
      expect(creds.source).toBe("cookie");
      expect(creds.refreshToken).toBe("");
      expect(storage.state.saveCalls.length).toBe(1);
    });

    test("all readers return null → fall through to Tier 4 throw", async () => {
      // Given: every reader returns null
      const storage = createStorage(null);
      const r1 = new StubReader({ type: "null" });
      const r2 = new StubReader({ type: "null" });
      const { service } = buildService({
        storage: storage.port,
        browserReaders: [r1, r2],
      });

      // When/Then: throws AuthSourceMissingError
      await expect(service.authenticate()).rejects.toBeInstanceOf(AuthSourceMissingError);
      expect(r1.calls).toBe(1);
      expect(r2.calls).toBe(1);
    });
  });

  describe("authenticate — Tier 4 (final)", () => {
    test("no stored creds + no readers → throws AuthSourceMissingError", async () => {
      // Given: empty storage and empty readers
      const { service } = buildService();

      // When/Then: throws AuthSourceMissingError
      await expect(service.authenticate()).rejects.toBeInstanceOf(AuthSourceMissingError);
    });
  });

  describe("withAuth", () => {
    test("401 → refresh → retry succeeds", async () => {
      // Given: valid stored creds and an operation that fails 401 once then succeeds
      const storage = createStorage(makeCredentials());
      const refresher = createRefresher({ access_token: "refreshed_for_retry" });
      const { service } = buildService({
        storage: storage.port,
        refreshAccessToken: refresher.fn,
      });
      let attempts = 0;
      const op = async (token: string) => {
        attempts++;
        if (attempts === 1) {
          throw new NetworkError("unauthorized", 401);
        }
        return token;
      };

      // When: withAuth runs the operation
      const result = await service.withAuth(op);

      // Then: refresh was called once and the retry used the new token
      expect(attempts).toBe(2);
      expect(refresher.state.calls).toEqual(["stored_refresh_token"]);
      expect(result).toBe("refreshed_for_retry");
      expect(storage.state.saveCalls.length).toBe(1);
      expect(storage.state.saveCalls[0].accessToken).toBe("refreshed_for_retry");
    });

    test("non-401 error → propagate without refresh", async () => {
      // Given: valid stored creds and an operation that throws a 500
      const storage = createStorage(makeCredentials());
      const refresher = createRefresher();
      const { service } = buildService({
        storage: storage.port,
        refreshAccessToken: refresher.fn,
      });
      const op = async () => {
        throw new NetworkError("server", 500);
      };

      // When/Then: error propagates and refresh was not called
      await expect(service.withAuth(op)).rejects.toBeInstanceOf(NetworkError);
      expect(refresher.state.calls.length).toBe(0);
    });

    test("401 on retry → propagate (no infinite loop)", async () => {
      // Given: valid stored creds and an operation that always returns 401
      const storage = createStorage(makeCredentials());
      const refresher = createRefresher({ access_token: "second_token" });
      const { service } = buildService({
        storage: storage.port,
        refreshAccessToken: refresher.fn,
      });
      let attempts = 0;
      const op = async () => {
        attempts++;
        throw new NetworkError("unauthorized", 401);
      };

      // When/Then: error after exactly two attempts
      await expect(service.withAuth(op)).rejects.toBeInstanceOf(NetworkError);
      expect(attempts).toBe(2);
      expect(refresher.state.calls.length).toBe(1);
    });

    test("Tier 2 recovery: refresh fails, disk reload produces fresh creds → retry succeeds", async () => {
      // Given: valid stored creds at start; refresh throws (expired refresh token);
      //        a parallel process "writes" new creds to disk between attempts.
      const initial = makeCredentials({ accessToken: "stale", refreshToken: "stale_refresh" });
      const parallelUpdate = makeCredentials({
        accessToken: "parallel_written",
        refreshToken: "parallel_refresh",
      });
      let reloadCount = 0;
      const storagePort: StoragePort = {
        async saveCredentials() {},
        async loadCredentials() {
          reloadCount++;
          // First call (authenticate) returns stale; subsequent calls (Tier 2 reload,
          // Tier 3 stored-lookup) return the creds the parallel process "wrote".
          return reloadCount === 1 ? initial : parallelUpdate;
        },
        async clearCredentials() {},
        getConfigDir: () => "/tmp/test",
      };
      const refresher = createRefresher();
      refresher.state.errorOnCall = { at: 1, err: new NetworkError("bad refresh", 401) };
      const { service } = buildService({
        storage: storagePort,
        refreshAccessToken: refresher.fn,
      });
      let attempts = 0;
      const op = async (token: string) => {
        attempts++;
        if (attempts === 1) throw new NetworkError("unauthorized", 401);
        return token;
      };

      // When: withAuth runs
      const result = await service.withAuth(op);

      // Then: retry used the parallel-written token (Tier 2)
      expect(result).toBe("parallel_written");
      expect(attempts).toBe(2);
      expect(refresher.state.calls.length).toBe(1);
    });

    test("Tier 3 recovery: refresh fails, disk unchanged, browser reader produces new creds → retry succeeds", async () => {
      // Given: stale stored creds, refresh fails, disk has nothing new,
      //        and a browser reader yields a fresh access token.
      const storage = createStorage(makeCredentials({ accessToken: "stale", refreshToken: "bad_refresh" }));
      const refresher = createRefresher();
      refresher.state.errorOnCall = { at: 1, err: new NetworkError("bad refresh", 401) };
      const reader = new StubReader({
        type: "ok",
        value: { accessToken: "browser_fresh", browser: "Safari" },
      });
      const { service } = buildService({
        storage: storage.port,
        browserReaders: [reader],
        refreshAccessToken: refresher.fn,
      });
      let attempts = 0;
      const op = async (token: string) => {
        attempts++;
        if (attempts === 1) throw new NetworkError("unauthorized", 401);
        return token;
      };

      // When: withAuth runs
      const result = await service.withAuth(op);

      // Then: Tier 3 reader was consulted and its token was used
      expect(reader.calls).toBe(1);
      expect(result).toBe("browser_fresh");
      expect(attempts).toBe(2);
    });

    test("all tiers exhausted: Tier 3 creds also 401 → AuthExpiredError", async () => {
      // Given: refresh succeeds (Tier 1), retry 401; disk reload matches Tier 1;
      //        Tier 3 reader yields new creds, retry also 401.
      const storage = createStorage(makeCredentials());
      const refresher = createRefresher({ access_token: "tier1_token" });
      const reader = new StubReader({
        type: "ok",
        value: { accessToken: "tier3_token", browser: "Safari" },
      });
      const { service } = buildService({
        storage: storage.port,
        browserReaders: [reader],
        refreshAccessToken: refresher.fn,
      });
      let attempts = 0;
      const op = async () => {
        attempts++;
        throw new NetworkError("unauthorized", 401);
      };

      // When/Then: AuthExpiredError after all recovery tiers exhausted
      await expect(service.withAuth(op)).rejects.toBeInstanceOf(AuthExpiredError);
      expect(attempts).toBe(3); // initial + Tier 1 retry + Tier 3 retry (Tier 2 skipped, disk matches)
      expect(reader.calls).toBe(1);
    });
  });

  describe("setManualToken", () => {
    test("exchanges + saves + returns creds with source=manual", async () => {
      // Given: a refresher that returns a brand-new access token
      const storage = createStorage(null);
      const refresher = createRefresher({
        access_token: "manual_access",
        refresh_token: "manual_refresh_in",
      });
      const { service } = buildService({
        storage: storage.port,
        refreshAccessToken: refresher.fn,
      });

      // When: setManualToken with a user-provided refresh token
      const creds = await service.setManualToken("user_provided_refresh");

      // Then: refresher was invoked, source is manual, creds saved
      expect(refresher.state.calls).toEqual(["user_provided_refresh"]);
      expect(creds.source).toBe("manual");
      expect(creds.accessToken).toBe("manual_access");
      expect(storage.state.saveCalls.length).toBe(1);
      expect(storage.state.saveCalls[0].source).toBe("manual");
    });

    test("rotation: response contains new refresh_token → new token saved", async () => {
      // Given: refresher returns a rotated refresh_token
      const storage = createStorage(null);
      const refresher = createRefresher({
        refresh_token: "rotated_refresh_token",
      });
      const { service } = buildService({
        storage: storage.port,
        refreshAccessToken: refresher.fn,
      });

      // When: setManualToken with the original token
      const creds = await service.setManualToken("original_user_token");

      // Then: stored refreshToken is the rotated one, not the original
      expect(creds.refreshToken).toBe("rotated_refresh_token");
      expect(storage.state.saveCalls[0].refreshToken).toBe("rotated_refresh_token");
    });
  });

  describe("getStatus", () => {
    test("authenticated state when creds valid", async () => {
      // Given: storage has unexpired creds
      const storage = createStorage(
        makeCredentials({
          expiresAt: Date.now() + 60_000,
          source: "manual",
        }),
      );
      const { service } = buildService({ storage: storage.port });

      // When: getStatus
      const status = await service.getStatus();

      // Then: reports authenticated
      expect(status.isAuthenticated).toBe(true);
      expect(status.isExpired).toBe(false);
      expect(status.source).toBe("manual");
      expect(status.expiresAt).toBeGreaterThan(Date.now());
    });

    test("expired state when creds past expiresAt", async () => {
      // Given: storage has expired creds
      const storage = createStorage(makeCredentials({ expiresAt: Date.now() - 1000, source: "cookie" }));
      const { service } = buildService({ storage: storage.port });

      // When: getStatus
      const status = await service.getStatus();

      // Then: reports expired
      expect(status.isAuthenticated).toBe(false);
      expect(status.isExpired).toBe(true);
      expect(status.source).toBe("cookie");
    });

    test("unauthenticated state when no creds saved", async () => {
      // Given: empty storage
      const { service } = buildService();

      // When: getStatus
      const status = await service.getStatus();

      // Then: reports unauthenticated with null fields
      expect(status.isAuthenticated).toBe(false);
      expect(status.isExpired).toBe(false);
      expect(status.source).toBeNull();
      expect(status.expiresAt).toBeNull();
    });
  });

  describe("logout", () => {
    test("clearCredentials called", async () => {
      // Given: storage has creds and is wired to AuthService
      const storage = createStorage(makeCredentials());
      const { service } = buildService({ storage: storage.port });

      // When: logout
      await service.logout();

      // Then: storage.clearCredentials was invoked exactly once
      expect(storage.state.clearCalls).toBe(1);
      expect(storage.state.current).toBeNull();
    });
  });

  describe("refresh mutex", () => {
    test("concurrent withAuth calls that both 401 result in only 1 refresh call", async () => {
      let refreshCallCount = 0;
      const refreshFn = async (_token: string): Promise<TokenRefreshResponse> => {
        refreshCallCount++;
        await new Promise((r) => setTimeout(r, 50));
        return {
          token_type: "Bearer",
          expires_in: 3600,
          access_token: "new_access",
          refresh_token: "new_refresh",
        };
      };
      const storage = createStorage(makeCredentials());
      const service = new AuthService({
        storage: storage.port,
        browserReaders: [],
        refreshAccessToken: refreshFn,
        logger: createLogger(),
      });

      const alwaysFail401First = async (token: string): Promise<string> => {
        if (token === "stored_access_token") {
          throw new NetworkError("unauthorized", 401);
        }
        return `ok:${token}`;
      };

      await Promise.all([service.withAuth(alwaysFail401First), service.withAuth(alwaysFail401First)]);

      expect(refreshCallCount).toBe(1);
    });
  });
});
