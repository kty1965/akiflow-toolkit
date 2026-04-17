// ---------------------------------------------------------------------------
// AuthService — central authentication orchestrator (ADR-0003, ADR-0006, ADR-0011)
// 4-tier hierarchical authentication: disk → browser readers → CDP (stub) → manual
// ---------------------------------------------------------------------------

import { AuthExpiredError, AuthSourceMissingError, NetworkError } from "../errors/index.ts";
import type { BrowserDataPort } from "../ports/browser-data-port.ts";
import type { LoggerPort } from "../ports/logger-port.ts";
import type { StoragePort } from "../ports/storage-port.ts";
import type { AuthStatus, Credentials, ExtractedToken, TokenRefreshResponse } from "../types.ts";

const FALLBACK_TTL_MS = 30 * 60 * 1000;

export interface AuthServiceDeps {
  storage: StoragePort;
  browserReaders: BrowserDataPort[];
  refreshAccessToken: (refreshToken: string) => Promise<TokenRefreshResponse>;
  logger: LoggerPort;
  clientId?: string;
}

export class AuthService {
  private refreshPromise: Promise<TokenRefreshResponse> | null = null;

  constructor(private readonly deps: AuthServiceDeps) {}

  private refreshOnce(refreshToken: string): Promise<TokenRefreshResponse> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.deps.refreshAccessToken(refreshToken).finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  async authenticate(): Promise<Credentials> {
    const stored = await this.deps.storage.loadCredentials();
    if (stored && !this.isExpired(stored)) return stored;

    for (const reader of this.deps.browserReaders) {
      try {
        const extracted = await reader.extract();
        if (extracted) {
          const creds = await this.tokensToCredentials(extracted, stored);
          await this.deps.storage.saveCredentials(creds);
          return creds;
        }
      } catch (err) {
        this.deps.logger.debug("browser reader failed", {
          reader: reader.constructor.name,
          err: String(err),
        });
      }
    }

    this.deps.logger.debug("CDP login not yet implemented (TASK-18)");

    throw new AuthSourceMissingError("all sources exhausted");
  }

