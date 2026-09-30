import { describe, expect, test } from "bun:test";
import { AuthSourceMissingError } from "@core/errors/index.ts";
import type { LoggerPort } from "@core/ports/logger-port.ts";
import { PROACTIVE_REFRESH_SKEW_MS } from "@core/services/auth-service.ts";
import type { Credentials } from "@core/types.ts";
import {
  AuthKeepAlive,
  KEEP_ALIVE_MAX_INTERVAL_MS,
  KEEP_ALIVE_MIN_INTERVAL_MS,
  KEEP_ALIVE_RETRY_INTERVAL_MS,
} from "@mcp/auth-keep-alive.ts";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

const NOW = 1_700_000_000_000;

function createLogger(): LoggerPort & { debugCalls: string[] } {
  const debugCalls: string[] = [];
  return {
    debugCalls,
    trace: () => {},
    debug: (message: string) => {
      debugCalls.push(message);
    },
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function makeCredentials(expiresAt: number): Credentials {
  return {
    accessToken: "access",
    refreshToken: "refresh",
    clientId: "client",
    expiresAt,
    savedAt: new Date(NOW).toISOString(),
    source: "indexeddb",
  };
}

type TimerHandle = ReturnType<typeof setTimeout>;

function createFakeTimers(): {
  setTimer: (fn: () => void, ms: number) => TimerHandle;
  clearTimer: (handle: TimerHandle) => void;
  scheduled: { fn: () => void; ms: number; cleared: boolean }[];
  fireLatest: () => void;
} {
  const scheduled: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const byHandle = new Map<TimerHandle, { fn: () => void; ms: number; cleared: boolean }>();
  return {
    scheduled,
    setTimer: (fn, ms) => {
      const entry = { fn, ms, cleared: false };
      const handle = setTimeout(() => {}, 0);
      clearTimeout(handle);
      scheduled.push(entry);
      byHandle.set(handle, entry);
      return handle;
    },
    clearTimer: (handle) => {
      const entry = byHandle.get(handle);
      if (entry) entry.cleared = true;
    },
    fireLatest: () => {
      scheduled[scheduled.length - 1].fn();
    },
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuthKeepAlive", () => {
  describe("tick", () => {
    test("fresh 30-minute token → next tick capped at the 25-minute maximum", async () => {
      // Given: authenticate returns a token that expires in 30 minutes
      const expiresAt = NOW + 30 * 60 * 1000;
      const keepAlive = new AuthKeepAlive({
        auth: { authenticate: async () => makeCredentials(expiresAt) },
        logger: createLogger(),
        now: () => NOW,
      });

      // When: tick
      const next = await keepAlive.tick();

      // Then: 28 minutes + 1s until the window opens, capped at the 25-minute maximum
      expect(next).toBe(KEEP_ALIVE_MAX_INTERVAL_MS);
    });

    test("token expiring in 10 minutes → wakes right after the skew window opens", async () => {
      // Given: a token with 10 minutes left
      const expiresAt = NOW + 10 * 60 * 1000;
      const keepAlive = new AuthKeepAlive({
        auth: { authenticate: async () => makeCredentials(expiresAt) },
        logger: createLogger(),
        now: () => NOW,
      });

      // When: tick
      const next = await keepAlive.tick();

      // Then: the next authenticate() call will see the token inside the skew window
      expect(next).toBe(10 * 60 * 1000 - PROACTIVE_REFRESH_SKEW_MS + 1000);
      expect(expiresAt - (NOW + next)).toBeLessThan(PROACTIVE_REFRESH_SKEW_MS);
    });

    test("token already inside the window (no refresh token) → never faster than the minimum interval", async () => {
      // Given: authenticate hands back a still-valid token 30s from expiry
      const keepAlive = new AuthKeepAlive({
        auth: { authenticate: async () => makeCredentials(NOW + 30 * 1000) },
        logger: createLogger(),
        now: () => NOW,
      });

      // When: tick
      const next = await keepAlive.tick();

      // Then: clamped to the minimum so it cannot spin
      expect(next).toBe(KEEP_ALIVE_MIN_INTERVAL_MS);
    });

    test("authenticate throws → error swallowed, retry interval returned", async () => {
      // Given: no credentials available (headless, logged out)
      const logger = createLogger();
      const keepAlive = new AuthKeepAlive({
        auth: {
          authenticate: async () => {
            throw new AuthSourceMissingError("all sources exhausted");
          },
        },
        logger,
        now: () => NOW,
      });

      // When: tick
      const next = await keepAlive.tick();

      // Then: no throw, logged, and retried later
      expect(next).toBe(KEEP_ALIVE_RETRY_INTERVAL_MS);
      expect(logger.debugCalls).toEqual(["[auth] keep-alive refresh failed"]);
    });
  });

  describe("start / stop", () => {
    test("start → immediate tick, then reschedules from the returned credentials", async () => {
      // Given: fake timers and a token with 10 minutes left
      const timers = createFakeTimers();
      let calls = 0;
      const keepAlive = new AuthKeepAlive({
        auth: {
          authenticate: async () => {
            calls++;
            return makeCredentials(NOW + 10 * 60 * 1000);
          },
        },
        logger: createLogger(),
        now: () => NOW,
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
      });

      // When: started and the first timer fires
      keepAlive.start();
      expect(timers.scheduled[0].ms).toBe(0);
      timers.fireLatest();
      await flush();

      // Then: authenticated once and the next wake-up is scheduled
      expect(calls).toBe(1);
      expect(timers.scheduled.length).toBe(2);
      expect(timers.scheduled[1].ms).toBe(10 * 60 * 1000 - PROACTIVE_REFRESH_SKEW_MS + 1000);
      keepAlive.stop();
    });

    test("start twice → only one timer chain", () => {
      // Given: fake timers
      const timers = createFakeTimers();
      const keepAlive = new AuthKeepAlive({
        auth: { authenticate: async () => makeCredentials(NOW + 60 * 60 * 1000) },
        logger: createLogger(),
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
      });

      // When: start is called twice
      keepAlive.start();
      keepAlive.start();

      // Then: a single timer was scheduled
      expect(timers.scheduled.length).toBe(1);
      keepAlive.stop();
    });

    test("stop → pending timer cleared and an in-flight tick does not reschedule", async () => {
      // Given: a started keep-alive whose first timer has fired
      const timers = createFakeTimers();
      const keepAlive = new AuthKeepAlive({
        auth: { authenticate: async () => makeCredentials(NOW + 60 * 60 * 1000) },
        logger: createLogger(),
        now: () => NOW,
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
      });
      keepAlive.start();
      timers.fireLatest();

      // When: stopped before the tick resolves
      keepAlive.stop();
      await flush();

      // Then: the timer was cleared and nothing new was scheduled
      expect(timers.scheduled[0].cleared).toBe(true);
      expect(timers.scheduled.length).toBe(1);
    });
  });
});
