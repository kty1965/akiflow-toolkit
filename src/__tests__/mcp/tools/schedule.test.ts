import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AuthError } from "../../../core/errors/index.ts";
import type { LoggerPort } from "../../../core/ports/logger-port.ts";
import type { Task } from "../../../core/types.ts";
import { registerScheduleTools, type ScheduleToolsDeps } from "../../../mcp/tools/schedule.ts";

const silentLogger: LoggerPort = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function buildTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    title: "Sample",
    date: null,
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

type CommandStub = Partial<ScheduleToolsDeps["taskCommand"]>;

function buildDeps(overrides: { command?: CommandStub } = {}): ScheduleToolsDeps {
  const command: ScheduleToolsDeps["taskCommand"] = {
    scheduleTask:
      overrides.command?.scheduleTask ??
      (async (id, date, time) => buildTask({ id, date, datetime: time ? `${date}T${time}:00` : null })),
    unscheduleTask: overrides.command?.unscheduleTask ?? (async (id) => buildTask({ id })),
  };
  return { taskCommand: command, logger: silentLogger };
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

describe("mcp/tools/schedule", () => {
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
    test("registers schedule_task and unschedule_task with idempotent annotations", async () => {
      // Given: schedule tools registered
      registerScheduleTools(server, buildDeps());
      client = await connectClient(server);

      // When: listing tools
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();

      // Then: both tools are present with the right annotations + example-laden descriptions
      expect(names).toEqual(["schedule_task", "unschedule_task"]);
      const schedule = tools.find((t) => t.name === "schedule_task");
      expect(schedule?.annotations?.idempotentHint).toBe(true);
      expect(schedule?.description ?? "").toContain("Examples:");
      const unschedule = tools.find((t) => t.name === "unschedule_task");
      expect(unschedule?.annotations?.idempotentHint).toBe(true);
    });
  });

  describe("schedule_task", () => {
    test("forwards id/date/time to scheduleTask and renders scheduled summary", async () => {
      // Given: a stub that captures arguments
      const calls: Array<{ id: string; date: string; time?: string }> = [];
      registerScheduleTools(
        server,
        buildDeps({
          command: {
            scheduleTask: async (id, date, time) => {
              calls.push({ id, date, time });
              return buildTask({ id, date, datetime: time ? `${date}T${time}:00` : null });
            },
          },
        }),
      );
      client = await connectClient(server);

      // When: scheduling for 2026-04-20 at 09:00
      const result = await client.callTool({
        name: "schedule_task",
        arguments: { id: "abc", date: "2026-04-20", time: "09:00" },
      });

      // Then: service sees the exact args and output says "Scheduled"
      expect(calls).toEqual([{ id: "abc", date: "2026-04-20", time: "09:00" }]);
      expect(result.isError).toBeFalsy();
      expect(textOf(result)).toContain("Scheduled");
      expect(textOf(result)).toContain("09:00");
    });

    test("time defaults to undefined when not given", async () => {
      // Given: a stub that records whether time is passed
      const calls: Array<{ id: string; date: string; time?: string }> = [];
      registerScheduleTools(
        server,
        buildDeps({
          command: {
            scheduleTask: async (id, date, time) => {
              calls.push({ id, date, time });
              return buildTask({ id, date });
            },
          },
        }),
      );
      client = await connectClient(server);

      // When: scheduling date-only
      await client.callTool({
        name: "schedule_task",
        arguments: { id: "abc", date: "2026-04-20" },
      });

      // Then: service called with time === undefined
      expect(calls[0]?.time).toBeUndefined();
    });

    test("malformed date → zod validation isError", async () => {
      // Given: tools registered
      registerScheduleTools(server, buildDeps());
      client = await connectClient(server);

      // When: calling with wrong date format
      const result = await client.callTool({
        name: "schedule_task",
        arguments: { id: "abc", date: "04/20/2026" },
      });

      // Then: isError flag set
      expect(result.isError).toBe(true);
    });

    test("service throws AkiflowError → isError with user hint", async () => {
      // Given: stub throws AuthError
      registerScheduleTools(
        server,
        buildDeps({
          command: {
            scheduleTask: async () => {
              throw new AuthError("bad");
            },
          },
        }),
      );
      client = await connectClient(server);

      // When: calling
      const result = await client.callTool({
        name: "schedule_task",
        arguments: { id: "abc", date: "2026-04-20" },
      });

      // Then: isError=true, user-facing text includes the Korean hint
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("인증이 필요합니다");
    });
  });

  describe("unschedule_task", () => {
    test("forwards id and renders Unscheduled summary", async () => {
      // Given: stub captures id
      const ids: string[] = [];
      registerScheduleTools(
        server,
        buildDeps({
          command: {
            unscheduleTask: async (id) => {
              ids.push(id);
              return buildTask({ id });
            },
          },
        }),
      );
      client = await connectClient(server);

      // When: unscheduling
      const result = await client.callTool({
        name: "unschedule_task",
        arguments: { id: "abc" },
      });

      // Then: service invoked; output label + inbox marker appear
      expect(ids).toEqual(["abc"]);
      expect(textOf(result)).toContain("Unscheduled");
      expect(textOf(result)).toContain("(inbox)");
    });

    test("generic Error → isError labelled with tool name", async () => {
      // Given: stub throws generic Error
      registerScheduleTools(
        server,
        buildDeps({
          command: {
            unscheduleTask: async () => {
              throw new Error("boom");
            },
          },
        }),
      );
      client = await connectClient(server);

      // When: calling
      const result = await client.callTool({
        name: "unschedule_task",
        arguments: { id: "abc" },
      });

      // Then: unexpected-error label appears
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("unschedule_task: unexpected error");
    });
  });
});
