import { describe, expect, test } from "bun:test";
import {
  type CliWriter,
  type TaskCache,
  type TaskCommandComponents,
  type TaskWriteApi,
  createDeleteCommand,
  createEditCommand,
  createMoveCommand,
  createPlanCommand,
  createSnoozeCommand,
  createTaskCommand,
  parseDateFlag,
  resolveInput,
  validateRecurrence,
} from "../../../cli/commands/task.ts";
import { NotFoundError, ValidationError } from "../../../core/errors/index.ts";
import type { LoggerPort } from "../../../core/ports/logger-port.ts";
import type { UpdateTaskInput } from "../../../core/services/task-command-service.ts";
import type { Task } from "../../../core/types.ts";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-000000000001",
    title: "task",
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

interface FakeTaskCommand {
  service: TaskWriteApi;
  calls: {
    updateTask: Array<{ id: string; patch: UpdateTaskInput }>;
    scheduleTask: Array<{ id: string; date: string; time?: string }>;
    deleteTask: string[];
  };
}

function createFakeTaskCommand(response: (id: string, patch?: UpdateTaskInput) => Task): FakeTaskCommand {
  const calls: FakeTaskCommand["calls"] = { updateTask: [], scheduleTask: [], deleteTask: [] };
  const service: TaskWriteApi = {
    async updateTask(id, patch) {
      calls.updateTask.push({ id, patch });
      return response(id, patch);
    },
    async scheduleTask(id, date, time) {
      calls.scheduleTask.push({ id, date, time });
      return response(id, { date, datetime: time ? `${date}T${time}:00` : null });
    },
    async deleteTask(id) {
      calls.deleteTask.push(id);
      return response(id);
    },
  };
  return { service, calls };
}

