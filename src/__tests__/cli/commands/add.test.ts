import { describe, expect, test } from "bun:test";
import {
  type AddCommandComponents,
  type CliWriter,
  type TaskCommandApi,
  buildCreateInput,
  createAddCommand,
  parseDurationMs,
  resolveDate,
} from "../../../cli/commands/add.ts";
import { ValidationError } from "../../../core/errors/index.ts";
import type { LoggerPort } from "../../../core/ports/logger-port.ts";
import type { CreateTaskInput } from "../../../core/services/task-command-service.ts";
import type { Task } from "../../../core/types.ts";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    title: "sample",
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

function createFakeTaskCommand(overrides?: {
  createTask?: (input: CreateTaskInput) => Promise<Task>;
}): { service: TaskCommandApi; calls: { createTask: CreateTaskInput[] } } {
  const calls = { createTask: [] as CreateTaskInput[] };
  const service: TaskCommandApi = {
    async createTask(input) {
      calls.createTask.push(input);
      return overrides?.createTask ? overrides.createTask(input) : makeTask({ title: input.title });
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
// parseDurationMs
// ---------------------------------------------------------------------------

describe("parseDurationMs", () => {
  test("1h -> 3_600_000 ms", () => {
    // Given: '1h' token. When: parsed. Then: 3_600_000 ms.
    expect(parseDurationMs("1h")).toBe(3_600_000);
  });

  test("30m -> 1_800_000 ms", () => {
    // Given: '30m'. When: parsed. Then: 30*60_000 ms.
    expect(parseDurationMs("30m")).toBe(1_800_000);
  });

  test("45s -> 45_000 ms", () => {
    // Given: '45s'. When: parsed. Then: 45_000 ms.
    expect(parseDurationMs("45s")).toBe(45_000);
  });

  test("invalid values raise ValidationError", () => {
    // Given: unparseable duration. When: parsing. Then: ValidationError is thrown.
    expect(() => parseDurationMs("abc")).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// resolveDate
// ---------------------------------------------------------------------------

describe("resolveDate", () => {
  const now = new Date("2026-04-16T10:00:00.000Z");

  test("--today resolves to today's ISO date", () => {
    // Given: --today flag. When: resolved. Then: current date string returned.
    const out = resolveDate({ today: true, tomorrow: false }, now);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("--tomorrow advances by one day", () => {
    // Given: --tomorrow. When: resolved. Then: date increments by 1.
    const todayIso = resolveDate({ today: true, tomorrow: false }, now) ?? "";
    const tomorrowIso = resolveDate({ today: false, tomorrow: true }, now) ?? "";
    expect(tomorrowIso > todayIso).toBe(true);
  });

  test("--date YYYY-MM-DD passes through untouched", () => {
    // Given: explicit ISO date. When: resolved. Then: same string returned.
    expect(resolveDate({ today: false, tomorrow: false, date: "2026-05-01" }, now)).toBe("2026-05-01");
  });

  test("--date natural language parses via chrono-node", () => {
    // Given: natural-language date. When: resolved. Then: parsed to an ISO date string.
    const out = resolveDate({ today: false, tomorrow: false, date: "next monday" }, now);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("--date gibberish raises ValidationError", () => {
    // Given: unparseable date. When: resolved. Then: ValidationError is thrown.
    expect(() => resolveDate({ today: false, tomorrow: false, date: "$$$" }, now)).toThrow(ValidationError);
  });

  test("--today + --tomorrow is rejected", () => {
    // Given: conflicting flags. When: resolved. Then: ValidationError.
    expect(() => resolveDate({ today: true, tomorrow: true }, now)).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// buildCreateInput
// ---------------------------------------------------------------------------

describe("buildCreateInput", () => {
  const now = new Date("2026-04-16T10:00:00.000Z");

  test("--at HH:MM combines with date into ISO datetime", () => {
    // Given: title with --today --at 14:00. When: built. Then: datetime is YYYY-MM-DDT14:00:00.
    const input = buildCreateInput("회의 준비", { today: true, tomorrow: false, at: "14:00" }, now);
    expect(input.datetime).toMatch(/T14:00:00$/);
    expect(input.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("--duration 1h sets 3_600_000 ms", () => {
    // Given: --today --duration 1h. When: built. Then: duration = 3_600_000.
    const input = buildCreateInput("task", { today: true, tomorrow: false, duration: "1h" }, now);
    expect(input.duration).toBe(3_600_000);
  });

  test("--project routes to listId on the create payload", () => {
    // Given: --project Work. When: built. Then: projectId is set.
    const input = buildCreateInput("task", { today: false, tomorrow: false, project: "Work" }, now);
    expect(input.projectId).toBe("Work");
  });

  test("--at without any date flag raises ValidationError", () => {
    // Given: --at but no date. When: built. Then: ValidationError is thrown.
    expect(() => buildCreateInput("task", { today: false, tomorrow: false, at: "14:00" }, now)).toThrow(
      ValidationError,
    );
  });

  test("invalid --at format raises ValidationError", () => {
    // Given: malformed time. When: built. Then: ValidationError.
    expect(() => buildCreateInput("task", { today: true, tomorrow: false, at: "25:99" }, now)).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// createAddCommand (integration)
// ---------------------------------------------------------------------------

describe("createAddCommand", () => {
  test("passes parsed flags to taskCommand.createTask and prints a success message", async () => {
    // Given: a fake TaskCommand + capturing stdout
    const { service, calls } = createFakeTaskCommand({
      createTask: async (input) =>
        makeTask({
          title: input.title,
          date: input.date ?? null,
          datetime: input.datetime ?? null,
          duration: input.duration ?? null,
          listId: input.projectId ?? null,
        }),
    });
    const components: AddCommandComponents = { taskCommand: service, logger: silentLogger() };
    const { stream, chunks } = capturingStream();
    const cmd = createAddCommand(components, { stdout: stream, now: () => new Date("2026-04-16T10:00:00.000Z") });

    // When: running with --today --at 14:00 --duration 1h -p Work
    await cmd.run?.({
      rawArgs: ["회의 준비", "--today", "--at", "14:00", "--duration", "1h", "-p", "Work"],
      args: {
        _: ["회의 준비"],
        title: "회의 준비",
        today: true,
        tomorrow: false,
        at: "14:00",
        duration: "1h",
        project: "Work",
      },
      cmd,
    });

    // Then: createTask is invoked with correctly derived payload and stdout shows 'Created'
    expect(calls.createTask).toHaveLength(1);
    const payload = calls.createTask[0];
    expect(payload.title).toBe("회의 준비");
    expect(payload.duration).toBe(3_600_000);
    expect(payload.projectId).toBe("Work");
    expect(payload.datetime).toMatch(/T14:00:00$/);
    expect(chunks.join("")).toContain("Created");
  });
});
