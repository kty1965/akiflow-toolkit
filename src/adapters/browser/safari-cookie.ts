// ---------------------------------------------------------------------------
// SafariCookieReader — ADR-0003 Tier 2 (macOS only)
// Parses ~/Library/Cookies/Cookies.binarycookies (Apple's binary cookie jar)
// and extracts Akiflow session cookies. Pure byte-level parser — no deps.
// Reference: https://github.com/libyal/dtformats (Safari cookies file format)
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BrowserDataPort } from "@core/ports/browser-data-port.ts";
import type { LoggerPort } from "@core/ports/logger-port.ts";
import type { ExtractedToken } from "@core/types.ts";

const MAGIC = "cook";
const PAGE_HEADER = 0x00000100;
const COOKIE_HEADER_SIZE = 56; // bytes before strings region within a cookie record
const AKIFLOW_DOMAIN_SUFFIX = "akiflow.com";
const AKIFLOW_COOKIE_PREFIX = "remember_web_";

// Bearer-usable token patterns — see chrome-cookie.ts for rationale. Safari
// `remember_web_*` cookies are Laravel encrypted session payloads; only keep
// them when they embed a JWT or Laravel Passport refresh token.
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const REFRESH_PATTERN = /def50200[a-f0-9]{200,}/;

export interface SafariCookie {
  domain: string;
  name: string;
  path: string;
  value: string;
}

export class SafariCookieReader implements BrowserDataPort {
  private readonly cookiesPath: string;

  constructor(
    private readonly logger: LoggerPort,
    cookiesPath?: string,
  ) {
    this.cookiesPath = cookiesPath ?? join(homedir(), "Library", "Cookies", "Cookies.binarycookies");
  }

  async extract(): Promise<ExtractedToken | null> {
    if (process.platform !== "darwin") {
      this.logger.debug("[safari] skipped — not darwin");
      return null;
    }
    if (!existsSync(this.cookiesPath)) {
      this.logger.debug(`[safari] cookies file not found: ${this.cookiesPath}`);
      return null;
    }

    let buf: Buffer;
    try {
      buf = await readFile(this.cookiesPath);
    } catch (err) {
      this.logger.debug("[safari] failed to read cookies file", { err: String(err) });
      return null;
    }

    let cookies: SafariCookie[];
    try {
      cookies = parseBinaryCookies(buf);
    } catch (err) {
      this.logger.debug("[safari] parse failed", { err: String(err) });
      return null;
    }

    const akiflow = cookies.filter(
      (c) => c.domain.includes(AKIFLOW_DOMAIN_SUFFIX) && c.name.startsWith(AKIFLOW_COOKIE_PREFIX),
    );
    if (akiflow.length === 0) {
      this.logger.debug("[safari] no akiflow remember_web cookies found");
      return null;
    }

    // Security (SECURITY-AUDIT-REPORT S-5): only surface a cookie whose
    // decrypted value embeds a JWT or refresh token; never treat a raw
    // Laravel session payload as an API Bearer.
    for (const cookie of akiflow) {
      const jwt = cookie.value.match(JWT_PATTERN)?.[0];
      const refresh = cookie.value.match(REFRESH_PATTERN)?.[0];
      if (!jwt && !refresh) {
        this.logger.debug(`[safari] ${cookie.name} has no Bearer-usable token — skipping`);
        continue;
      }
      this.logger.info(
        `[safari] extracted Bearer-capable token from ${cookie.name} (jwt=${!!jwt}, refresh=${!!refresh})`,
      );
      return {
        accessToken: jwt ?? "",
        refreshToken: refresh,
        browser: "Safari",
      };
    }

    this.logger.debug("[safari] no akiflow cookie yielded a usable Bearer token");
    return null;
  }
}

/**
 * Parse an Apple Cookies.binarycookies buffer into cookie records.
 *
 * File layout:
 *   magic "cook" (4B) | pageCount (4B BE) | pageSizes[pageCount] (4B BE each) | pages...
 * Page layout:
 *   0x00000100 header (4B) | cookieCount (4B LE) | cookieOffsets[n] (4B LE each)
 *   | footer 0x00000000 (4B) | cookie records at given offsets
 * Cookie layout (within page, offsets relative to cookie start):
 *   size(4B LE) | unk(4B) | flags(4B LE) | unk(4B)
 *   | domainOffset(4B LE) | nameOffset(4B LE) | pathOffset(4B LE) | valueOffset(4B LE)
 *   | end-marker(8B zero) | expiry(8B LE double, Mac absolute time) | creation(8B LE double)
 *   | null-terminated strings
 */
export function parseBinaryCookies(buf: Buffer): SafariCookie[] {
  if (buf.length < 8) throw new Error("buffer too small");
  if (buf.subarray(0, 4).toString("ascii") !== MAGIC) {
    throw new Error("invalid magic header (expected 'cook')");
  }

  const pageCount = buf.readUInt32BE(4);
  if (pageCount === 0) return [];

  const pageSizes: number[] = [];
  let cursor = 8;
  for (let i = 0; i < pageCount; i++) {
    if (cursor + 4 > buf.length) throw new Error("truncated page size table");
    pageSizes.push(buf.readUInt32BE(cursor));
    cursor += 4;
  }

  const cookies: SafariCookie[] = [];
  for (const pageSize of pageSizes) {
    if (cursor + pageSize > buf.length) throw new Error("truncated page");
    const page = buf.subarray(cursor, cursor + pageSize);
    cursor += pageSize;
    parsePage(page, cookies);
  }

  return cookies;
}

function parsePage(page: Buffer, out: SafariCookie[]): void {
  if (page.length < 8) throw new Error("page too small");
  if (page.readUInt32BE(0) !== PAGE_HEADER) {
    throw new Error(`invalid page header: 0x${page.readUInt32BE(0).toString(16)}`);
  }
  const count = page.readUInt32LE(4);
  if (count === 0) return;

  const offsets: number[] = [];
  let pos = 8;
  for (let i = 0; i < count; i++) {
    if (pos + 4 > page.length) throw new Error("truncated cookie offset table");
    offsets.push(page.readUInt32LE(pos));
    pos += 4;
  }
  // 4-byte page footer follows; we skip validation to be lenient.

  for (const offset of offsets) {
    if (offset + COOKIE_HEADER_SIZE > page.length) {
      throw new Error("cookie offset out of range");
    }
    out.push(parseCookieRecord(page, offset));
  }
}

function parseCookieRecord(page: Buffer, offset: number): SafariCookie {
  const size = page.readUInt32LE(offset);
  if (offset + size > page.length) throw new Error("cookie size exceeds page");

  const domainOffset = page.readUInt32LE(offset + 16);
  const nameOffset = page.readUInt32LE(offset + 20);
  const pathOffset = page.readUInt32LE(offset + 24);
  const valueOffset = page.readUInt32LE(offset + 28);

  return {
    domain: readNullTerminated(page, offset + domainOffset, offset + size),
    name: readNullTerminated(page, offset + nameOffset, offset + size),
    path: readNullTerminated(page, offset + pathOffset, offset + size),
    value: readNullTerminated(page, offset + valueOffset, offset + size),
  };
}

function readNullTerminated(buf: Buffer, start: number, end: number): string {
  if (start < 0 || start >= buf.length || start >= end) return "";
  let i = start;
  while (i < end && buf[i] !== 0) i++;
  return buf.subarray(start, i).toString("utf-8");
}
