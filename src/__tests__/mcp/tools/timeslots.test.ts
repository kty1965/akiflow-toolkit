import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CreateTimeSlotInput, TimeSlot, UpdateTimeSlotInput } from "@core/types.ts";
import {
  CREATE_TIME_SLOT_TOOL_NAME,
  DELETE_TIME_SLOT_TOOL_NAME,
  formatTimeSlotsForLLM,
  GET_TIME_SLOTS_TOOL_NAME,
  registerTimeSlotTools,
  type TimeSlotToolsDeps,
  todayIso,
  UPDATE_TIME_SLOT_TOOL_NAME,
} from "@mcp/tools/timeslots.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function buildSlot(overrides: Partial<TimeSlot> = {}): TimeSlot {
  return {
    id: "slot-1",
    calendarId: "cal-primary",
    title: "Deep work",
    description: null,
    start: "2026-04-16T09:00:00Z",
    end: "2026-04-16T10:00:00Z",
    status: "confirmed",
    recurrence: null,
    ...overrides,
  };
}

function buildDeps(overrides: Partial<TimeSlotToolsDeps> = {}): TimeSlotToolsDeps {
  return {
    taskQuery: { getTimeSlots: async () => [], ...overrides.taskQuery },
    taskCommand: {
      createTimeSlot: async () => buildSlot(),
      updateTimeSlot: async () => buildSlot(),
      deleteTimeSlot: async () => buildSlot(),
      ...overrides.taskCommand,
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

describe("mcp/tools/timeslots", () => {
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

  describe("get_time_slots", () => {
    test("registers a readOnly tool and defaults to today", async () => {
      const calls: string[] = [];
      registerTimeSlotTools(
        server,
        buildDeps({
          taskQuery: {
            getTimeSlots: async (date) => {
              calls.push(date);
              return [];
            },
          },
        }),
      );
      client = await connectClient(server);

      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === GET_TIME_SLOTS_TOOL_NAME);
      expect(tool).toBeDefined();
      expect(tool?.annotations?.readOnlyHint).toBe(true);

      const result = await client.callTool({ name: GET_TIME_SLOTS_TOOL_NAME, arguments: {} });
      expect(calls).toEqual([todayIso()]);
      expect(result.isError).toBeFalsy();
    });

    test("formats a non-empty result with title/time/id", async () => {
      registerTimeSlotTools(server, buildDeps({ taskQuery: { getTimeSlots: async () => [buildSlot()] } }));
      client = await connectClient(server);

      const result = await client.callTool({ name: GET_TIME_SLOTS_TOOL_NAME, arguments: {} });
      expect(textOf(result)).toContain("Deep work");
      expect(textOf(result)).toContain("slot-1");
    });

    test("underlying service throws → isError=true", async () => {
      registerTimeSlotTools(
        server,
        buildDeps({
          taskQuery: {
            getTimeSlots: async () => {
              throw new Error("token refresh failed");
            },
          },
        }),
      );
      client = await connectClient(server);

      const result = await client.callTool({ name: GET_TIME_SLOTS_TOOL_NAME, arguments: {} });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("token refresh failed");
    });
  });

  describe("create_time_slot", () => {
    test("passes args through to taskCommand.createTimeSlot and formats the result", async () => {
      const calls: CreateTimeSlotInput[] = [];
      registerTimeSlotTools(
        server,
        buildDeps({
          taskCommand: {
            createTimeSlot: async (input) => {
              calls.push(input);
              return buildSlot({ title: input.title });
            },
            updateTimeSlot: async () => buildSlot(),
            deleteTimeSlot: async () => buildSlot(),
          },
        }),
      );
      client = await connectClient(server);

      const result = await client.callTool({
        name: CREATE_TIME_SLOT_TOOL_NAME,
        arguments: {
          calendar_id: "cal-primary",
          title: "Focus block",
          start_datetime: "2026-04-20T09:00:00+09:00",
          end_datetime: "2026-04-20T10:00:00+09:00",
        },
      });

      expect(calls).toEqual([
        {
          calendarId: "cal-primary",
          title: "Focus block",
          startDatetime: "2026-04-20T09:00:00+09:00",
          endDatetime: "2026-04-20T10:00:00+09:00",
          description: undefined,
        },
      ]);
      expect(result.isError).toBeFalsy();
      expect(textOf(result)).toContain("Created");
      expect(textOf(result)).toContain("Focus block");
    });
  });

  describe("update_time_slot", () => {
    test("no fields provided → isError without calling the service", async () => {
      const calls: UpdateTimeSlotInput[] = [];
      registerTimeSlotTools(
        server,
        buildDeps({
          taskCommand: {
            createTimeSlot: async () => buildSlot(),
            updateTimeSlot: async (input) => {
              calls.push(input);
              return buildSlot();
            },
            deleteTimeSlot: async () => buildSlot(),
          },
        }),
      );
      client = await connectClient(server);

      const result = await client.callTool({
        name: UPDATE_TIME_SLOT_TOOL_NAME,
        arguments: { time_slot_id: "slot-1" },
      });

      expect(calls).toEqual([]);
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("no fields to update");
    });

    test("partial update only passes provided fields", async () => {
      const calls: UpdateTimeSlotInput[] = [];
      registerTimeSlotTools(
        server,
        buildDeps({
          taskCommand: {
            createTimeSlot: async () => buildSlot(),
            updateTimeSlot: async (input) => {
              calls.push(input);
              return buildSlot({ title: input.title ?? "Deep work" });
            },
            deleteTimeSlot: async () => buildSlot(),
          },
        }),
      );
      client = await connectClient(server);

      const result = await client.callTool({
        name: UPDATE_TIME_SLOT_TOOL_NAME,
        arguments: { time_slot_id: "slot-1", title: "Renamed block" },
      });

      expect(calls).toEqual([{ timeSlotId: "slot-1", title: "Renamed block" }]);
      expect(result.isError).toBeFalsy();
      expect(textOf(result)).toContain("Updated");
      expect(textOf(result)).toContain("Renamed block");
    });
  });

  describe("delete_time_slot", () => {
    test("registers a destructive/idempotent tool and calls taskCommand.deleteTimeSlot", async () => {
      const calls: string[] = [];
      registerTimeSlotTools(
        server,
        buildDeps({
          taskCommand: {
            createTimeSlot: async () => buildSlot(),
            updateTimeSlot: async () => buildSlot(),
            deleteTimeSlot: async (id) => {
              calls.push(id);
              return buildSlot({ id });
            },
          },
        }),
      );
      client = await connectClient(server);

      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === DELETE_TIME_SLOT_TOOL_NAME);
      expect(tool?.annotations?.destructiveHint).toBe(true);
      expect(tool?.annotations?.idempotentHint).toBe(true);

      const result = await client.callTool({
        name: DELETE_TIME_SLOT_TOOL_NAME,
        arguments: { time_slot_id: "slot-1" },
      });

      expect(calls).toEqual(["slot-1"]);
      expect(result.isError).toBeFalsy();
      expect(textOf(result)).toContain("Deleted");
    });
  });

  describe("formatTimeSlotsForLLM", () => {
    test("empty list → friendly message", () => {
      expect(formatTimeSlotsForLLM([], "2026-04-16")).toContain("타임 슬롯이 없습니다");
    });
  });
});
