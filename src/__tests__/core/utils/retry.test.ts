import { describe, expect, test } from "bun:test";
import { NetworkError } from "../../../core/errors/index.ts";
import { type RetryPolicy, computeDelay, withRetry } from "../../../core/utils/retry.ts";

const fastPolicy: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 1,
  maxDelayMs: 10,
  multiplier: 2,
  jitter: "none",
  retryable: (err) => err instanceof NetworkError && (err.status ?? 0) >= 500,
};

describe("core/utils/retry", () => {
  describe("withRetry", () => {
    test("returns value on first success without retrying", async () => {
      // Given: a function that succeeds immediately
      let calls = 0;
      const fn = async () => {
        calls++;
        return "ok";
      };

      // When: executed with retry
      const result = await withRetry(fn, fastPolicy);

      // Then: returns the value and was called exactly once
      expect(result).toBe("ok");
      expect(calls).toBe(1);
    });

    test("retries transient failure then succeeds", async () => {
      // Given: a function that fails twice then succeeds
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 3) throw new NetworkError("temp", 503);
        return "recovered";
      };

      // When: executed with retry policy allowing 3 attempts
      const result = await withRetry(fn, fastPolicy);

      // Then: succeeded after retrying
      expect(result).toBe("recovered");
      expect(attempts).toBe(3);
    });

    test("throws after max attempts exceeded", async () => {
      // Given: a function that always fails with a retryable error
      const fn = async () => {
        throw new NetworkError("always fails", 500);
      };

      // When/Then: throws after maxAttempts
      await expect(withRetry(fn, fastPolicy)).rejects.toThrow("always fails");
    });

    test("throws immediately on non-retryable error", async () => {
      // Given: a function that throws a non-retryable error
      let attempts = 0;
      const fn = async () => {
        attempts++;
        throw new Error("not retryable");
      };

      // When/Then: throws immediately without retrying
      await expect(withRetry(fn, fastPolicy)).rejects.toThrow("not retryable");
      expect(attempts).toBe(1);
    });

    test("calls onRetry callback with correct arguments", async () => {
      // Given: a policy with an onRetry callback
      const retryLog: Array<{ attempt: number; delay: number }> = [];
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 2) throw new NetworkError("temp", 500);
        return "ok";
      };
      const policy: RetryPolicy = {
        ...fastPolicy,
        maxAttempts: 3,
        onRetry: (attempt, _err, delayMs) => {
          retryLog.push({ attempt, delay: delayMs });
        },
      };

      // When: executed
      await withRetry(fn, policy);

      // Then: onRetry was called once with attempt=1
      expect(retryLog).toHaveLength(1);
      expect(retryLog[0].attempt).toBe(1);
    });
  });

  describe("computeDelay", () => {
    test("'none' jitter returns exact exponential value", () => {
      // Given: a policy with no jitter
      const policy: RetryPolicy = { ...fastPolicy, baseDelayMs: 100, maxDelayMs: 5000, multiplier: 2, jitter: "none" };

      // When: computing delays for consecutive attempts
      const d1 = computeDelay(1, policy);
      const d2 = computeDelay(2, policy);
      const d3 = computeDelay(3, policy);

      // Then: delays follow exact exponential progression
      expect(d1).toBe(100); // 100 * 2^0
      expect(d2).toBe(200); // 100 * 2^1
      expect(d3).toBe(400); // 100 * 2^2
    });

    test("delay is capped at maxDelayMs", () => {
      // Given: a policy where exponential growth would exceed max
      const policy: RetryPolicy = { ...fastPolicy, baseDelayMs: 1000, maxDelayMs: 3000, multiplier: 2, jitter: "none" };

      // When: computing delay for a late attempt
      const d5 = computeDelay(5, policy);

      // Then: delay is capped
      expect(d5).toBe(3000);
    });

    test("'full' jitter produces values in [0, expo]", () => {
      // Given: a policy with full jitter
      const policy: RetryPolicy = { ...fastPolicy, baseDelayMs: 100, maxDelayMs: 5000, multiplier: 2, jitter: "full" };

      // When: sampling many delays
      const samples = Array.from({ length: 100 }, () => computeDelay(1, policy));

      // Then: all values are in [0, 100]
      for (const s of samples) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
      }
    });

    test("'equal' jitter produces values in [expo/2, expo]", () => {
      // Given: a policy with equal jitter
      const policy: RetryPolicy = { ...fastPolicy, baseDelayMs: 100, maxDelayMs: 5000, multiplier: 2, jitter: "equal" };

      // When: sampling many delays
      const samples = Array.from({ length: 100 }, () => computeDelay(1, policy));

      // Then: all values are in [50, 100]
      for (const s of samples) {
        expect(s).toBeGreaterThanOrEqual(50);
        expect(s).toBeLessThanOrEqual(100);
      }
    });
  });
});