  /**
   * Run `fn(accessToken)` with ADR-0003 Tier 1-3 automatic recovery:
   *   Tier 1 — refresh access token via refresh_token grant.
   *   Tier 2 — reload creds from disk (detects parallel-process refresh).
   *   Tier 3 — re-extract creds from browser readers.
   * Rethrows the original 401 if no tier produced fresh credentials; throws
   * AuthExpiredError only after Tier 3 actually produced new creds that also 401'd.
   */
  async withAuth<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const creds = await this.authenticate();
    return this.executeWithRecovery(fn, creds);
  }

  private async executeWithRecovery<T>(fn: (token: string) => Promise<T>, initialCreds: Credentials): Promise<T> {
    let lastCreds = initialCreds;
    let lastUnauthorized: NetworkError;
    try {
      return await fn(lastCreds.accessToken);
    } catch (err) {
      if (!isUnauthorized(err)) throw err;
      lastUnauthorized = err;
    }

    // Tier 1 — refresh access token
    const tier1 = await this.recoverTier1Refresh(lastCreds);
    if (tier1) {
      try {
        return await fn(tier1.accessToken);
      } catch (err) {
        if (!isUnauthorized(err)) throw err;
        lastCreds = tier1;
        lastUnauthorized = err;
      }
    }

    // Tier 2 — reload from disk (parallel process may have refreshed)
    const tier2 = await this.recoverTier2Reload(lastCreds);
    if (tier2) {
      try {
        return await fn(tier2.accessToken);
      } catch (err) {
        if (!isUnauthorized(err)) throw err;
        lastCreds = tier2;
        lastUnauthorized = err;
      }
    }

    // Tier 3 — re-extract from browser readers
    const tier3 = await this.recoverTier3Browser();
    if (tier3) {
      try {
        return await fn(tier3.accessToken);
      } catch (err) {
        if (!isUnauthorized(err)) throw err;
        // Tier 3 produced fresh creds and they still 401 — auth is genuinely expired.
        throw new AuthExpiredError("all recovery tiers exhausted after browser re-extract");
      }
    }

    // No tier produced new creds — propagate the original 401 so callers can see the status.
    throw lastUnauthorized;
  }

  private async recoverTier1Refresh(creds: Credentials): Promise<Credentials | null> {
    if (!creds.refreshToken) return null;
    try {
      const refreshed = await this.refreshOnce(creds.refreshToken);
      const newCreds: Credentials = {
        ...creds,
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token ?? creds.refreshToken,
        expiresAt: Date.now() + refreshed.expires_in * 1000,
        savedAt: new Date().toISOString(),
      };
      await this.deps.storage.saveCredentials(newCreds);
      return newCreds;
    } catch (err) {
      this.deps.logger.debug("[auth] tier 1 refresh failed", { err: String(err) });
      return null;
    }
  }

  private async recoverTier2Reload(lastTried: Credentials): Promise<Credentials | null> {
    const reloaded = await this.deps.storage.loadCredentials();
    if (!reloaded) return null;
    if (reloaded.accessToken === lastTried.accessToken) return null;
    if (this.isExpired(reloaded)) return null;
    return reloaded;
  }

  private async recoverTier3Browser(): Promise<Credentials | null> {
    const stored = await this.deps.storage.loadCredentials();
    for (const reader of this.deps.browserReaders) {
      try {
        const extracted = await reader.extract();
        if (!extracted) continue;
        const newCreds = await this.tokensToCredentials(extracted, stored);
        await this.deps.storage.saveCredentials(newCreds);
        return newCreds;
      } catch (err) {
        this.deps.logger.debug("[auth] tier 3 browser reader failed", {
          reader: reader.constructor.name,
          err: String(err),
        });
      }
    }
    return null;
  }

  async setManualToken(refreshToken: string): Promise<Credentials> {
    const refreshed = await this.deps.refreshAccessToken(refreshToken);
    const clientId = await this.resolveClientId();
    const creds: Credentials = {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? refreshToken,
      clientId,
      expiresAt: Date.now() + refreshed.expires_in * 1000,
      savedAt: new Date().toISOString(),
      source: "manual",
    };
    await this.deps.storage.saveCredentials(creds);
    return creds;
  }

  async getStatus(): Promise<AuthStatus> {
    const stored = await this.deps.storage.loadCredentials();
    if (!stored) {
      return {
        isAuthenticated: false,
        expiresAt: null,
        source: null,
        isExpired: false,
      };
    }
    const expired = this.isExpired(stored);
    return {
      isAuthenticated: !expired,
      expiresAt: stored.expiresAt,
      source: stored.source,
      isExpired: expired,
    };
  }

  async logout(): Promise<void> {
    await this.deps.storage.clearCredentials();
  }

  private isExpired(creds: Credentials): boolean {
    return creds.expiresAt <= Date.now();
  }

  private async tokensToCredentials(extracted: ExtractedToken, existing: Credentials | null): Promise<Credentials> {
    const clientId = this.deps.clientId ?? existing?.clientId ?? crypto.randomUUID();
    const source: Credentials["source"] = extracted.refreshToken ? "indexeddb" : "cookie";
    const savedAt = new Date().toISOString();

    if (extracted.refreshToken) {
      const refreshed = await this.refreshOnce(extracted.refreshToken);
      return {
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token ?? extracted.refreshToken,
        clientId,
        expiresAt: Date.now() + refreshed.expires_in * 1000,
        savedAt,
        source,
      };
    }

    const expFromExtract = extracted.expiresAt ? extracted.expiresAt * 1000 : null;
    const expFromJwt = decodeJwtExp(extracted.accessToken);
    const expiresAt = expFromExtract ?? expFromJwt ?? Date.now() + FALLBACK_TTL_MS;

    return {
      accessToken: extracted.accessToken,
      refreshToken: "",
      clientId,
      expiresAt,
      savedAt,
      source,
    };
  }

  private async resolveClientId(): Promise<string> {
    if (this.deps.clientId) return this.deps.clientId;
    const existing = await this.deps.storage.loadCredentials();
    if (existing?.clientId) return existing.clientId;
    return crypto.randomUUID();
  }
}

function isUnauthorized(err: unknown): err is NetworkError {
  return err instanceof NetworkError && err.status === 401;
}

function decodeJwtExp(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (padded.length % 4)) % 4;
    const json = atob(padded + "=".repeat(padLen));
    const payload = JSON.parse(json) as { exp?: number };
    if (typeof payload.exp !== "number") return null;
    return payload.exp * 1000;
  } catch {
    return null;
  }
}
