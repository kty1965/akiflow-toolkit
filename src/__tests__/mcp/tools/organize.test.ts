import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Label, Tag } from "@core/types.ts";
import {
  GET_LABELS_TOOL_NAME,
  GET_PROJECTS_TOOL_NAME,
  GET_TAGS_TOOL_NAME,
  type OrganizeToolsDeps,
  registerOrganizeTools,
} from "@mcp/tools/organize.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

interface DepOptions {
  getLabels?: () => Promise<Label[]>;
  getTags?: () => Promise<Tag[]>;
}

function buildDeps(opts: DepOptions = {}): OrganizeToolsDeps {
  return {
    taskQuery: {
      getLabels: opts.getLabels ?? (async () => []),
      getTags: opts.getTags ?? (async () => []),
    },
  };
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

describe("mcp/tools/organize", () => {
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
    test("registers get_projects, get_labels, and get_tags as readOnly", async () => {
      // Given: a server with organize tools registered
      registerOrganizeTools(server, buildDeps());
      client = await connectClient(server);

      // When: listing tools
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);

      // Then: all three are registered and readOnly
      expect(names).toContain(GET_PROJECTS_TOOL_NAME);
      expect(names).toContain(GET_LABELS_TOOL_NAME);
      expect(names).toContain(GET_TAGS_TOOL_NAME);
      for (const name of [GET_PROJECTS_TOOL_NAME, GET_LABELS_TOOL_NAME, GET_TAGS_TOOL_NAME]) {
        const tool = tools.find((t) => t.name === name);
        expect(tool?.annotations?.readOnlyHint).toBe(true);
      }
    });
  });

  describe("get_projects", () => {
    test("returns labels list from task query service", async () => {
      // Given: stub labels returned by getLabels
      const labels: Label[] = [
        { id: "lbl-1", name: "Marketing", color: "#ff0" },
        { id: "lbl-2", name: "Engineering", color: null },
      ];
      registerOrganizeTools(server, buildDeps({ getLabels: async () => labels }));
      client = await connectClient(server);

      // When: calling get_projects
      const result = await client.callTool({ name: GET_PROJECTS_TOOL_NAME, arguments: {} });

      // Then: both label names and IDs appear in the formatted output
      expect(result.isError).toBeFalsy();
      const text = textOf(result);
      expect(text).toContain("Marketing");
      expect(text).toContain("lbl-1");
      expect(text).toContain("Engineering");
    });

    test("empty list → friendly empty message, not isError", async () => {
      // Given: no labels
      registerOrganizeTools(server, buildDeps({ getLabels: async () => [] }));
      client = await connectClient(server);

      // When: calling get_projects
      const result = await client.callTool({ name: GET_PROJECTS_TOOL_NAME, arguments: {} });

      // Then: result is not an error and mentions no items
      expect(result.isError).toBeFalsy();
      expect(textOf(result)).toContain("등록된 항목이 없습니다");
    });

    test("underlying service throws → isError=true", async () => {
      // Given: getLabels throws
      registerOrganizeTools(
        server,
        buildDeps({
          getLabels: async () => {
            throw new Error("401 unauthorized");
          },
        }),
      );
      client = await connectClient(server);

      // When: calling get_projects
      const result = await client.callTool({ name: GET_PROJECTS_TOOL_NAME, arguments: {} });

      // Then: isError flag set, message preserved
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("401 unauthorized");
    });
  });

  describe("get_labels", () => {
    test("shares the getLabels endpoint with get_projects (Akiflow aliasing)", async () => {
      // Given: a getLabels stub that counts invocations
      let count = 0;
      registerOrganizeTools(
        server,
        buildDeps({
          getLabels: async () => {
            count++;
            return [{ id: "L", name: "Design", color: null }];
          },
        }),
      );
      client = await connectClient(server);

      // When: calling both get_projects and get_labels
      const projects = await client.callTool({ name: GET_PROJECTS_TOOL_NAME, arguments: {} });
      const labels = await client.callTool({ name: GET_LABELS_TOOL_NAME, arguments: {} });

      // Then: both tools render the same data and each hit the endpoint once
      expect(count).toBe(2);
      expect(textOf(projects)).toContain("Design");
      expect(textOf(labels)).toContain("Design");
    });
  });

  describe("get_tags", () => {
    test("returns tags list with # prefix", async () => {
      // Given: stub tags
      const tags: Tag[] = [
        { id: "t1", name: "urgent" },
        { id: "t2", name: "followup" },
      ];
      registerOrganizeTools(server, buildDeps({ getTags: async () => tags }));
      client = await connectClient(server);

      // When: calling get_tags
      const result = await client.callTool({ name: GET_TAGS_TOOL_NAME, arguments: {} });

      // Then: tag names appear prefixed with '#'
      expect(result.isError).toBeFalsy();
      const text = textOf(result);
      expect(text).toContain("#urgent");
      expect(text).toContain("#followup");
    });

    test("underlying service throws → isError=true", async () => {
      // Given: getTags throws
      registerOrganizeTools(
        server,
        buildDeps({
          getTags: async () => {
            throw new Error("network down");
          },
        }),
      );
      client = await connectClient(server);

      // When: calling get_tags
      const result = await client.callTool({ name: GET_TAGS_TOOL_NAME, arguments: {} });

      // Then: isError flag set
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("network down");
    });
  });
});
