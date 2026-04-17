import { Database } from "bun:sqlite";
import { execSync } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { existsSync } from "node:fs";
import type { BrowserProfile } from "../../core/browser-paths.ts";
import type { BrowserDataPort } from "../../core/ports/browser-data-port.ts";
import type { LoggerPort } from "../../core/ports/logger-port.ts";
import type { ExtractedToken } from "../../core/types.ts";

const PBKDF2_SALT = "saltysalt";
const PBKDF2_ITERATIONS = 1003;
const PBKDF2_KEYLEN = 16;
const PBKDF2_DIGEST = "sha1";
// Chrome on macOS uses 16 bytes of 0x20 (space) as IV
const AES_IV = Buffer.alloc(16, 0x20);

/** Retrieve Chrome Safe Storage password from macOS Keychain */
function getKeychainPassword(service: string): string {
  const cmd = `security find-generic-password -s "${service}" -w`;
  return execSync(cmd, { encoding: "utf-8" }).trim();
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

        this.logger.info(`[cookie] ${this.browser.name}: decrypted cookie ${row.name}`);
        return {
          accessToken: value,
          browser: this.browser.name,
        };
      }

      this.logger.debug(`[cookie] ${this.browser.name}: all cookies failed decryption`);
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
