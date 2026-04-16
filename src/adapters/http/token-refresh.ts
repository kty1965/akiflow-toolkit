// ---------------------------------------------------------------------------
// Token refresh adapter — ADR-0003 Recovery Layer 1
// POST /oauth/refreshToken → TokenRefreshResponse
// ---------------------------------------------------------------------------

import { AuthExpiredError, NetworkError } from "../../core/errors/index.ts";
import type { TokenRefreshResponse } from "../../core/types.ts";
import { isRetryable } from "../../core/utils/is-retryable.ts";
import { type RetryPolicy, withRetry } from "../../core/utils/retry.ts";

const TOKEN_URL = "https://web.akiflow.com/oauth/refreshToken";
const CLIENT_ID = "10";

const refreshRetryPolicy: RetryPolicy = {
  maxAttempts: 2,
  baseDelayMs: 500,
  maxDelayMs: 3000,
  multiplier: 2,
  jitter: "full",
  retryable: isRetryable,
};

export async function refreshAccessToken(refreshToken: string): Promise<TokenRefreshResponse> {
  return withRetry(async () => {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID, refresh_token: refreshToken }),
    });

    if (res.status === 401 || res.status === 403) {
      throw new AuthExpiredError(`Token refresh rejected: ${res.status}`);
    }

    if (res.status >= 500) {
      throw new NetworkError(`Token refresh server error: ${res.status}`, res.status);
    }

    if (!res.ok) {
      throw new NetworkError(`Token refresh failed: ${res.status}`, res.status);
    }

    return (await res.json()) as TokenRefreshResponse;
  }, refreshRetryPolicy);
}
