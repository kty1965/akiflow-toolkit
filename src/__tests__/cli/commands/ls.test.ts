import { describe, expect, test } from "bun:test";
import {
  buildQueryOptions,
  buildShortIdMap,
  type CliWriter,
  createLsCommand,
  formatTasksText,
  type LsCommandComponents,
  type ShortIdCache,
  type TaskQueryApi,
} from "../../../cli/commands/ls.ts";
import type { LoggerPort } from "../../../core/ports/logger-port.ts";
import type { Task, TaskQueryOptions } from "../../../core/types.ts";

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

function createFakeTaskQuery(overrides?: {
  listTasks?: (options?: TaskQueryOptions) => Promise<Task[]>;
  searchTasks?: (query: string) => Promise<Task[]>;
}): { service: TaskQueryApi; calls: { listTasks: TaskQueryOptions[]; searchTasks: string[] } } {
  const calls = { listTasks: [] as TaskQueryOptions[], searchTasks: [] as string[] };
  const service: TaskQueryApi = {
    async listTasks(options = {}) {
      calls.listTasks.push(options);
      return overrides?.listTasks ? overrides.listTasks(options) : [];
    },
    async searchTasks(query) {
      calls.searchTasks.push(query);
      return overrides?.searchTasks ? overrides.searchTasks(query) : [];
    },
  };
  return { service, calls };
}

