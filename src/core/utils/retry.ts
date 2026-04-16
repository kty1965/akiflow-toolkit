// ---------------------------------------------------------------------------
// Generic retry utility — ADR-0014
// Exponential backoff + jitter (AWS full jitter recommended)
// core/ has ZERO external dependency imports (ADR-0006)
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
  jitter: "full" | "equal" | "none";
  retryable: (err: unknown) => boolean;
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function computeDelay(attempt: number, policy: RetryPolicy): number {
  const expo = Math.min(policy.baseDelayMs * policy.multiplier ** (attempt - 1), policy.maxDelayMs);
  switch (policy.jitter) {
    case "none":
      return expo;
    case "equal":
      return expo / 2 + Math.random() * (expo / 2);
    case "full":
      return Math.random() * expo;
  }
}

export async function withRetry<T>(fn: () => Promise<T>, policy: RetryPolicy): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === policy.maxAttempts || !policy.retryable(err)) throw err;
      const delay = computeDelay(attempt, policy);
      policy.onRetry?.(attempt, err, delay);
      await sleep(delay);
    }
  }
  throw lastErr;
}
