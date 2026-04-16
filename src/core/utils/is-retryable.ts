// ---------------------------------------------------------------------------
// Error classification for retry decisions — ADR-0014
// core/ has ZERO external dependency imports (ADR-0006)
// ---------------------------------------------------------------------------

import { AuthError, NetworkError, ValidationError } from "../errors/index.ts";

export function isRetryable(err: unknown): boolean {
  if (err instanceof NetworkError) {
    return !err.status || err.status >= 500 || err.status === 429;
  }
  if (err instanceof AuthError) return false;
  if (err instanceof ValidationError) return false;
  return false;
}
