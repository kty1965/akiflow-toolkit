import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type AppComponents, composeApp } from "../../composition.ts";
import { MCP_SERVER_NAME, MCP_SERVER_VERSION, buildMcpServer } from "../../mcp/server.ts";

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

    test("registers TASK-15 task and schedule tools and does not expose the old ping stub", async () => {
      // Given: a fully composed server connected via in-memory transport
      const { server } = build();
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "test-client", version: "0.0.0" });
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      try {
        // When: the client lists tools
        const { tools } = await client.listTools();
        const names = tools.map((t) => t.name);

        // Then: the 7 TASK-15 tools are registered and no ping stub remains
        for (const expected of [
          "get_tasks",
          "search_tasks",
          "create_task",
          "update_task",
          "complete_task",
          "schedule_task",
          "unschedule_task",
        ]) {
          expect(names).toContain(expected);
        }
        expect(names).not.toContain("ping");
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
  });
});
