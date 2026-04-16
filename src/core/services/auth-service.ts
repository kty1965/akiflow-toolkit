// ---------------------------------------------------------------------------
// AuthService — central authentication orchestrator (ADR-0003, ADR-0006, ADR-0011)
// 4-tier hierarchical authentication: disk → browser readers → CDP (stub) → manual
// ---------------------------------------------------------------------------

import { AuthSourceMissingError, NetworkError } from "../errors/index.ts";
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
  constructor(private readonly deps: AuthServiceDeps) {}

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

  async withAuth<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const creds = await this.authenticate();
    try {
      return await fn(creds.accessToken);
    } catch (err) {
      if (err instanceof NetworkError && err.status === 401) {
        const refreshed = await this.deps.refreshAccessToken(creds.refreshToken);
        const newCreds: Credentials = {
          ...creds,
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token ?? creds.refreshToken,
          expiresAt: Date.now() + refreshed.expires_in * 1000,
          savedAt: new Date().toISOString(),
        };
        await this.deps.storage.saveCredentials(newCreds);
        return fn(newCreds.accessToken);
      }
      throw err;
    }
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
      const refreshed = await this.deps.refreshAccessToken(extracted.refreshToken);
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
