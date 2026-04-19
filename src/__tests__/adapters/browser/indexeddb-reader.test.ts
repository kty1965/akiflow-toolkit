import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IndexedDbReader } from "@adapters/browser/indexeddb-reader.ts";
import type { BrowserProfile } from "@core/browser-paths.ts";
import type { LoggerPort } from "@core/ports/logger-port.ts";

const silentLogger: LoggerPort = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Build a JWT with the given exp (seconds since epoch) and a padded signature */
function buildJwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: "user-fixture", exp })).toString("base64url");
  const sig = "a".repeat(43);
  return `${header}.${payload}.${sig}`;
}

function makeProfile(indexedDbPaths: string | string[], name = "Chrome"): BrowserProfile {
  return {
    name,
    profilePath: "/unused",
    cookiesDb: "/unused/Cookies",
    indexedDbPaths: Array.isArray(indexedDbPaths) ? indexedDbPaths : [indexedDbPaths],
    keychainService: "Chrome Safe Storage",
  };
}

describe("IndexedDbReader", () => {
  let tempDir: string;
  let dbDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "akiflow-idb-"));
    dbDir = join(tempDir, "IndexedDB", "https_web.akiflow.com_0.indexeddb.leveldb");
    await mkdir(dbDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("returns null when indexedDbPath does not exist", async () => {
    // Given: a BrowserProfile pointing at a non-existent directory
    const profile = makeProfile(join(tempDir, "missing"));
    const reader = new IndexedDbReader(profile, silentLogger);

    // When: extract is called
    const result = await reader.extract();

    // Then: returns null (graceful handling)
    expect(result).toBeNull();
  });

  test("returns null when LevelDB directory has no .log/.ldb files", async () => {
    // Given: the directory exists but is empty
    const profile = makeProfile(dbDir);
    const reader = new IndexedDbReader(profile, silentLogger);

    // When: extract is called
    const result = await reader.extract();

    // Then: returns null
    expect(result).toBeNull();
  });

  test("extracts a valid non-expired JWT from a .log file", async () => {
    // Given: a LevelDB file containing a valid, non-expired JWT
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const jwt = buildJwt(futureExp);
    await writeFile(join(dbDir, "000001.log"), `garbage prefix ${jwt} garbage suffix`);

    const profile = makeProfile(dbDir, "Arc");
    const reader = new IndexedDbReader(profile, silentLogger);

    // When: extract is called
    const result = await reader.extract();

    // Then: the JWT is returned with the correct exp and browser name
    expect(result).not.toBeNull();
    expect(result?.accessToken).toBe(jwt);
    expect(result?.expiresAt).toBe(futureExp);
    expect(result?.browser).toBe("Arc");
  });

  test("filters out expired JWTs", async () => {
    // Given: a LevelDB file containing only an expired JWT
    const pastExp = Math.floor(Date.now() / 1000) - 3600;
    const expiredJwt = buildJwt(pastExp);
    await writeFile(join(dbDir, "000001.log"), expiredJwt);

    const profile = makeProfile(dbDir);
    const reader = new IndexedDbReader(profile, silentLogger);

    // When: extract is called
    const result = await reader.extract();

    // Then: returns null because the only token was expired
    expect(result).toBeNull();
  });

  test("picks the JWT with the latest exp when multiple valid tokens exist", async () => {
    // Given: a file with two valid JWTs, one expiring sooner than the other
    const soon = Math.floor(Date.now() / 1000) + 600;
    const later = Math.floor(Date.now() / 1000) + 7200;
    const jwtSoon = buildJwt(soon);
    const jwtLater = buildJwt(later);
    await writeFile(join(dbDir, "000002.ldb"), `${jwtSoon}\n${jwtLater}`);

    const profile = makeProfile(dbDir);
    const reader = new IndexedDbReader(profile, silentLogger);

    // When: extract is called
    const result = await reader.extract();

    // Then: the token with the later exp is preferred
    expect(result?.accessToken).toBe(jwtLater);
    expect(result?.expiresAt).toBe(later);
  });

  test("captures refresh token matching def50200<hex> pattern", async () => {
    // Given: a file containing a valid JWT and a Laravel-style refresh token
    const jwt = buildJwt(Math.floor(Date.now() / 1000) + 3600);
    const refresh = `def50200${"a".repeat(250)}`;
    await writeFile(join(dbDir, "000001.log"), `${jwt}...${refresh}`);

    const profile = makeProfile(dbDir);
    const reader = new IndexedDbReader(profile, silentLogger);

    // When: extract is called
    const result = await reader.extract();

    // Then: both accessToken and refreshToken are captured
    expect(result?.accessToken).toBe(jwt);
    expect(result?.refreshToken).toBe(refresh);
  });

  test("ignores malformed JWT-looking strings", async () => {
    // Given: a file with a string that matches the JWT regex prefix but has invalid base64
    //        plus one real valid JWT
    const invalidJwt = "eyJINVALIDPAYLOADxxxxxxx.zzz.yyy"; // eyJ + 10+ chars + . + . + suffix
    const validExp = Math.floor(Date.now() / 1000) + 1800;
    const validJwt = buildJwt(validExp);
    await writeFile(join(dbDir, "000001.log"), `${invalidJwt}\n${validJwt}`);

    const profile = makeProfile(dbDir);
    const reader = new IndexedDbReader(profile, silentLogger);

    // When: extract is called
    const result = await reader.extract();

    // Then: only the valid JWT is returned (malformed one is silently discarded)
    expect(result?.accessToken).toBe(validJwt);
  });

  test("returns null when file contains no JWT-like strings", async () => {
    // Given: a file with no JWT-matching content
    await writeFile(join(dbDir, "000001.log"), "just some random binary data \x00\x01\x02");

    const profile = makeProfile(dbDir);
    const reader = new IndexedDbReader(profile, silentLogger);

    // When: extract is called
    const result = await reader.extract();

    // Then: returns null
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Multi-origin leveldb scan — mirrors the `auth → web → product` priority
  // wired in browser-detector after Akiflow split its SPA across origins.
  // -------------------------------------------------------------------------

  describe("multi-path priority scan", () => {
    async function mkLeveldb(name: string): Promise<string> {
      const dir = join(tempDir, "IndexedDB", name);
      await mkdir(dir, { recursive: true });
      return dir;
    }

    test("falls through to the second path when the first is missing", async () => {
      // Given: first candidate path does not exist, second has a valid JWT
      const missing = join(tempDir, "IndexedDB", "does_not_exist");
      const webDir = await mkLeveldb("https_web.akiflow.com_0.indexeddb.leveldb");
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const jwt = buildJwt(futureExp);
      await writeFile(join(webDir, "000001.log"), jwt);

      const profile = makeProfile([missing, webDir]);
      const reader = new IndexedDbReader(profile, silentLogger);

      // When: extract scans in order
      const result = await reader.extract();

      // Then: the JWT from the second candidate is returned
      expect(result?.accessToken).toBe(jwt);
    });

    test("respects priority — uses first path when multiple candidates have tokens", async () => {
      // Given: auth origin (priority 1) holds a token with earlier exp;
      //        web origin (priority 2) holds a token with later exp.
      //        Priority must win over freshness.
      const authDir = await mkLeveldb("https_auth.akiflow.com_0.indexeddb.leveldb");
      const webDir = await mkLeveldb("https_web.akiflow.com_0.indexeddb.leveldb");
      const authExp = Math.floor(Date.now() / 1000) + 600;
      const webExp = Math.floor(Date.now() / 1000) + 7200;
      const authJwt = buildJwt(authExp);
      const webJwt = buildJwt(webExp);
      await writeFile(join(authDir, "000001.log"), authJwt);
      await writeFile(join(webDir, "000001.log"), webJwt);

      const profile = makeProfile([authDir, webDir]);
      const reader = new IndexedDbReader(profile, silentLogger);

      // When: extract is called
      const result = await reader.extract();

      // Then: the auth-origin token wins because it is tried first
      expect(result?.accessToken).toBe(authJwt);
      expect(result?.expiresAt).toBe(authExp);
    });

    test("skips paths that exist but yield no usable JWT, continues to next", async () => {
      // Given: auth origin exists but holds only expired JWTs;
      //        product origin holds a valid JWT.
      const authDir = await mkLeveldb("https_auth.akiflow.com_0.indexeddb.leveldb");
      const productDir = await mkLeveldb("https_product.akiflow.com_0.indexeddb.leveldb");
      await writeFile(join(authDir, "000001.log"), buildJwt(Math.floor(Date.now() / 1000) - 3600));
      const valid = buildJwt(Math.floor(Date.now() / 1000) + 3600);
      await writeFile(join(productDir, "000002.ldb"), valid);

      const profile = makeProfile([authDir, productDir]);
      const reader = new IndexedDbReader(profile, silentLogger);

      // When: extract is called
      const result = await reader.extract();

      // Then: falls through to product origin and returns its JWT
      expect(result?.accessToken).toBe(valid);
    });

    test("returns null when all candidate paths are absent or empty", async () => {
      // Given: three non-existent candidate paths
      const profile = makeProfile([
        join(tempDir, "IndexedDB", "missing_a"),
        join(tempDir, "IndexedDB", "missing_b"),
        join(tempDir, "IndexedDB", "missing_c"),
      ]);
      const reader = new IndexedDbReader(profile, silentLogger);

      // When / Then: null (no usable token anywhere)
      expect(await reader.extract()).toBeNull();
    });

    test("returns null when indexedDbPaths array is empty", async () => {
      // Given: a profile that advertises zero candidate paths
      const profile = makeProfile([]);
      const reader = new IndexedDbReader(profile, silentLogger);

      // When / Then: returns null gracefully instead of iterating nothing
      expect(await reader.extract()).toBeNull();
    });
  });
});
