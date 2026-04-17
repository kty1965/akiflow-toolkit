import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBinaryCookies, SafariCookieReader } from "../../../adapters/browser/safari-cookie.ts";
import type { LoggerPort } from "../../../core/ports/logger-port.ts";

const silentLogger: LoggerPort = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

interface FixtureCookie {
  domain: string;
  name: string;
  path: string;
  value: string;
}

/**
 * Build a minimal valid Cookies.binarycookies buffer containing one page
 * with the given cookies. Uses the 56-byte cookie header layout.
 */
function buildBinaryCookies(cookies: FixtureCookie[]): Buffer {
  const cookieRecords = cookies.map(buildCookieRecord);

  // Page header (16B) = PAGE_HEADER(4B BE) | count(4B LE) | offsets[n](4B LE each) | footer(4B)
  // Since we have exactly 1 offset slot per cookie, page prefix = 4 + 4 + 4*n + 4
  const pagePrefix = 4 + 4 + 4 * cookieRecords.length + 4;
  const pageSize = pagePrefix + cookieRecords.reduce((acc, r) => acc + r.length, 0);

  const page = Buffer.alloc(pageSize);
  page.writeUInt32BE(0x00000100, 0);
  page.writeUInt32LE(cookieRecords.length, 4);

  let recordOffset = pagePrefix;
  for (let i = 0; i < cookieRecords.length; i++) {
    page.writeUInt32LE(recordOffset, 8 + i * 4);
    cookieRecords[i].copy(page, recordOffset);
    recordOffset += cookieRecords[i].length;
  }
  // Footer 4B zero — already zeroed by Buffer.alloc.

  // File header (8B) + pageSizes table (4B per page) + pages
  const file = Buffer.alloc(4 + 4 + 4 + page.length);
  file.write("cook", 0, "ascii");
  file.writeUInt32BE(1, 4); // pageCount
  file.writeUInt32BE(pageSize, 8); // pageSizes[0]
  page.copy(file, 12);
  return file;
}

function buildCookieRecord(c: FixtureCookie): Buffer {
  const HEADER = 56;
  const domainBuf = Buffer.from(`${c.domain}\0`, "utf-8");
  const nameBuf = Buffer.from(`${c.name}\0`, "utf-8");
  const pathBuf = Buffer.from(`${c.path}\0`, "utf-8");
  const valueBuf = Buffer.from(`${c.value}\0`, "utf-8");

  const domainOffset = HEADER;
  const nameOffset = domainOffset + domainBuf.length;
  const pathOffset = nameOffset + nameBuf.length;
  const valueOffset = pathOffset + pathBuf.length;
  const total = valueOffset + valueBuf.length;

  const rec = Buffer.alloc(total);
  rec.writeUInt32LE(total, 0);
  // +4..+15 left as zero (unk/flags/unk)
  rec.writeUInt32LE(domainOffset, 16);
  rec.writeUInt32LE(nameOffset, 20);
  rec.writeUInt32LE(pathOffset, 24);
  rec.writeUInt32LE(valueOffset, 28);
  // +32..+39 end-marker (zero), +40..+47 expiry, +48..+55 creation — all zero is fine
  domainBuf.copy(rec, domainOffset);
  nameBuf.copy(rec, nameOffset);
  pathBuf.copy(rec, pathOffset);
  valueBuf.copy(rec, valueOffset);
  return rec;
}

describe("parseBinaryCookies", () => {
  test("parses a single-cookie fixture into domain/name/path/value", () => {
    const buf = buildBinaryCookies([
      { domain: "web.akiflow.com", name: "remember_web_foo", path: "/", value: "abc123xyz" },
    ]);

    const cookies = parseBinaryCookies(buf);

    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toEqual({
      domain: "web.akiflow.com",
      name: "remember_web_foo",
      path: "/",
      value: "abc123xyz",
    });
  });

  test("parses multiple cookies in one page", () => {
    const buf = buildBinaryCookies([
      { domain: "web.akiflow.com", name: "remember_web_session1", path: "/", value: "tok1" },
      { domain: "other.com", name: "sessionid", path: "/app", value: "xyz" },
    ]);

    const cookies = parseBinaryCookies(buf);

    expect(cookies).toHaveLength(2);
    expect(cookies[0].name).toBe("remember_web_session1");
    expect(cookies[1].domain).toBe("other.com");
  });

  test("throws on invalid magic header", () => {
    const buf = Buffer.alloc(12);
    buf.write("junk", 0, "ascii");
    expect(() => parseBinaryCookies(buf)).toThrow(/magic/i);
  });

  test("throws on buffer too small", () => {
    expect(() => parseBinaryCookies(Buffer.alloc(4))).toThrow(/buffer too small/i);
  });

  test("returns empty array when pageCount is 0", () => {
    const buf = Buffer.alloc(8);
    buf.write("cook", 0, "ascii");
    buf.writeUInt32BE(0, 4);
    expect(parseBinaryCookies(buf)).toEqual([]);
  });
});

describe("SafariCookieReader", () => {
  let tempDir: string;
  let cookiesPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "akiflow-safari-"));
    cookiesPath = join(tempDir, "Cookies.binarycookies");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("returns null on non-darwin platforms", async () => {
    if (process.platform === "darwin") {
      // On darwin, this code path cannot be triggered without stubbing process.platform.
      // The behavior is covered implicitly by other platforms in CI; skip here.
      return;
    }
    const reader = new SafariCookieReader(silentLogger, cookiesPath);
    const result = await reader.extract();
    expect(result).toBeNull();
  });

  test("returns null when cookies file does not exist", async () => {
    const reader = new SafariCookieReader(silentLogger, join(tempDir, "missing.binarycookies"));
    const result = await reader.extract();
    expect(result).toBeNull();
  });

  test("returns null when the file is not a valid binarycookies blob", async () => {
    await writeFile(cookiesPath, Buffer.from("not a cookies file"));
    const reader = new SafariCookieReader(silentLogger, cookiesPath);
    const result = await reader.extract();
    expect(result).toBeNull();
  });

  test("returns null when no akiflow remember_web_* cookie is present", async () => {
    if (process.platform !== "darwin") return;
    const buf = buildBinaryCookies([
      { domain: "other.com", name: "sessionid", path: "/", value: "xyz" },
      { domain: "web.akiflow.com", name: "XSRF-TOKEN", path: "/", value: "csrf" },
    ]);
    await writeFile(cookiesPath, buf);
    const reader = new SafariCookieReader(silentLogger, cookiesPath);
    const result = await reader.extract();
    expect(result).toBeNull();
  });

  test("extracts akiflow remember_web_* cookie value as accessToken", async () => {
    if (process.platform !== "darwin") return;
    const buf = buildBinaryCookies([
      { domain: "other.com", name: "unrelated", path: "/", value: "skip" },
      { domain: "web.akiflow.com", name: "remember_web_abc123", path: "/", value: "session-token-value" },
    ]);
    await writeFile(cookiesPath, buf);
    const reader = new SafariCookieReader(silentLogger, cookiesPath);

    const result = await reader.extract();

    expect(result).not.toBeNull();
    expect(result?.accessToken).toBe("session-token-value");
    expect(result?.browser).toBe("Safari");
  });
});
