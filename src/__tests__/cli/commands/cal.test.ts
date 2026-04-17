import { describe, expect, test } from "bun:test";
import {
  addDaysIso,
  type CalCommandComponents,
  type CalQueryApi,
  type CliWriter,
  computeFreeSlots,
  createCalCommand,
  fetchRange,
  formatEventsText,
  parseDays,
  resolveStartDate,
} from "../../../cli/commands/cal.ts";
import { ValidationError } from "../../../core/errors/index.ts";
import type { LoggerPort } from "../../../core/ports/logger-port.ts";
import type { Calendar, CalendarEvent } from "../../../core/types.ts";

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "ev-1",
    title: "Sync",
    start: "2026-04-16T10:00:00Z",
    end: "2026-04-16T11:00:00Z",
    calendarId: "cal-primary",
    ...overrides,
  };
}

function createFakeQuery(overrides?: {
  getEvents?: (date: string) => Promise<CalendarEvent[]>;
  getCalendars?: () => Promise<Calendar[]>;
}): { service: CalQueryApi; calls: { getEvents: string[]; getCalendars: number } } {
  const calls = { getEvents: [] as string[], getCalendars: 0 };
  const service: CalQueryApi = {
    async getEvents(date) {
      calls.getEvents.push(date);
      return overrides?.getEvents ? overrides.getEvents(date) : [];
    },
    async getCalendars() {
      calls.getCalendars++;
      return overrides?.getCalendars ? overrides.getCalendars() : [];
    },
  };
  return { service, calls };
}

