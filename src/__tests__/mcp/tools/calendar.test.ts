import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CalendarEvent } from "../../../core/types.ts";
import {
  type CalendarToolsDeps,
  GET_EVENTS_TOOL_NAME,
  addDaysIso,
  formatEventsForLLM,
  registerCalendarTools,
  todayIso,
} from "../../../mcp/tools/calendar.ts";

function buildDeps(getEvents: (date: string) => Promise<CalendarEvent[]>): CalendarToolsDeps {
  return { taskQuery: { getEvents } };
}

function buildEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "ev-1",
    title: "Sync meeting",
    start: "2026-04-16T10:00:00Z",
    end: "2026-04-16T11:00:00Z",
    calendarId: "cal-primary",
    ...overrides,
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

describe("mcp/tools/calendar", () => {
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

  describe("get_events tool registration", () => {
    test("registers a readOnly tool with examples in description", async () => {
      // Given: a server with calendar tools registered
      registerCalendarTools(
        server,
        buildDeps(async () => []),
      );
      client = await connectClient(server);

      // When: the client lists tools
      const { tools } = await client.listTools();
      const events = tools.find((t) => t.name === GET_EVENTS_TOOL_NAME);

      // Then: the tool is present, readOnly, and description includes usage examples
      expect(events).toBeDefined();
      expect(events?.annotations?.readOnlyHint).toBe(true);
      expect(events?.description ?? "").toContain("예:");
    });
  });

  describe("get_events date defaults", () => {
    test("missing date → queries today's events", async () => {
      // Given: a stub that records the date it was called with
      const calls: string[] = [];
      registerCalendarTools(
        server,
        buildDeps(async (date) => {
          calls.push(date);
          return [];
        }),
      );
      client = await connectClient(server);

      // When: calling get_events without a date
      const result = await client.callTool({ name: GET_EVENTS_TOOL_NAME, arguments: {} });

      // Then: it falls back to today's ISO date
      expect(calls).toEqual([todayIso()]);
      expect(result.isError).toBeFalsy();
    });

    test("explicit date → queried as-is", async () => {
      // Given: a stub that captures the date and returns one event
      const calls: string[] = [];
      registerCalendarTools(
        server,
        buildDeps(async (date) => {
          calls.push(date);
          return [buildEvent({ start: `${date}T09:00:00Z`, end: `${date}T10:00:00Z` })];
        }),
      );
      client = await connectClient(server);

      // When: calling with an explicit date
      const result = await client.callTool({
        name: GET_EVENTS_TOOL_NAME,
        arguments: { date: "2026-05-01" },
      });

      // Then: the stub is invoked with that exact date and the title is rendered
      expect(calls).toEqual(["2026-05-01"]);
      expect(textOf(result)).toContain("Sync meeting");
      expect(textOf(result)).toContain("2026-05-01");
    });
  });

  describe("multi-day range (days param)", () => {
    test("days=3 → queries three consecutive days", async () => {
      // Given: a stub that records each date
      const calls: string[] = [];
      registerCalendarTools(
        server,
        buildDeps(async (date) => {
          calls.push(date);
          return [];
        }),
      );
      client = await connectClient(server);

      // When: asking for 3 days from 2026-04-16
      await client.callTool({
        name: GET_EVENTS_TOOL_NAME,
        arguments: { date: "2026-04-16", days: 3 },
      });

      // Then: three sequential dates are queried
      expect(calls).toEqual(["2026-04-16", "2026-04-17", "2026-04-18"]);
    });
  });

  describe("empty results", () => {
    test("no events → returns friendly empty message, not isError", async () => {
      // Given: a stub returning empty arrays
      registerCalendarTools(
        server,
        buildDeps(async () => []),
      );
      client = await connectClient(server);

      // When: calling the tool
      const result = await client.callTool({ name: GET_EVENTS_TOOL_NAME, arguments: {} });

      // Then: not an error; body explains no events
      expect(result.isError).toBeFalsy();
      expect(textOf(result)).toContain("일정이 없습니다");
    });
  });

  describe("error handling", () => {
    test("underlying service throws → isError=true with recovery hint", async () => {
      // Given: a stub that throws
      registerCalendarTools(
        server,
        buildDeps(async () => {
          throw new Error("token refresh failed");
        }),
      );
      client = await connectClient(server);

      // When: calling the tool
      const result = await client.callTool({ name: GET_EVENTS_TOOL_NAME, arguments: {} });

      // Then: isError flag set, error message + recovery guidance
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("token refresh failed");
      expect(textOf(result)).toContain("af auth");
    });
  });

  describe("date helpers", () => {
    test("addDaysIso handles month boundary", () => {
      // Given/When: adding 2 days across a month boundary
      // Then: output lands in the next month
      expect(addDaysIso("2026-04-30", 2)).toBe("2026-05-02");
    });

    test("formatEventsForLLM sorts by start time", () => {
      // Given: two events in reverse chronological order
      const events = [
        buildEvent({ id: "a", title: "Later", start: "2026-04-16T15:00:00Z" }),
        buildEvent({ id: "b", title: "Earlier", start: "2026-04-16T09:00:00Z" }),
      ];
      // When: formatting the list
      const out = formatEventsForLLM(events, "2026-04-16");
      // Then: "Earlier" appears before "Later" in output
      expect(out.indexOf("Earlier")).toBeLessThan(out.indexOf("Later"));
    });
  });
});
