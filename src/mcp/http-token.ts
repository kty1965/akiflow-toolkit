// ---------------------------------------------------------------------------
// Shared secret for the HTTP MCP server. `af --mcp --http` checks it and
// `af setup claude-code --http` copies it into the client config.
// ---------------------------------------------------------------------------

import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";

export const MCP_HTTP_TOKEN_FILENAME = "mcp-http-token";

export function httpTokenPath(configDir: string): string {
  return join(configDir, MCP_HTTP_TOKEN_FILENAME);
}

export async function readOrCreateHttpToken(configDir: string): Promise<string> {
  const path = httpTokenPath(configDir);
  const existing = await readToken(path);
  if (existing) return existing;

  await mkdir(configDir, { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString("base64url");
  try {
    const handle = await open(path, "wx", 0o600);
    await handle.writeFile(token);
    await handle.close();
    return token;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const raced = await readToken(path);
    if (!raced) throw new Error(`MCP HTTP token file ${path} is empty`);
    return raced;
  }
}

async function readToken(path: string): Promise<string | null> {
  try {
    const token = (await readFile(path, "utf-8")).trim();
    return token === "" ? null : token;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export function isAuthorizedRequest(req: Request, token: string): boolean {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length).trim());
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