function silentLogger(): LoggerPort {
  return { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

function capturingStream(): { stream: CliWriter; chunks: string[] } {
  const chunks: string[] = [];
  return {
    stream: {
      write(chunk: string) {
        chunks.push(chunk);
        return true;
      },
    },
    chunks,
  };
}

// ---------------------------------------------------------------------------
// resolveStartDate / parseDays / addDaysIso
// ---------------------------------------------------------------------------

describe("resolveStartDate", () => {
  test("missing input returns today's ISO date", () => {
    // Given: no date input. When: resolved. Then: today's date.
    const out = resolveStartDate(undefined, new Date("2026-04-16T10:00:00Z"));
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("valid YYYY-MM-DD is passed through", () => {
    // Given: explicit ISO date. When: resolved. Then: same string.
    expect(resolveStartDate("2026-05-01", new Date())).toBe("2026-05-01");
  });

  test("invalid date raises ValidationError", () => {
    // Given: malformed input. When: resolved. Then: ValidationError.
    expect(() => resolveStartDate("not-a-date", new Date())).toThrow(ValidationError);
  });
});

describe("parseDays", () => {
  test("undefined defaults to 1", () => {
    expect(parseDays(undefined)).toBe(1);
  });

  test("valid integer passes through", () => {
    expect(parseDays("3")).toBe(3);
  });

  test("zero or negative raises ValidationError", () => {
    expect(() => parseDays("0")).toThrow(ValidationError);
    expect(() => parseDays("-1")).toThrow(ValidationError);
  });

  test("non-integer raises ValidationError", () => {
    expect(() => parseDays("abc")).toThrow(ValidationError);
    expect(() => parseDays("1.5")).toThrow(ValidationError);
  });

  test("over MAX_DAYS raises ValidationError", () => {
    expect(() => parseDays("99")).toThrow(ValidationError);
  });
});

describe("addDaysIso", () => {
  test("crosses month boundary", () => {
    expect(addDaysIso("2026-04-30", 2)).toBe("2026-05-02");
  });
});

// ---------------------------------------------------------------------------
// computeFreeSlots
// ---------------------------------------------------------------------------

describe("computeFreeSlots", () => {
  test("no events → single slot spanning the whole work window", () => {
    // Given: no events. When: computed. Then: one slot 09:00-18:00.
    const slots = computeFreeSlots([], "2026-04-16", "09:00", "18:00");
    expect(slots).toEqual([{ start: "09:00", end: "18:00" }]);
  });

  test("single meeting splits the window into two gaps", () => {
    // Given: 10:00-11:00 event. When: computed. Then: gaps before and after.
    const events = [makeEvent({ start: "2026-04-16T10:00:00", end: "2026-04-16T11:00:00" })];
    const slots = computeFreeSlots(events, "2026-04-16", "09:00", "18:00");
    expect(slots).toEqual([
      { start: "09:00", end: "10:00" },
      { start: "11:00", end: "18:00" },
    ]);
  });

  test("overlapping events are merged before computing gaps", () => {
    // Given: overlapping 10-12 and 11-13 events. When: computed. Then: single busy block.
    const events = [
      makeEvent({ id: "a", start: "2026-04-16T10:00:00", end: "2026-04-16T12:00:00" }),
      makeEvent({ id: "b", start: "2026-04-16T11:00:00", end: "2026-04-16T13:00:00" }),
    ];
    const slots = computeFreeSlots(events, "2026-04-16", "09:00", "18:00");
    expect(slots).toEqual([
      { start: "09:00", end: "10:00" },
      { start: "13:00", end: "18:00" },
    ]);
  });

  test("events outside the window are ignored", () => {
    // Given: 07:00-08:00 and 19:00-20:00 (outside 09-18). When: computed. Then: full window free.
    const events = [
      makeEvent({ id: "a", start: "2026-04-16T07:00:00", end: "2026-04-16T08:00:00" }),
      makeEvent({ id: "b", start: "2026-04-16T19:00:00", end: "2026-04-16T20:00:00" }),
    ];
    const slots = computeFreeSlots(events, "2026-04-16", "09:00", "18:00");
    expect(slots).toEqual([{ start: "09:00", end: "18:00" }]);
  });
});

// ---------------------------------------------------------------------------
// fetchRange
// ---------------------------------------------------------------------------

describe("fetchRange", () => {
  test("days=3 queries three consecutive dates", async () => {
    // Given: spying fake
    const { service, calls } = createFakeQuery();
    // When: fetching 3 days
    await fetchRange(service, "2026-04-16", 3);
    // Then: three sequential dates hit
    expect(calls.getEvents).toEqual(["2026-04-16", "2026-04-17", "2026-04-18"]);
  });
});

// ---------------------------------------------------------------------------
// formatEventsText
// ---------------------------------------------------------------------------

describe("formatEventsText", () => {
  test("maps calendar IDs to names, sorts by start time", () => {
    // Given: two events in reverse order with a known calendar mapping
    const byDate = {
      "2026-04-16": [
        makeEvent({ id: "a", title: "Later", start: "2026-04-16T15:00:00", end: "2026-04-16T16:00:00" }),
        makeEvent({ id: "b", title: "Earlier", start: "2026-04-16T09:00:00", end: "2026-04-16T10:00:00" }),
      ],
    };
    const calendars: Calendar[] = [{ id: "cal-primary", name: "Primary", provider: "google" }];
    // When: formatted
    const out = formatEventsText(byDate, calendars);
    // Then: 'Earlier' comes before 'Later', 'Primary' label is used
    expect(out.indexOf("Earlier")).toBeLessThan(out.indexOf("Later"));
    expect(out).toContain("Primary");
    expect(out).toContain("2026-04-16");
  });

  test("empty date shows '(no events)'", () => {
    // Given: empty events for a date
    const out = formatEventsText({ "2026-04-16": [] }, []);
    // Then: placeholder is rendered
    expect(out).toContain("(no events)");
  });
});

// ---------------------------------------------------------------------------
// createCalCommand (integration)
// ---------------------------------------------------------------------------

describe("createCalCommand", () => {
  test("defaults to today's events", async () => {
    // Given: spying fake
    const { service, calls } = createFakeQuery({
      getEvents: async (d) => (d === "2026-04-16" ? [makeEvent()] : []),
    });
    const components: CalCommandComponents = { taskQuery: service, logger: silentLogger() };
    const { stream, chunks } = capturingStream();
    const cmd = createCalCommand(components, { stdout: stream, now: () => new Date("2026-04-16T10:00:00Z") });

    // When: invoked with no flags
    await cmd.run?.({
      rawArgs: [],
      args: { _: [], free: false, json: false },
      cmd,
    });

    // Then: today's date was queried
    expect(calls.getEvents).toEqual(["2026-04-16"]);
    expect(chunks.join("")).toContain("Sync");
  });

  test("--date specific date is forwarded", async () => {
    // Given: spying fake
    const { service, calls } = createFakeQuery();
    const components: CalCommandComponents = { taskQuery: service, logger: silentLogger() };
    const { stream } = capturingStream();
    const cmd = createCalCommand(components, { stdout: stream, now: () => new Date("2026-04-16T10:00:00Z") });

    // When: --date 2026-05-01
    await cmd.run?.({
      rawArgs: ["--date", "2026-05-01"],
      args: { _: [], date: "2026-05-01", free: false, json: false },
      cmd,
    });

    // Then: the given date was queried
    expect(calls.getEvents).toEqual(["2026-05-01"]);
  });

  test("--free emits free-slot text", async () => {
    // Given: one event at 10-11
    const { service } = createFakeQuery({
      getEvents: async () => [makeEvent({ start: "2026-04-16T10:00:00", end: "2026-04-16T11:00:00" })],
    });
    const components: CalCommandComponents = { taskQuery: service, logger: silentLogger() };
    const { stream, chunks } = capturingStream();
    const cmd = createCalCommand(components, { stdout: stream, now: () => new Date("2026-04-16T10:00:00Z") });

    // When: --free is passed
    await cmd.run?.({
      rawArgs: ["--free"],
      args: { _: [], free: true, json: false },
      cmd,
    });

    // Then: output contains free-slot markers
    const out = chunks.join("");
    expect(out).toContain("free slots");
    expect(out).toContain("09:00-10:00");
    expect(out).toContain("11:00-18:00");
  });

  test("--days N queries N consecutive dates", async () => {
    // Given: spying fake
    const { service, calls } = createFakeQuery();
    const components: CalCommandComponents = { taskQuery: service, logger: silentLogger() };
    const { stream } = capturingStream();
    const cmd = createCalCommand(components, { stdout: stream, now: () => new Date("2026-04-16T10:00:00Z") });

    // When: --date 2026-04-16 --days 3
    await cmd.run?.({
      rawArgs: ["--date", "2026-04-16", "--days", "3"],
      args: { _: [], date: "2026-04-16", days: "3", free: false, json: false },
      cmd,
    });

    // Then: three sequential days were queried
    expect(calls.getEvents).toEqual(["2026-04-16", "2026-04-17", "2026-04-18"]);
  });
});
