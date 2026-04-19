import { describe, expect, test } from "bun:test";
import {
  type CliWriter,
  createDoCommand,
  type DoCommandComponents,
  resolveInputs,
  type TaskCache,
  type TaskCompleteApi,
} from "@cli/commands/do.ts";
import { NotFoundError } from "@core/errors/index.ts";
import type { LoggerPort } from "@core/ports/logger-port.ts";
import type { Task } from "@core/types.ts";

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

function createFakeTaskCommand(): { service: TaskCompleteApi; calls: string[] } {
  const calls: string[] = [];
  const service: TaskCompleteApi = {
    async completeTask(id) {
      calls.push(id);
      return makeTask({ id, done: true });
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

// ---------------------------------------------------------------------------
// resolveInputs — pure resolution logic
// ---------------------------------------------------------------------------

describe("resolveInputs", () => {
  const task = makeTask({ id: "abc123de-4444-5555-6666-777788889999" });
  const shortMap = { "1": task.id };

  test("short numeric ID → full UUID via cache.resolveShortId", async () => {
    // Given: cache knows short ID '1' → UUID. When: resolving '1'. Then: full UUID returned.
    const out = await resolveInputs(["1"], createFakeCache([task], shortMap));
    expect(out).toEqual([task.id]);
  });

  test("exact UUID passes through unchanged", async () => {
    // Given: exact UUID present in tasks. When: resolving. Then: same UUID returned.
    const out = await resolveInputs([task.id], createFakeCache([task], {}));
    expect(out).toEqual([task.id]);
  });

  test("6+ char UUID prefix resolves to full UUID", async () => {
    // Given: prefix 'abc123de'. When: resolving. Then: full UUID returned.
    const out = await resolveInputs(["abc123de"], createFakeCache([task], {}));
    expect(out).toEqual([task.id]);
  });

  test("unknown ID raises NotFoundError", async () => {
    // Given: id not in tasks or short map. When: resolving. Then: NotFoundError thrown.
    await expect(resolveInputs(["zz9999"], createFakeCache([task], {}))).rejects.toThrow(NotFoundError);
  });

  test("resolves multiple inputs in order", async () => {
    // Given: two distinct inputs. When: resolving. Then: returns two UUIDs in input order.
    const other = makeTask({ id: "ffffffff-4444-5555-6666-777788880000" });
    const out = await resolveInputs(["1", other.id], createFakeCache([task, other], shortMap));
    expect(out).toEqual([task.id, other.id]);
  });
});

// ---------------------------------------------------------------------------
// createDoCommand — integration
// ---------------------------------------------------------------------------

describe("createDoCommand", () => {
  test("invokes completeTask once per resolved ID and reports count", async () => {
    // Given: two tasks + short map covering both, a spying task command
    const t1 = makeTask({ id: "uuid-1" });
    const t2 = makeTask({ id: "uuid-2" });
    const cache = createFakeCache([t1, t2], { "1": t1.id, "2": t2.id });
    const { service, calls } = createFakeTaskCommand();
    const components: DoCommandComponents = {
      taskCommand: service,
      cache,
      logger: silentLogger(),
    };
    const { stream, chunks } = capturingStream();
    const cmd = createDoCommand(components, { stdout: stream });

    // When: invoking with two short IDs
    await cmd.run?.({
      rawArgs: ["1", "2"],
      args: { _: ["1", "2"], ids: ["1", "2"] },
      cmd,
    });

    // Then: completeTask was called twice with each UUID and summary prints '2'
    expect(calls).toEqual([t1.id, t2.id]);
    expect(chunks.join("")).toContain("Completed 2");
  });
});