function createFakeCache(tasks: Task[], shortMap: Record<string, string>): TaskCache {
  return {
    async getTasks() {
      return tasks;
    },
    async resolveShortId(shortId) {
      return shortMap[shortId] ?? null;
    },
  };
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

// handleCliError calls process.exit which normally terminates the process.
// A function that always throws has return type `never`, matching process.exit's signature.
async function withMockedExit<T>(run: () => Promise<T>): Promise<{ exits: number[]; thrown: unknown }> {
  const exits: number[] = [];
  const origExit = process.exit;
  const mockExit: typeof process.exit = (code) => {
    exits.push(typeof code === "number" ? code : 0);
    throw new Error("__exit__");
  };
  process.exit = mockExit;
  try {
    await run();
    return { exits, thrown: null };
  } catch (err) {
    return { exits, thrown: err };
  } finally {
    process.exit = origExit;
  }
}

// ---------------------------------------------------------------------------
// resolveInput — short ID / UUID / prefix resolution
// ---------------------------------------------------------------------------

describe("resolveInput", () => {
  const task = makeTask({ id: "abc123de-4444-5555-6666-777788889999" });
  const cache = createFakeCache([task], { "1": task.id });

  test("short numeric ID → full UUID via cache", async () => {
    // Given: short ID '1' is cached. When: resolving '1'. Then: full UUID returned.
    expect(await resolveInput("1", cache)).toBe(task.id);
  });

  test("6+ char UUID prefix → full UUID", async () => {
    // Given: unique UUID prefix. When: resolving. Then: full UUID returned.
    expect(await resolveInput("abc123de", cache)).toBe(task.id);
  });

  test("unknown ID raises NotFoundError", async () => {
    // Given: id unknown. When: resolving. Then: NotFoundError thrown (exit 5).
    await expect(resolveInput("zzzzzz99", cache)).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// parseDateFlag — YYYY-MM-DD passthrough + chrono fallback
// ---------------------------------------------------------------------------

describe("parseDateFlag", () => {
  const now = new Date("2026-04-17T10:00:00Z");

  test("ISO date passes through unchanged", () => {
    // Given: already-ISO date. When: parsed. Then: same string returned.
    expect(parseDateFlag("2026-05-01", now)).toBe("2026-05-01");
  });

  test("natural 'tomorrow' resolves via chrono", () => {
    // Given: 'tomorrow' relative to 2026-04-17. When: parsed. Then: 2026-04-18 returned.
    expect(parseDateFlag("tomorrow", now)).toBe("2026-04-18");
  });

  test("unrecognized text raises ValidationError", () => {
    // Given: gibberish. When: parsed. Then: ValidationError (exit 4).
    expect(() => parseDateFlag("not-a-date", now)).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// validateRecurrence — RRULE guard via rrule
// ---------------------------------------------------------------------------

describe("validateRecurrence", () => {
  test("valid RRULE returns trimmed value", () => {
    // Given: 'FREQ=WEEKLY;BYDAY=MO'. When: validated. Then: same string returned.
    expect(validateRecurrence("FREQ=WEEKLY;BYDAY=MO")).toBe("FREQ=WEEKLY;BYDAY=MO");
  });

  test("invalid RRULE raises ValidationError", () => {
    // Given: garbage rule. When: validated. Then: ValidationError (exit 4).
    expect(() => validateRecurrence("not-an-rrule")).toThrow(ValidationError);
  });

  test("empty string raises ValidationError", () => {
    // Given: whitespace only. When: validated. Then: ValidationError.
    expect(() => validateRecurrence("   ")).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// createEditCommand — title/date patch
// ---------------------------------------------------------------------------

describe("createEditCommand", () => {
  test("--title updates title and prints summary", async () => {
    // Given: task + short ID '1'. When: edit 1 --title 'New'. Then: updateTask called with {title}.
    const t = makeTask({ id: "u-1", title: "old" });
    const { service, calls } = createFakeTaskCommand((id, patch) => ({ ...t, id, title: patch?.title ?? t.title }));
    const { stream, chunks } = capturingStream();
    const components: TaskCommandComponents = {
      taskCommand: service,
      cache: createFakeCache([t], { "1": t.id }),
      logger: silentLogger(),
    };
    const cmd = createEditCommand(components, { stdout: stream });
    await cmd.run?.({ rawArgs: ["1", "--title", "New"], args: { _: ["1"], id: "1", title: "New" }, cmd });

    expect(calls.updateTask).toEqual([{ id: t.id, patch: { title: "New" } }]);
    expect(chunks.join("")).toContain("Edited task");
    expect(chunks.join("")).toContain("New");
  });

  test("--date accepts natural language via chrono", async () => {
    // Given: task + now=2026-04-17. When: edit 1 -d tomorrow. Then: updateTask called with {date:'2026-04-18'}.
    const t = makeTask({ id: "u-2" });
    const { service, calls } = createFakeTaskCommand((id, patch) => ({ ...t, id, date: patch?.date ?? null }));
    const { stream } = capturingStream();
    const components: TaskCommandComponents = {
      taskCommand: service,
      cache: createFakeCache([t], { "1": t.id }),
      logger: silentLogger(),
    };
    const cmd = createEditCommand(components, { stdout: stream, now: () => new Date("2026-04-17T10:00:00Z") });
    await cmd.run?.({ rawArgs: ["1", "-d", "tomorrow"], args: { _: ["1"], id: "1", date: "tomorrow" }, cmd });

    expect(calls.updateTask).toEqual([{ id: t.id, patch: { date: "2026-04-18" } }]);
  });
});

// ---------------------------------------------------------------------------
// createMoveCommand / createSnoozeCommand — scheduleTask wiring
// ---------------------------------------------------------------------------

describe("createMoveCommand", () => {
  test("resolves short ID and calls scheduleTask", async () => {
    // Given: task + short ID '1'. When: move 1 -d 2026-04-20 --at 09:00. Then: scheduleTask invoked.
    const t = makeTask({ id: "u-3" });
    const { service, calls } = createFakeTaskCommand((id, patch) => ({
      ...t,
      id,
      date: patch?.date ?? null,
      datetime: patch?.datetime ?? null,
    }));
    const { stream, chunks } = capturingStream();
    const components: TaskCommandComponents = {
      taskCommand: service,
      cache: createFakeCache([t], { "1": t.id }),
      logger: silentLogger(),
    };
    const cmd = createMoveCommand(components, { stdout: stream });
    await cmd.run?.({
      rawArgs: ["1", "-d", "2026-04-20", "--at", "09:00"],
      args: { _: ["1"], id: "1", date: "2026-04-20", at: "09:00" },
      cmd,
    });

    expect(calls.scheduleTask).toEqual([{ id: t.id, date: "2026-04-20", time: "09:00" }]);
    expect(chunks.join("")).toContain("Moved task");
  });

  test("invalid --at time exits with VALIDATION code (exit 4)", async () => {
    // Given: bogus time '25:99'. When: move invoked. Then: handleCliError calls process.exit(4).
    const t = makeTask({ id: "u-3" });
    const { service } = createFakeTaskCommand((id) => ({ ...t, id }));
    const components: TaskCommandComponents = {
      taskCommand: service,
      cache: createFakeCache([t], { "1": t.id }),
      logger: silentLogger(),
    };
    const cmd = createMoveCommand(components, { stdout: { write: () => true } });
    const { exits, thrown } = await withMockedExit(() =>
      Promise.resolve(
        cmd.run?.({
          rawArgs: ["1", "-d", "2026-04-20", "--at", "25:99"],
          args: { _: ["1"], id: "1", date: "2026-04-20", at: "25:99" },
          cmd,
        }),
      ),
    );

    expect(exits).toEqual([4]);
    expect(thrown).toBeInstanceOf(Error);
  });
});

describe("createSnoozeCommand", () => {
  test("uses same shape as move but prints 'Snoozed'", async () => {
    // Given: task. When: snooze invoked. Then: scheduleTask called + output says 'Snoozed'.
    const t = makeTask({ id: "u-4" });
    const { service, calls } = createFakeTaskCommand((id, patch) => ({
      ...t,
      id,
      date: patch?.date ?? null,
      datetime: patch?.datetime ?? null,
    }));
    const { stream, chunks } = capturingStream();
    const components: TaskCommandComponents = {
      taskCommand: service,
      cache: createFakeCache([t], { "1": t.id }),
      logger: silentLogger(),
    };
    const cmd = createSnoozeCommand(components, { stdout: stream });
    await cmd.run?.({
      rawArgs: ["1", "-d", "2026-04-25"],
      args: { _: ["1"], id: "1", date: "2026-04-25" },
      cmd,
    });

    expect(calls.scheduleTask).toEqual([{ id: t.id, date: "2026-04-25", time: undefined }]);
    expect(chunks.join("")).toContain("Snoozed task");
  });
});

// ---------------------------------------------------------------------------
// createPlanCommand — time + optional recurrence
// ---------------------------------------------------------------------------

describe("createPlanCommand", () => {
  test("existing date + --at sets datetime via updateTask", async () => {
    // Given: task already dated 2026-04-17. When: plan with --at 14:00. Then: datetime set.
    const t = makeTask({ id: "u-5", date: "2026-04-17" });
    const { service, calls } = createFakeTaskCommand((id, patch) => ({
      ...t,
      id,
      date: patch?.date ?? t.date,
      datetime: patch?.datetime ?? null,
      recurrence: patch?.recurrence ?? null,
    }));
    const { stream } = capturingStream();
    const components: TaskCommandComponents = {
      taskCommand: service,
      cache: createFakeCache([t], { "1": t.id }),
      logger: silentLogger(),
    };
    const cmd = createPlanCommand(components, { stdout: stream });
    await cmd.run?.({ rawArgs: ["1", "--at", "14:00"], args: { _: ["1"], id: "1", at: "14:00" }, cmd });

    expect(calls.updateTask).toEqual([{ id: t.id, patch: { date: "2026-04-17", datetime: "2026-04-17T14:00:00" } }]);
  });

  test("--recurrence validates and propagates RRULE", async () => {
    // Given: task with date. When: plan ... --recurrence 'FREQ=WEEKLY;BYDAY=MO'. Then: patch.recurrence set.
    const t = makeTask({ id: "u-6", date: "2026-04-17" });
    const { service, calls } = createFakeTaskCommand((id, patch) => ({
      ...t,
      id,
      date: patch?.date ?? t.date,
      datetime: patch?.datetime ?? null,
      recurrence: patch?.recurrence ?? null,
    }));
    const { stream } = capturingStream();
    const components: TaskCommandComponents = {
      taskCommand: service,
      cache: createFakeCache([t], { "1": t.id }),
      logger: silentLogger(),
    };
    const cmd = createPlanCommand(components, { stdout: stream });
    await cmd.run?.({
      rawArgs: ["1", "--at", "09:00", "--recurrence", "FREQ=WEEKLY;BYDAY=MO"],
      args: { _: ["1"], id: "1", at: "09:00", recurrence: "FREQ=WEEKLY;BYDAY=MO" },
      cmd,
    });

    expect(calls.updateTask).toEqual([
      {
        id: t.id,
        patch: {
          date: "2026-04-17",
          datetime: "2026-04-17T09:00:00",
          recurrence: "FREQ=WEEKLY;BYDAY=MO",
        },
      },
    ]);
  });

  test("missing date on inbox task exits with VALIDATION code (exit 4)", async () => {
    // Given: inbox task (no date). When: plan --at only. Then: ValidationError → exit 4.
    const t = makeTask({ id: "u-7", date: null });
    const { service } = createFakeTaskCommand((id) => ({ ...t, id }));
    const components: TaskCommandComponents = {
      taskCommand: service,
      cache: createFakeCache([t], { "1": t.id }),
      logger: silentLogger(),
    };
    const cmd = createPlanCommand(components, { stdout: { write: () => true } });
    const { exits, thrown } = await withMockedExit(() =>
      Promise.resolve(cmd.run?.({ rawArgs: ["1", "--at", "09:00"], args: { _: ["1"], id: "1", at: "09:00" }, cmd })),
    );

    expect(exits).toEqual([4]);
    expect(thrown).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// createDeleteCommand — soft delete
// ---------------------------------------------------------------------------

describe("createDeleteCommand", () => {
  test("invokes deleteTask with resolved UUID", async () => {
    // Given: task + short ID '1'. When: delete 1. Then: deleteTask called, output includes 'Deleted'.
    const t = makeTask({ id: "u-8" });
    const { service, calls } = createFakeTaskCommand((id) => ({ ...t, id, deleted_at: "2026-04-17T00:00:00Z" }));
    const { stream, chunks } = capturingStream();
    const components: TaskCommandComponents = {
      taskCommand: service,
      cache: createFakeCache([t], { "1": t.id }),
      logger: silentLogger(),
    };
    const cmd = createDeleteCommand(components, { stdout: stream });
    await cmd.run?.({ rawArgs: ["1"], args: { _: ["1"], id: "1" }, cmd });

    expect(calls.deleteTask).toEqual([t.id]);
    expect(chunks.join("")).toContain("Deleted task");
  });

  test("unknown ID exits with NOT_FOUND code (exit 5)", async () => {
    // Given: cache has no matching task. When: delete 99. Then: handleCliError exits with 5.
    const { service } = createFakeTaskCommand((id) => ({ ...makeTask(), id }));
    const components: TaskCommandComponents = {
      taskCommand: service,
      cache: createFakeCache([], {}),
      logger: silentLogger(),
    };
    const cmd = createDeleteCommand(components, { stdout: { write: () => true } });
    const { exits, thrown } = await withMockedExit(() =>
      Promise.resolve(cmd.run?.({ rawArgs: ["99"], args: { _: ["99"], id: "99" }, cmd })),
    );

    expect(exits).toEqual([5]);
    expect(thrown).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// createTaskCommand — composition smoke check
// ---------------------------------------------------------------------------

describe("createTaskCommand", () => {
  test("exposes edit/move/plan/snooze/delete subcommands", () => {
    // Given: composed task command. When: inspecting subCommands. Then: all five keys present.
    const components: TaskCommandComponents = {
      taskCommand: createFakeTaskCommand((id) => ({ ...makeTask(), id })).service,
      cache: createFakeCache([], {}),
      logger: silentLogger(),
    };
    const cmd = createTaskCommand(components);
    const subs = cmd.subCommands;
    if (!subs || typeof subs !== "object" || typeof subs === "function") {
      throw new Error("expected subCommands to be a plain object");
    }
    expect(Object.keys(subs).sort()).toEqual(["delete", "edit", "move", "plan", "snooze"]);
  });
});
