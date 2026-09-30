import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeApp } from "@composition";
import { createMcpHttpHandler, MCP_HTTP_PATH } from "@mcp/http-server.ts";
import { httpTokenPath, readOrCreateHttpToken } from "@mcp/http-token.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

describe("MCP HTTP server", () => {
  let tempDir: string;
  let httpServer: ReturnType<typeof Bun.serve>;
  let baseUrl: URL;
  let token: string;
  const envKeys = ["AF_CONFIG_DIR", "AF_CACHE_DIR", "LOG_LEVEL"];
  const originalEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "af-mcp-http-"));
    for (const k of envKeys) originalEnv[k] = process.env[k];
    process.env.AF_CONFIG_DIR = tempDir;
    process.env.AF_CACHE_DIR = tempDir;
    process.env.LOG_LEVEL = "silent";

    const components = composeApp();
    token = await readOrCreateHttpToken(tempDir);
    httpServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createMcpHttpHandler(components, token) });
    baseUrl = new URL(`http://127.0.0.1:${httpServer.port}${MCP_HTTP_PATH}`);
  });

  afterAll(async () => {
    await httpServer.stop(true);
    rmSync(tempDir, { recursive: true, force: true });
    for (const k of envKeys) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k];
    }
  });

  function connectClient(authorization?: string): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(baseUrl, {
      requestInit: authorization ? { headers: { Authorization: authorization } } : undefined,
    });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    return client.connect(transport).then(() => client);
  }

  describe("with a valid bearer token", () => {
    test("two independent clients initialize and list the same tools", async () => {
      // Given: two clients sharing one server, as two Claude Code sessions would
      const [a, b] = await Promise.all([connectClient(`Bearer ${token}`), connectClient(`Bearer ${token}`)]);

      try {
        // When: both list tools
        const [toolsA, toolsB] = await Promise.all([a.listTools(), b.listTools()]);

        // Then: both see the full akiflow tool set
        const names = toolsA.tools.map((t) => t.name);
        expect(names).toContain("get_tasks");
        expect(names).toContain("auth_status");
        expect(toolsB.tools.map((t) => t.name)).toEqual(names);
      } finally {
        await Promise.all([a.close(), b.close()]);
      }
    });
  });

  describe("request rejection", () => {
    test("missing Authorization header → 401 before reaching MCP", async () => {
      // Given/When: a client without the token
      // Then: initialize fails
      await expect(connectClient()).rejects.toThrow();
      const res = await fetch(baseUrl, { method: "POST", body: "{}" });
      expect(res.status).toBe(401);
    });

    test("wrong token → 401", async () => {
      // Given/When: a raw request with a different token
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: { Authorization: "Bearer not-the-token" },
        body: "{}",
      });

      // Then: rejected
      expect(res.status).toBe(401);
    });

    test("GET with a valid token → 405 (no standalone SSE in stateless mode)", async () => {
      // Given/When: a GET that would open an SSE stream
      const res = await fetch(baseUrl, { headers: { Authorization: `Bearer ${token}` } });

      // Then: method not allowed
      expect(res.status).toBe(405);
    });

    test("other paths → 404", async () => {
      // Given/When: a request outside /mcp
      const res = await fetch(new URL("/other", baseUrl), { headers: { Authorization: `Bearer ${token}` } });

      // Then: not found
      expect(res.status).toBe(404);
    });
  });

  describe("readOrCreateHttpToken", () => {
    test("creates a 0600 token once and returns the same value afterwards", async () => {
      // Given: an existing token from beforeAll
      // When: reading again
      const again = await readOrCreateHttpToken(tempDir);

      // Then: stable value, owner-only file
      expect(again).toBe(token);
      expect(token.length).toBeGreaterThanOrEqual(40);
      expect(statSync(httpTokenPath(tempDir)).mode & 0o777).toBe(0o600);
    });
  });
});
