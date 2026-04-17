import { describe, expect, test } from "bun:test";
import {
  type BlockCommandComponents,
  buildBlockInput,
  type CliWriter,
  createBlockCommand,
  parseBlockDuration,
  type TaskCommandApi,
} from "../../../cli/commands/block.ts";
import { ValidationError } from "../../../core/errors/index.ts";
import type { LoggerPort } from "../../../core/ports/logger-port.ts";
import type { CreateTaskInput } from "../../../core/services/task-command-service.ts";
import type { Task } from "../../../core/types.ts";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    title: "blocked",
    date: null,
    datetime: null,
    duration: null,
    done: false,
    listId: null,
    status: 2,
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

function createFakeTaskCommand(overrides?: { createTask?: (input: CreateTaskInput) => Promise<Task> }): {
  service: TaskCommandApi;
  calls: { createTask: CreateTaskInput[] };
} {
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
// parseBlockDuration
// ---------------------------------------------------------------------------

describe("parseBlockDuration", () => {
  test("1h -> 3_600_000 ms", () => {
    // Given: '1h'. When: parsed. Then: one hour in ms.
    expect(parseBlockDuration("1h")).toBe(3_600_000);
  });

  test("30m -> 1_800_000 ms", () => {
    // Given: '30m'. When: parsed. Then: 30 minutes in ms.
    expect(parseBlockDuration("30m")).toBe(1_800_000);
  });

  test("2h30m -> 9_000_000 ms", () => {
    // Given: composite '2h30m'. When: parsed. Then: 2h + 30m in ms.
    expect(parseBlockDuration("2h30m")).toBe(9_000_000);
  });

  test("empty/invalid inputs raise ValidationError", () => {
    // Given: unrecognized tokens. When: parsed. Then: ValidationError.
    expect(() => parseBlockDuration("")).toThrow(ValidationError);
    expect(() => parseBlockDuration("abc")).toThrow(ValidationError);
    expect(() => parseBlockDuration("1x")).toThrow(ValidationError);
  });

  test("zero duration raises ValidationError", () => {
    // Given: '0h0m' (or equivalent). When: parsed. Then: ValidationError.
    expect(() => parseBlockDuration("0h0m")).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// buildBlockInput
// ---------------------------------------------------------------------------

describe("buildBlockInput", () => {
  const now = new Date("2026-04-16T10:00:00.000Z");

  test("--at HH:MM applied to today's date", () => {
    // Given: duration 1h and --at 09:00. When: built. Then: datetime set, duration 1h in ms.
    const input = buildBlockInput("Deep work", { duration: "1h", at: "09:00" }, now);
    expect(input.duration).toBe(3_600_000);
    expect(input.datetime).toMatch(/T09:00:00$/);
    expect(input.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("--date overrides today", () => {
    // Given: explicit date and time. When: built. Then: date = given, datetime has HH:MM.
    const input = buildBlockInput("Deep work", { duration: "30m", date: "2026-05-01", at: "14:00" }, now);
    expect(input.date).toBe("2026-05-01");
    expect(input.datetime).toBe("2026-05-01T14:00:00");
  });

  test("missing title raises ValidationError", () => {
    // Given: empty title. When: built. Then: ValidationError.
    expect(() => buildBlockInput("", { duration: "1h" }, now)).toThrow(ValidationError);
  });

  test("invalid --at format raises ValidationError", () => {
    // Given: malformed time. When: built. Then: ValidationError.
    expect(() => buildBlockInput("x", { duration: "1h", at: "25:99" }, now)).toThrow(ValidationError);
  });

  test("invalid --date raises ValidationError", () => {
    // Given: malformed date. When: built. Then: ValidationError.
    expect(() => buildBlockInput("x", { duration: "1h", date: "not-a-date", at: "09:00" }, now)).toThrow(
      ValidationError,
    );
  });
});

// ---------------------------------------------------------------------------
// createBlockCommand (integration)
// ---------------------------------------------------------------------------

describe("createBlockCommand", () => {
  test("invokes taskCommand.createTask with parsed payload", async () => {
    // Given: fake TaskCommand and capturing stdout
    const { service, calls } = createFakeTaskCommand({
      createTask: async (input) =>
        makeTask({
          title: input.title,
          date: input.date ?? null,
          datetime: input.datetime ?? null,
          duration: input.duration ?? null,
        }),
    });
    const components: BlockCommandComponents = { taskCommand: service, logger: silentLogger() };
    const { stream, chunks } = capturingStream();
    const cmd = createBlockCommand(components, {
      stdout: stream,
      now: () => new Date("2026-04-16T10:00:00.000Z"),
    });

    // When: run with '1h "Deep work" --at 09:00'
    await cmd.run?.({
      rawArgs: ["1h", "Deep work", "--at", "09:00"],
      args: {
        _: ["1h", "Deep work"],
        duration: "1h",
        title: "Deep work",
        at: "09:00",
      },
      cmd,
    });

    // Then: createTask invoked with expected shape, stdout includes 'Blocked'
    expect(calls.createTask).toHaveLength(1);
    const payload = calls.createTask[0];
    expect(payload.title).toBe("Deep work");
    expect(payload.duration).toBe(3_600_000);
    expect(payload.datetime).toMatch(/T09:00:00$/);
    expect(chunks.join("")).toContain("Blocked");
  });
});
