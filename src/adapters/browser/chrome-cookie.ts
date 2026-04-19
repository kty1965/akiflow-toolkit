import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { existsSync } from "node:fs";
import type { BrowserProfile } from "@core/browser-paths.ts";
import type { BrowserDataPort } from "@core/ports/browser-data-port.ts";
import type { LoggerPort } from "@core/ports/logger-port.ts";
import type { ExtractedToken } from "@core/types.ts";

const PBKDF2_SALT = "saltysalt";
const PBKDF2_ITERATIONS = 1003;
const PBKDF2_KEYLEN = 16;
const PBKDF2_DIGEST = "sha1";
// Chrome on macOS uses 16 bytes of 0x20 (space) as IV
const AES_IV = Buffer.alloc(16, 0x20);

// Bearer-usable token patterns. A decrypted Laravel `remember_web_*` cookie
// is a session payload for the Laravel backend — NOT an API Bearer — so we
// only keep the value if it embeds an actual JWT or a Laravel Passport
// refresh token that `AuthService.refreshOnce` can exchange for a JWT.
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const REFRESH_PATTERN = /def50200[a-f0-9]{200,}/;

/**
 * Retrieve Chrome Safe Storage password from macOS Keychain.
 *
 * Uses `execFileSync` (argv array) instead of `execSync` (shell) so that the
 * `service` argument — which is currently a hardcoded constant but could
 * become dynamic in the future — cannot be weaponized for shell injection.
 */
function getKeychainPassword(service: string): string {
  return execFileSync("security", ["find-generic-password", "-s", service, "-w"], {
    encoding: "utf-8",
  }).trim();
}

/** Derive AES key from Keychain password using PBKDF2 */
function deriveKey(password: string): Buffer {
  return pbkdf2Sync(password, PBKDF2_SALT, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
}

/** Remove PKCS7 padding */
function removePkcs7Padding(buf: Buffer): Buffer {
  if (buf.length === 0) return buf;
  const padLen = buf[buf.length - 1];
  if (padLen < 1 || padLen > 16) return buf;
  return buf.subarray(0, buf.length - padLen);
}

/** Decrypt Chrome cookie value (v10/v11 prefix on macOS) */
function decryptCookieValue(encrypted: Buffer, key: Buffer): string | null {
  // v10 and v11 prefix = 3 bytes ("v10" or "v11")
  const prefix = encrypted.subarray(0, 3).toString("ascii");
  if (prefix !== "v10" && prefix !== "v11") return null;

  const ciphertext = encrypted.subarray(3);
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, AES_IV);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return removePkcs7Padding(decrypted).toString("utf-8");
  } catch {
    return null;
  }
}

export class ChromeCookieReader implements BrowserDataPort {
  constructor(
    private readonly browser: BrowserProfile,
    private readonly logger: LoggerPort,
  ) {}

  async extract(): Promise<ExtractedToken | null> {
    if (!existsSync(this.browser.cookiesDb)) {
      this.logger.debug(`[cookie] ${this.browser.name}: Cookies DB not found`);
      return null;
    }

    // Step 1: Get Keychain password (may trigger macOS security prompt)
    let keychainPassword: string;
    try {
      keychainPassword = getKeychainPassword(this.browser.keychainService);
    } catch {
      this.logger.warn(`[cookie] ${this.browser.name}: Keychain access failed — skipping cookie extraction`);
      return null;
    }

    const key = deriveKey(keychainPassword);

    // Step 2: Query Cookies DB for akiflow.com remember_web_* cookies
    let db: Database;
    try {
      db = new Database(this.browser.cookiesDb, { readonly: true });
    } catch {
      this.logger.debug(`[cookie] ${this.browser.name}: cannot open Cookies DB`);
      return null;
    }

    try {
      const rows = db
        .query(
          `SELECT name, encrypted_value, host_key
           FROM cookies
           WHERE host_key LIKE '%akiflow.com'
             AND name LIKE 'remember_web_%'
           ORDER BY last_access_utc DESC`,
        )
        .all() as { name: string; encrypted_value: Buffer; host_key: string }[];

      if (rows.length === 0) {
        this.logger.debug(`[cookie] ${this.browser.name}: no akiflow remember_web cookies found`);
        return null;
      }

      for (const row of rows) {
        const value = decryptCookieValue(Buffer.from(row.encrypted_value), key);
        if (!value) continue;

        // Security (SECURITY-AUDIT-REPORT S-5): never attribute a raw Laravel
        // session cookie to accessToken. Only surface a token if a JWT or
        // refresh token is embedded in the decrypted payload.
        const jwt = value.match(JWT_PATTERN)?.[0];
        const refresh = value.match(REFRESH_PATTERN)?.[0];

        if (!jwt && !refresh) {
          this.logger.debug(
            `[cookie] ${this.browser.name}: ${row.name} decrypted to a Laravel session payload with no Bearer-usable token — skipping`,
          );
          continue;
        }

        this.logger.info(
          `[cookie] ${this.browser.name}: extracted Bearer-capable token from ${row.name} (jwt=${!!jwt}, refresh=${!!refresh})`,
        );
        return {
          accessToken: jwt ?? "",
          refreshToken: refresh,
          browser: this.browser.name,
        };
      }

      this.logger.debug(`[cookie] ${this.browser.name}: no cookie yielded a usable Bearer token`);
      return null;
    } finally {
      db.close();
    }
  }
}

// Re-export helpers for testing
export {
  decryptCookieValue as _decryptCookieValue,
  deriveKey as _deriveKey,
  removePkcs7Padding as _removePkcs7Padding,
};