function createFakeCache(): { cache: ShortIdCache; saved: Record<string, string>[] } {
  const saved: Record<string, string>[] = [];
  const cache: ShortIdCache = {
    async saveShortIdMap(map) {
      saved.push({ ...map });
    },
  };
  return { cache, saved };
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
// buildQueryOptions
// ---------------------------------------------------------------------------

describe("buildQueryOptions", () => {
  const now = new Date("2026-04-16T10:00:00.000Z");

  test("no flags defaults to today's date filter", () => {
    // Given: empty flag set. When: built. Then: filter=today, date set.
    const opts = buildQueryOptions({ inbox: false, done: false, all: false, today: false }, now);
    expect(opts.filter).toBe("today");
    expect(opts.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("--inbox sets filter=inbox with no date", () => {
    // Given: --inbox. When: built. Then: filter='inbox', date undefined.
    const opts = buildQueryOptions({ inbox: true, done: false, all: false, today: false }, now);
    expect(opts.filter).toBe("inbox");
    expect(opts.date).toBeUndefined();
  });

  test("--done sets filter=done", () => {
    // Given: --done. When: built. Then: filter='done'.
    const opts = buildQueryOptions({ inbox: false, done: true, all: false, today: false }, now);
    expect(opts.filter).toBe("done");
  });

  test("--all sets filter=all with no date", () => {
    // Given: --all. When: built. Then: filter='all'.
    const opts = buildQueryOptions({ inbox: false, done: false, all: true, today: false }, now);
    expect(opts.filter).toBe("all");
  });

  test("--project propagates", () => {
    // Given: --project 'Work'. When: built. Then: project is set.
    const opts = buildQueryOptions({ inbox: true, done: false, all: false, today: false, project: "Work" }, now);
    expect(opts.project).toBe("Work");
  });

  test("--search propagates and skips default today filter", () => {
    // Given: --search '회의'. When: built. Then: search set, no today filter.
    const opts = buildQueryOptions({ inbox: false, done: false, all: false, today: false, search: "회의" }, now);
    expect(opts.search).toBe("회의");
    expect(opts.filter).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildShortIdMap
// ---------------------------------------------------------------------------

describe("buildShortIdMap", () => {
  test("assigns 1-based short IDs mapped to task UUIDs", () => {
    // Given: 3 tasks. When: map built. Then: keys '1','2','3' point to each UUID.
    const tasks = [makeTask({ id: "uuid-1" }), makeTask({ id: "uuid-2" }), makeTask({ id: "uuid-3" })];
    const map = buildShortIdMap(tasks);
    expect(map).toEqual({ "1": "uuid-1", "2": "uuid-2", "3": "uuid-3" });
  });
});

// ---------------------------------------------------------------------------
// formatTasksText
// ---------------------------------------------------------------------------

describe("formatTasksText", () => {
  test("renders '(no tasks)' for empty list", () => {
    // Given: empty task list. When: formatted. Then: placeholder text.
    expect(formatTasksText([])).toContain("(no tasks)");
  });

  test("includes title and short id for each row", () => {
    // Given: one task. When: formatted. Then: text contains the title and index '1'.
    const text = formatTasksText([makeTask({ title: "hello" })]);
    expect(text).toContain("hello");
    expect(text.startsWith("  1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createLsCommand — integration
// ---------------------------------------------------------------------------

describe("createLsCommand", () => {
  test("saves short ID map to cache after listing", async () => {
    // Given: a service returning two tasks
    const tasks = [makeTask({ id: "uuid-a", title: "a" }), makeTask({ id: "uuid-b", title: "b" })];
    const { service } = createFakeTaskQuery({ listTasks: async () => tasks });
    const { cache, saved } = createFakeCache();
    const components: LsCommandComponents = {
      taskQuery: service,
      cache,
      logger: silentLogger(),
    };
    const { stream } = capturingStream();
    const cmd = createLsCommand(components, { stdout: stream, now: () => new Date("2026-04-16T10:00:00.000Z") });

    // When: running with no flags
    await cmd.run?.({
      rawArgs: [],
      args: {
        _: [],
        inbox: false,
        done: false,
        all: false,
        today: false,
        json: false,
      },
      cmd,
    });

    // Then: cache received a map with two entries keyed 1,2
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual({ "1": "uuid-a", "2": "uuid-b" });
  });

  test("--json emits a JSON array on stdout", async () => {
    // Given: one task
    const task = makeTask({ id: "uuid-j", title: "json-task" });
    const { service } = createFakeTaskQuery({ listTasks: async () => [task] });
    const { cache } = createFakeCache();
    const components: LsCommandComponents = {
      taskQuery: service,
      cache,
      logger: silentLogger(),
    };
    const { stream, chunks } = capturingStream();
    const cmd = createLsCommand(components, { stdout: stream, now: () => new Date("2026-04-16T10:00:00.000Z") });

    // When: running with --json
    await cmd.run?.({
      rawArgs: ["--json"],
      args: {
        _: [],
        inbox: false,
        done: false,
        all: false,
        today: false,
        json: true,
      },
      cmd,
    });

    // Then: stdout is a JSON array that round-trips back to the same payload
    const out = chunks.join("");
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe("uuid-j");
  });

  test("--inbox calls listTasks with filter='inbox'", async () => {
    // Given: a spying service
    const { service, calls } = createFakeTaskQuery();
    const { cache } = createFakeCache();
    const components: LsCommandComponents = {
      taskQuery: service,
      cache,
      logger: silentLogger(),
    };
    const { stream } = capturingStream();
    const cmd = createLsCommand(components, { stdout: stream });

    // When: running with --inbox
    await cmd.run?.({
      rawArgs: ["--inbox"],
      args: {
        _: [],
        inbox: true,
        done: false,
        all: false,
        today: false,
        json: false,
      },
      cmd,
    });

    // Then: the service received filter='inbox'
    expect(calls.listTasks).toHaveLength(1);
    expect(calls.listTasks[0].filter).toBe("inbox");
  });

  test("--search routes to searchTasks (not listTasks)", async () => {
    // Given: a spying service
    const { service, calls } = createFakeTaskQuery({ searchTasks: async () => [] });
    const { cache } = createFakeCache();
    const components: LsCommandComponents = {
      taskQuery: service,
      cache,
      logger: silentLogger(),
    };
    const { stream } = capturingStream();
    const cmd = createLsCommand(components, { stdout: stream });

    // When: running with --search '회의'
    await cmd.run?.({
      rawArgs: ["--search", "회의"],
      args: {
        _: [],
        inbox: false,
        done: false,
        all: false,
        today: false,
        json: false,
        search: "회의",
      },
      cmd,
    });

    // Then: searchTasks was called with the query
    expect(calls.searchTasks).toEqual(["회의"]);
    expect(calls.listTasks).toHaveLength(0);
  });
});
