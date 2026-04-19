import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserProfile } from "@core/browser-paths.ts";
import type { BrowserDataPort } from "@core/ports/browser-data-port.ts";
import type { LoggerPort } from "@core/ports/logger-port.ts";
import type { ExtractedToken } from "@core/types.ts";

// JWT: three base64url segments separated by dots
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
// Akiflow refresh token pattern (Laravel Passport encrypted token) — non-global: first match only
const REFRESH_RE = /def50200[a-f0-9]{200,}/;

/** Decode base64url → UTF-8 string */
function base64urlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf-8");
}

/** Parse JWT payload, return null on failure */
function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(base64urlDecode(parts[1]));
  } catch {
    return null;
  }
}

/** Check if JWT is expired (exp is in seconds since epoch) */
function isExpired(payload: Record<string, unknown>): boolean {
  const exp = payload.exp;
  if (typeof exp !== "number") return false; // no exp → treat as valid
  return exp * 1000 < Date.now();
}

export class IndexedDbReader implements BrowserDataPort {
  constructor(
    private readonly browser: BrowserProfile,
    private readonly logger: LoggerPort,
  ) {}

  async extract(): Promise<ExtractedToken | null> {
    const paths = this.browser.indexedDbPaths;
    if (paths.length === 0) {
      this.logger.debug(`[indexeddb] ${this.browser.name}: no candidate paths configured`);
      return null;
    }

    for (const dbPath of paths) {
      const result = this.extractFromPath(dbPath);
      if (result) return result;
    }
    return null;
  }

  private extractFromPath(dbPath: string): ExtractedToken | null {
    if (!existsSync(dbPath)) {
      this.logger.debug(`[indexeddb] ${this.browser.name}: path not found ${dbPath}`);
      return null;
    }

    let files: string[];
    try {
      files = readdirSync(dbPath).filter((f) => f.endsWith(".log") || f.endsWith(".ldb"));
    } catch {
      this.logger.debug(`[indexeddb] ${this.browser.name}: cannot read directory ${dbPath}`);
      return null;
    }

    if (files.length === 0) {
      this.logger.debug(`[indexeddb] ${this.browser.name}: no .log/.ldb files in ${dbPath}`);
      return null;
    }

    const jwts: { token: string; exp: number }[] = [];
    let refreshToken: string | undefined;

    for (const file of files) {
      let content: string;
      try {
        // LevelDB files are binary; read as latin1 to preserve byte values
        content = readFileSync(join(dbPath, file), "latin1");
      } catch {
        continue;
      }

      // Extract JWTs
      for (const match of content.matchAll(JWT_RE)) {
        const jwt = match[0];
        const payload = decodeJwtPayload(jwt);
        if (!payload) continue;
        if (isExpired(payload)) continue;
        const exp = typeof payload.exp === "number" ? payload.exp : 0;
        jwts.push({ token: jwt, exp });
      }

      // Extract refresh tokens
      if (!refreshToken) {
        const refreshMatch = REFRESH_RE.exec(content);
        if (refreshMatch) {
          refreshToken = refreshMatch[0];
        }
      }
    }

    if (jwts.length === 0) {
      this.logger.debug(`[indexeddb] ${this.browser.name}: no valid JWTs in ${dbPath}`);
      return null;
    }

    // Sort by exp descending → pick newest
    jwts.sort((a, b) => b.exp - a.exp);
    const best = jwts[0];

    this.logger.info(`[indexeddb] ${this.browser.name}: found token (exp=${best.exp}) in ${dbPath}`);
    return {
      accessToken: best.token,
      refreshToken,
      expiresAt: best.exp || undefined,
      browser: this.browser.name,
    };
  }
}
