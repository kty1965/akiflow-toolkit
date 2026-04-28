import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AuthError, NetworkError } from "@core/errors/index.ts";
import type { LoggerPort } from "@core/ports/logger-port.ts";
import type { CreateTaskInput, UpdateTaskInput } from "@core/services/task-command-service.ts";
import type { Task, TaskQueryOptions } from "@core/types.ts";
import { registerTaskTools, type TaskToolsDeps } from "@mcp/tools/tasks.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

const silentLogger: LoggerPort = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function buildTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    title: "Sample task",
    date: "2026-04-16",
    datetime: null,
    duration: null,
    done: false,
    listId: null,
    status: 0,
    recurrence: null,
    deleted_at: null,
    global_created_at: "2026-04-16T00:00:00.000Z",
    global_updated_at: "2026-04-16T00:00:00.000Z",
    description: null,
    priority: null,
    tags: [],
    labels: [],
    shared: false,
    source: null,
    parent_id: null,
    position: null,
    ...overrides,
  };
}

type QueryStub = Partial<TaskToolsDeps["taskQuery"]>;
type CommandStub = Partial<TaskToolsDeps["taskCommand"]>;

function buildDeps(overrides: { query?: QueryStub; command?: CommandStub } = {}): TaskToolsDeps {
  const query: TaskToolsDeps["taskQuery"] = {
    listTasks: overrides.query?.listTasks ?? (async () => []),
    getTaskById: overrides.query?.getTaskById ?? (async () => null),
  };
  const command: TaskToolsDeps["taskCommand"] = {
    createTask: overrides.command?.createTask ?? (async (input) => buildTask({ title: input.title })),
    updateTask:
      overrides.command?.updateTask ?? (async (id, patch) => buildTask({ id, title: patch.title ?? "Sample task" })),
    completeTask: overrides.command?.completeTask ?? (async (id) => buildTask({ id, done: true, status: 1 })),
    deleteTask:
      overrides.command?.deleteTask ?? (async (id) => buildTask({ id, deleted_at: "2026-04-17T00:00:00.000Z" })),
  };
  return { taskQuery: query, taskCommand: command, logger: silentLogger };
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mcp/tools/tasks", () => {
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
    test("registers exactly the seven task tools with ADR-0007 annotations", async () => {
      // Given: tasks tools registered
      registerTaskTools(server, buildDeps());
      client = await connectClient(server);

      // When: client lists tools
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();

      // Then: all 7 expected names are present and annotations follow the spec
      expect(names).toEqual(
        ["complete_task", "create_task", "delete_task", "get_task", "get_tasks", "search_tasks", "update_task"].sort(),
      );

      const get = tools.find((t) => t.name === "get_tasks");
      expect(get?.annotations?.readOnlyHint).toBe(true);
      expect(get?.description ?? "").toContain("Examples:");

      const detail = tools.find((t) => t.name === "get_task");
      expect(detail?.annotations?.readOnlyHint).toBe(true);
      expect(detail?.annotations?.openWorldHint).toBe(true);
      expect(detail?.description ?? "").toContain("notes");

      const search = tools.find((t) => t.name === "search_tasks");
      expect(search?.annotations?.readOnlyHint).toBe(true);

      const complete = tools.find((t) => t.name === "complete_task");
      expect(complete?.annotations?.destructiveHint).toBe(true);
      expect(complete?.annotations?.idempotentHint).toBe(true);

      const create = tools.find((t) => t.name === "create_task");
      expect(create?.annotations?.readOnlyHint).toBeFalsy();

      const update = tools.find((t) => t.name === "update_task");
      expect(update?.annotations?.idempotentHint).toBe(true);

      const del = tools.find((t) => t.name === "delete_task");
      expect(del?.annotations?.destructiveHint).toBe(true);
      expect(del?.annotations?.idempotentHint).toBe(true);
      expect(del?.description ?? "").toContain("Examples:");
    });
  });

  describe("get_tasks", () => {
    test("forwards filter/date/project to listTasks and renders a markdown list", async () => {
      // Given: stub captures options and returns one task
      const captured: TaskQueryOptions[] = [];
      registerTaskTools(
        server,
        buildDeps({
          query: {
            listTasks: async (options) => {
              captured.push(options ?? {});
              return [buildTask({ title: "Standup", date: "2026-04-16", listId: "work" })];
            },
          },
        }),
      );
      client = await connectClient(server);

      // When: calling with filter+date+project
      const result = await client.callTool({
        name: "get_tasks",
        arguments: { filter: "today", date: "2026-04-16", project: "work" },
      });

      // Then: options propagate; output contains the title + project tag
      expect(captured).toEqual([{ filter: "today", date: "2026-04-16", project: "work" }]);
      expect(result.isError).toBeFalsy();
      const text = textOf(result);
      expect(text).toContain("Standup");
      expect(text).toContain("[project: work]");
    });

    test("no tasks → friendly empty body, not isError", async () => {
      // Given: stub returns empty
      registerTaskTools(server, buildDeps({ query: { listTasks: async () => [] } }));
      client = await connectClient(server);

      // When: calling with only a filter
      const result = await client.callTool({
        name: "get_tasks",
        arguments: { filter: "inbox" },
      });

      // Then: isError is false; body explains no matches
      expect(result.isError).toBeFalsy();
      expect(textOf(result)).toContain("no matching tasks");
    });

    test("AkiflowError → isError with hint line", async () => {
      // Given: listTasks throws AuthError
      registerTaskTools(
        server,
        buildDeps({
          query: {
            listTasks: async () => {
              throw new AuthError("expired");
            },
          },
        }),
      );
      client = await connectClient(server);

      // When: calling the tool
      const result = await client.callTool({ name: "get_tasks", arguments: {} });

      // Then: isError=true, userMessage + hint surface
      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text).toContain("인증이 필요합니다");
      expect(text).toContain("af auth");
    });

    test("generic Error → isError with 'unexpected error' label", async () => {
      // Given: listTasks throws non-Akiflow error
      registerTaskTools(
        server,
        buildDeps({
          query: {
            listTasks: async () => {
              throw new Error("boom");
            },
          },
        }),
      );
      client = await connectClient(server);

      // When: calling the tool
      const result = await client.callTool({ name: "get_tasks", arguments: {} });

      // Then: isError=true, text labelled with tool name
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("get_tasks: unexpected error");
      expect(textOf(result)).toContain("boom");
    });
  });

  describe("get_task", () => {
    test("returns markdown detail including notes/description", async () => {
      // Given: getTaskById returns a task with description
      registerTaskTools(
        server,
        buildDeps({
          query: {
            getTaskById: async (id) =>
              buildTask({
                id,
                title: "Write spec",
                description: "Outline scope, risks, and rollout plan.",
                priority: 2,
                tags: ["q2"],
                labels: ["urgent"],
                listId: "work",
              }),
          },
        }),
      );
      client = await connectClient(server);

      // When: fetching by id
      const result = await client.callTool({
        name: "get_task",
        arguments: { id: "abc" },
      });

      // Then: detail markdown surfaces title, metadata, and notes body
      expect(result.isError).toBeFalsy();
      const text = textOf(result);
      expect(text).toContain("## Task: Write spec");
      expect(text).toContain("- project: work");
      expect(text).toContain("- priority: 2");
      expect(text).toContain("- labels: urgent");
      expect(text).toContain("- tags: q2");
      expect(text).toContain("### Notes");
      expect(text).toContain("Outline scope, risks, and rollout plan.");
    });

    test("missing description renders '(no notes)' placeholder", async () => {
      // Given: getTaskById returns a task without description
      registerTaskTools(
        server,
        buildDeps({
          query: {
            getTaskById: async (id) => buildTask({ id, description: null }),
          },
        }),
      );
      client = await connectClient(server);

      // When: fetching by id
      const result = await client.callTool({
        name: "get_task",
        arguments: { id: "abc" },
      });

      // Then: notes section shows placeholder
      expect(result.isError).toBeFalsy();
      expect(textOf(result)).toContain("(no notes)");
    });

    test("not found → isError", async () => {
      // Given: getTaskById returns null
      registerTaskTools(
        server,
        buildDeps({
          query: { getTaskById: async () => null },
        }),
      );
      client = await connectClient(server);

      // When: fetching unknown id
      const result = await client.callTool({
        name: "get_task",
        arguments: { id: "missing" },
      });

      // Then: structured error with 'task not found'
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("task not found");
    });

    test("AkiflowError → isError with userMessage", async () => {
      // Given: getTaskById throws AuthError
      registerTaskTools(
        server,
        buildDeps({
          query: {
            getTaskById: async () => {
              throw new AuthError("expired");
            },
          },
        }),
      );
      client = await connectClient(server);

      // When: fetching
      const result = await client.callTool({
        name: "get_task",
        arguments: { id: "abc" },
      });

      // Then: isError with localized userMessage
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("인증이 필요합니다");
    });
  });

  describe("includeNotes flag", () => {
    test("get_tasks default (false) hides notes preview", async () => {
      // Given: a task with a description
      registerTaskTools(
        server,
        buildDeps({
          query: {
            listTasks: async () => [buildTask({ description: "Sensitive notes body" })],
          },
        }),
      );
      client = await connectClient(server);

      // When: calling without includeNotes
      const result = await client.callTool({
        name: "get_tasks",
        arguments: {},
      });

      // Then: list does not contain the notes line
      expect(result.isError).toBeFalsy();
      expect(textOf(result)).not.toContain("Sensitive notes body");
      expect(textOf(result)).not.toContain("notes:");
    });

    test("get_tasks with includeNotes=true appends notes preview line", async () => {
      // Given: a task with a description
      registerTaskTools(
        server,
        buildDeps({
          query: {
            listTasks: async () => [buildTask({ description: "Outline rollout plan" })],
          },
        }),
      );
      client = await connectClient(server);

      // When: calling with includeNotes=true
      const result = await client.callTool({
        name: "get_tasks",
        arguments: { includeNotes: true },
      });

      // Then: notes preview is rendered under the task line
      expect(result.isError).toBeFalsy();
      const text = textOf(result);
      expect(text).toContain("notes: Outline rollout plan");
    });

    test("get_tasks with includeNotes truncates long descriptions with ellipsis", async () => {
      // Given: a long description (>200 chars)
      const longBody = "x".repeat(250);
      registerTaskTools(
        server,
        buildDeps({
          query: {
            listTasks: async () => [buildTask({ description: longBody })],
          },
        }),
      );
      client = await connectClient(server);

      // When: calling with includeNotes=true
      const result = await client.callTool({
        name: "get_tasks",
        arguments: { includeNotes: true },
      });

      // Then: preview is truncated with ellipsis marker
      const text = textOf(result);
      expect(text).toContain("…");
      expect(text).not.toContain("x".repeat(250));
    });

    test("search_tasks with includeNotes=true also renders preview", async () => {
      // Given: search returns one task with description
      registerTaskTools(
        server,
        buildDeps({
          query: {
            listTasks: async () => [buildTask({ title: "Write", description: "Inline body" })],
          },
        }),
      );
      client = await connectClient(server);

      // When: searching with includeNotes
      const result = await client.callTool({
        name: "search_tasks",
        arguments: { query: "Write", includeNotes: true },
      });

      // Then: preview surfaces
      expect(textOf(result)).toContain("notes: Inline body");
    });
  });

  describe("search_tasks", () => {
    test("label filter applied client-side", async () => {
      // Given: listTasks returns two tasks; only one has the label
      const returned = [
        buildTask({ id: "t-1", title: "Write spec", labels: ["urgent"] }),
        buildTask({ id: "t-2", title: "Write email", labels: ["later"] }),
      ];
      const captured: TaskQueryOptions[] = [];
      registerTaskTools(
        server,
        buildDeps({
          query: {
            listTasks: async (opts) => {
              captured.push(opts ?? {});
              return returned;
            },
          },
        }),
      );
      client = await connectClient(server);

      // When: searching with label=urgent
      const result = await client.callTool({
        name: "search_tasks",
        arguments: { query: "Write", label: "urgent" },
      });

      // Then: listTasks called with search=query; output includes only the labelled task
      expect(captured[0]?.search).toBe("Write");
      const text = textOf(result);
      expect(text).toContain("Write spec");
      expect(text).not.toContain("Write email");
    });

    test("empty query is rejected by zod (isError)", async () => {
      // Given: tools registered
      registerTaskTools(server, buildDeps());
      client = await connectClient(server);

      // When: calling with empty query
      const result = await client.callTool({
        name: "search_tasks",
        arguments: { query: "" },
      });

      // Then: zod validation fails → client surfaces an MCP error flag
      expect(result.isError).toBe(true);
    });
  });

  describe("create_task", () => {
    test("converts minutes→ms, composes datetime from date+time", async () => {
      // Given: createTask captures its input
      let captured: CreateTaskInput | null = null;
      registerTaskTools(
        server,
        buildDeps({
          command: {
            createTask: async (input) => {
              captured = input;
              return buildTask({ title: input.title, date: input.date ?? null });
            },
          },
        }),
      );
      client = await connectClient(server);

      // When: calling with time+duration+project
      await client.callTool({
        name: "create_task",
        arguments: {
          title: "Standup",
          date: "2026-04-17",
          time: "09:00",
          duration: 30,
          project: "work",
        },
      });

      // Then: service receives datetime=date+T+time:00, duration in ms, projectId
      expect(captured).toMatchObject({
        title: "Standup",
        date: "2026-04-17",
        datetime: "2026-04-17T09:00:00",
        duration: 30 * 60_000,
        projectId: "work",
      });
    });

    test("time without date → isError (not thrown)", async () => {
      // Given: create tools registered
      registerTaskTools(server, buildDeps());
      client = await connectClient(server);

      // When: calling with time and no date
      const result = await client.callTool({
        name: "create_task",
        arguments: { title: "x", time: "09:00" },
      });

      // Then: isError=true with informative message
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("`time` requires a `date`");
    });

    test("invalid date format rejected by zod", async () => {
      // Given: create tools registered
      registerTaskTools(server, buildDeps());
      client = await connectClient(server);

      // When: calling with malformed date
      const result = await client.callTool({
        name: "create_task",
        arguments: { title: "x", date: "04/17/2026" },
      });

      // Then: MCP surfaces validation error
      expect(result.isError).toBe(true);
    });
  });

  describe("update_task", () => {
    test("title-only patch does not touch date/datetime", async () => {
      // Given: updateTask captures (id, patch)
      const calls: Array<{ id: string; patch: UpdateTaskInput }> = [];
      registerTaskTools(
        server,
        buildDeps({
          command: {
            updateTask: async (id, patch) => {
              calls.push({ id, patch });
              return buildTask({ id, title: patch.title ?? "Sample task" });
            },
          },
        }),
      );
      client = await connectClient(server);

      // When: updating only the title
      await client.callTool({
        name: "update_task",
        arguments: { id: "abc", title: "New title" },
      });

      // Then: patch contains title only
      expect(calls).toEqual([{ id: "abc", patch: { title: "New title" } }]);
    });

    test("date=null clears the date", async () => {
      // Given: updateTask captures the patch
      const calls: Array<{ id: string; patch: UpdateTaskInput }> = [];
      registerTaskTools(
        server,
        buildDeps({
          command: {
            updateTask: async (id, patch) => {
              calls.push({ id, patch });
              return buildTask({ id });
            },
          },
        }),
      );
      client = await connectClient(server);

      // When: clearing date
      await client.callTool({
        name: "update_task",
        arguments: { id: "abc", date: null },
      });

      // Then: patch.date === null
      expect(calls[0]?.patch).toEqual({ date: null });
    });

    test("time without a known date → isError", async () => {
      // Given: task has no existing date
      registerTaskTools(
        server,
        buildDeps({
          query: { getTaskById: async () => buildTask({ date: null }) },
        }),
      );
      client = await connectClient(server);

      // When: setting time without date
      const result = await client.callTool({
        name: "update_task",
        arguments: { id: "abc", time: "09:00" },
      });

      // Then: isError with guidance
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("provide `date` alongside `time`");
    });

    test("empty patch → isError", async () => {
      // Given: tools registered
      registerTaskTools(server, buildDeps());
      client = await connectClient(server);

      // When: calling with only id
      const result = await client.callTool({
        name: "update_task",
        arguments: { id: "abc" },
      });

      // Then: isError with explanatory text
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("no fields to update");
    });

    test("NetworkError → isError with userMessage", async () => {
      // Given: updateTask throws NetworkError
      registerTaskTools(
        server,
        buildDeps({
          command: {
            updateTask: async () => {
              throw new NetworkError("offline");
            },
          },
        }),
      );
      client = await connectClient(server);

      // When: updating
      const result = await client.callTool({
        name: "update_task",
        arguments: { id: "abc", title: "x" },
      });

      // Then: userMessage surfaces
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("Akiflow 서버에 연결할 수 없습니다");
    });
  });

  describe("complete_task", () => {
    test("calls completeTask(id) and returns done summary", async () => {
      // Given: completeTask stub records id
      const ids: string[] = [];
      registerTaskTools(
        server,
        buildDeps({
          command: {
            completeTask: async (id) => {
              ids.push(id);
              return buildTask({ id, title: "X", done: true });
            },
          },
        }),
      );
      client = await connectClient(server);

      // When: completing the task
      const result = await client.callTool({
        name: "complete_task",
        arguments: { id: "abc" },
      });

      // Then: service receives id, output contains ✓ marker
      expect(ids).toEqual(["abc"]);
      expect(textOf(result)).toContain("Completed");
      expect(textOf(result)).toContain("✓");
    });
  });

  describe("delete_task", () => {
    test("calls deleteTask(id) and returns Deleted summary", async () => {
      // Given: deleteTask stub records id
      const ids: string[] = [];
      registerTaskTools(
        server,
        buildDeps({
          command: {
            deleteTask: async (id) => {
              ids.push(id);
              return buildTask({ id, title: "Obsolete", deleted_at: "2026-04-17T00:00:00.000Z" });
            },
          },
        }),
      );
      client = await connectClient(server);

      // When: deleting the task
      const result = await client.callTool({
        name: "delete_task",
        arguments: { id: "zzz" },
      });

      // Then: service receives id, output uses "Deleted" verb + task id
      expect(ids).toEqual(["zzz"]);
      expect(result.isError).toBeFalsy();
      const text = textOf(result);
      expect(text).toContain("Deleted");
      expect(text).toContain("zzz");
    });

    test("AkiflowError → isError with hint line", async () => {
      // Given: deleteTask throws NetworkError
      registerTaskTools(
        server,
        buildDeps({
          command: {
            deleteTask: async () => {
              throw new NetworkError("connection refused");
            },
          },
        }),
      );
      client = await connectClient(server);

      // When: calling the tool
      const result = await client.callTool({
        name: "delete_task",
        arguments: { id: "abc" },
      });

      // Then: isError flag and userMessage surface
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("네트워크");
    });
  });
});
