import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthStatus } from "../../../core/types.ts";
import {
  AUTH_STATUS_TOOL_NAME,
  type AuthStatusToolDeps,
  registerAuthStatusTool,
} from "../../../mcp/tools/auth-status.ts";

function buildDeps(getStatus: () => Promise<AuthStatus>): AuthStatusToolDeps {
  return { authService: { getStatus } };
}

async function connectClient(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function textOf(result: { content: unknown }): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content[0]?.text ?? "";
}

describe("mcp/tools/auth-status", () => {
  let server: McpServer;
  let client: Client | null;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "0.0.0" });
    client = null;
  });

  afterEach(async () => {
    if (client) await client.close();
    await server.close();
  });

  describe("tool registration", () => {
    test("registers auth_status as readOnly", async () => {
      // Given: a server with auth_status registered
      registerAuthStatusTool(
        server,
        buildDeps(async () => ({
          isAuthenticated: true,
          expiresAt: Date.now() + 60_000,
          source: "indexeddb",
          isExpired: false,
        })),
      );
      client = await connectClient(server);

      // When: listing tools
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === AUTH_STATUS_TOOL_NAME);

      // Then: tool is readOnly and has Korean usage examples
      expect(tool).toBeDefined();
      expect(tool?.annotations?.readOnlyHint).toBe(true);
      expect(tool?.description ?? "").toContain("예:");
    });
  });

  describe("authenticated state", () => {
    test("valid token → reports expiry ISO time and source", async () => {
      // Given: an authenticated status with a known expiresAt
      const expiresAt = Date.parse("2026-05-01T00:00:00Z");
      registerAuthStatusTool(
        server,
        buildDeps(async () => ({
          isAuthenticated: true,
          expiresAt,
          source: "indexeddb",
          isExpired: false,
        })),
      );
      client = await connectClient(server);

      // When: calling the tool
      const result = await client.callTool({ name: AUTH_STATUS_TOOL_NAME, arguments: {} });

      // Then: result is not an error, mentions authenticated + ISO expiry + source
      expect(result.isError).toBeFalsy();
      const text = textOf(result);
      expect(text).toContain("인증됨");
      expect(text).toContain("2026-05-01T00:00:00.000Z");
      expect(text).toContain("indexeddb");
    });
  });

  describe("expired state", () => {
    test("expired token → reports expired with recovery hint", async () => {
      // Given: an expired token
      registerAuthStatusTool(
        server,
        buildDeps(async () => ({
          isAuthenticated: false,
          expiresAt: Date.parse("2024-01-01T00:00:00Z"),
          source: "manual",
          isExpired: true,
        })),
      );
      client = await connectClient(server);

      // When: calling the tool
      const result = await client.callTool({ name: AUTH_STATUS_TOOL_NAME, arguments: {} });

      // Then: result includes 'expired' wording + recovery command
      expect(result.isError).toBeFalsy();
      const text = textOf(result);
      expect(text).toContain("만료됨");
      expect(text).toContain("af auth");
      expect(text).toContain("manual");
    });
  });

  describe("unauthenticated state", () => {
    test("no credentials → reports unauthenticated with login hint", async () => {
      // Given: no stored credentials
      registerAuthStatusTool(
        server,
        buildDeps(async () => ({
          isAuthenticated: false,
          expiresAt: null,
          source: null,
          isExpired: false,
        })),
      );
      client = await connectClient(server);

      // When: calling the tool
      const result = await client.callTool({ name: AUTH_STATUS_TOOL_NAME, arguments: {} });

      // Then: result is not an error and nudges the user to run 'af auth'
      expect(result.isError).toBeFalsy();
      const text = textOf(result);
      expect(text).toContain("미인증");
      expect(text).toContain("af auth");
    });
  });

  describe("error handling", () => {
    test("getStatus throws → isError=true", async () => {
      // Given: storage layer throws
      registerAuthStatusTool(
        server,
        buildDeps(async () => {
          throw new Error("disk read failed");
        }),
      );
      client = await connectClient(server);

      // When: calling the tool
      const result = await client.callTool({ name: AUTH_STATUS_TOOL_NAME, arguments: {} });

      // Then: isError flag set, underlying message preserved
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("disk read failed");
    });
  });
});
