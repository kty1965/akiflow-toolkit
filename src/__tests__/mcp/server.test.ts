import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type AppComponents, composeApp } from "../../composition.ts";
import {
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  PING_TOOL_DESCRIPTION,
  PING_TOOL_NAME,
  buildMcpServer,
  pingHandler,
} from "../../mcp/server.ts";

describe("MCP server core", () => {
  let tempDir: string;
  const envKeys = ["AF_CONFIG_DIR", "AF_CACHE_DIR", "LOG_LEVEL", "LOG_FORMAT"];
  const originalEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "af-mcp-"));
    for (const k of envKeys) originalEnv[k] = process.env[k];
    process.env.AF_CONFIG_DIR = tempDir;
    process.env.AF_CACHE_DIR = tempDir;
    process.env.LOG_LEVEL = "silent";
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
    for (const k of envKeys) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k];
    }
  });

  function build(): { components: AppComponents; server: McpServer } {
    const components = composeApp();
    const server = buildMcpServer(components);
    return { components, server };
  }

  describe("buildMcpServer", () => {
    test("returns an McpServer instance with server name and version exposed as constants", () => {
      // Given: a real AppComponents (silent logger)
      // When: building the MCP server
      const { server } = build();

      // Then: the server is an McpServer and identity constants match expectations
      expect(server).toBeInstanceOf(McpServer);
      expect(MCP_SERVER_NAME).toBe("akiflow");
      expect(MCP_SERVER_VERSION).toBe("0.0.0-development");
    });
  });

  describe("ping stub tool", () => {
    test("pingHandler returns canonical pong response", async () => {
      // Given: the exported ping handler
      // When: invoking it directly
      const result = await pingHandler();

      // Then: content is [{ type: 'text', text: 'pong' }]
      expect(result).toEqual({ content: [{ type: "text", text: "pong" }] });
    });

    test("ping tool is discoverable and callable via MCP protocol", async () => {
      // Given: an MCP server connected to a client over in-memory transport
      const { server } = build();
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "test-client", version: "0.0.0" });
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      try {
        // When: the client lists available tools and calls `ping`
        const listed = await client.listTools();
        const called = await client.callTool({ name: PING_TOOL_NAME, arguments: {} });

        // Then: `ping` is listed with the configured description, and the call returns `pong`
        const names = listed.tools.map((t) => t.name);
        expect(names).toContain(PING_TOOL_NAME);
        const pingTool = listed.tools.find((t) => t.name === PING_TOOL_NAME);
        expect(pingTool?.description).toBe(PING_TOOL_DESCRIPTION);
        expect(called.content).toEqual([{ type: "text", text: "pong" }]);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });

  describe("stdout protection (H2 / ADR-0009)", () => {
    let writes: string[];
    let originalWrite: typeof process.stdout.write;

    beforeEach(() => {
      writes = [];
      originalWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string | Uint8Array): boolean => {
        writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      }) as typeof process.stdout.write;
    });

    afterEach(() => {
      process.stdout.write = originalWrite;
    });

    test("buildMcpServer does not write to stdout", () => {
      // Given: stdout.write is spied
      // When: building the server (no transport attached yet)
      build();

      // Then: nothing reached stdout
      expect(writes).toEqual([]);
    });

    test("pingHandler does not write to stdout", async () => {
      // Given: stdout.write is spied
      // When: invoking pingHandler directly
      await pingHandler();

      // Then: nothing reached stdout
      expect(writes).toEqual([]);
    });
  });
});
