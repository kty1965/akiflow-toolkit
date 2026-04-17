import { describe, expect, test } from "bun:test";
import { NetworkError } from "../../../core/errors/index.ts";
import type { AkiflowHttpPort, ListTasksParams } from "../../../core/ports/akiflow-http-port.ts";
import type { CacheMeta, CachePort } from "../../../core/ports/cache-port.ts";
import type { LoggerPort } from "../../../core/ports/logger-port.ts";
import type { StoragePort } from "../../../core/ports/storage-port.ts";
import { AuthService } from "../../../core/services/auth-service.ts";
import { TaskQueryService } from "../../../core/services/task-query-service.ts";
import type {
  ApiResponse,
  Calendar,
  CalendarEvent,
  CreateTaskPayload,
  Credentials,
  Label,
  Tag,
  Task,
  TimeSlot,
  UpdateTaskPayload,
} from "../../../core/types.ts";

function createLogger(): LoggerPort {
  return {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function makeCredentials(overrides: Partial<Credentials> = {}): Credentials {
  return {
    accessToken: "access_xyz",
    refreshToken: "refresh_xyz",
    clientId: "client-1",
    expiresAt: Date.now() + 60 * 60 * 1000,
    savedAt: new Date().toISOString(),
    source: "manual",
    ...overrides,
  };
}

function createStorage(initial: Credentials | null): StoragePort {
  let current = initial;
  return {
    async saveCredentials(creds) {
      current = creds;
    },
    async loadCredentials() {
      return current;
    },
    async clearCredentials() {
      current = null;
    },
    getConfigDir() {
      return "/tmp/test";
    },
  };
}

function buildAuth(): AuthService {
  return new AuthService({
    storage: createStorage(makeCredentials()),
    browserReaders: [],
    refreshAccessToken: async () => ({
      token_type: "Bearer",
      expires_in: 3600,
      access_token: "refreshed",
      refresh_token: "refreshed_r",
    }),
    logger: createLogger(),
  });
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "A task",
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

interface HttpState {
  calls: Array<{ method: string; args: unknown[] }>;
}

interface StubHttpOptions {
  getTasks?: (token: string, params?: ListTasksParams) => Promise<ApiResponse<Task[]>>;
  getLabels?: (token: string) => Promise<ApiResponse<Label[]>>;
  getTags?: (token: string) => Promise<ApiResponse<Tag[]>>;
  getCalendars?: (token: string) => Promise<ApiResponse<Calendar[]>>;
  getEvents?: (token: string, date: string) => Promise<ApiResponse<CalendarEvent[]>>;
  getTimeSlots?: (token: string, date: string) => Promise<ApiResponse<TimeSlot[]>>;
  patchTasks?: (token: string, tasks: Array<CreateTaskPayload | UpdateTaskPayload>) => Promise<ApiResponse<Task[]>>;
}

function createStubHttp(opts: StubHttpOptions): { port: AkiflowHttpPort; state: HttpState } {
  const state: HttpState = { calls: [] };
  const defaultOk = <T>(data: T): ApiResponse<T> => ({ success: true, message: null, data });
  const port: AkiflowHttpPort = {
    async getTasks(token, params) {
      state.calls.push({ method: "getTasks", args: [token, params] });
      return opts.getTasks ? opts.getTasks(token, params) : defaultOk([] as Task[]);
    },
    async patchTasks(token, tasks) {
      state.calls.push({ method: "patchTasks", args: [token, tasks] });
      return opts.patchTasks ? opts.patchTasks(token, tasks) : defaultOk([] as Task[]);
    },
    async getLabels(token) {
      state.calls.push({ method: "getLabels", args: [token] });
      return opts.getLabels ? opts.getLabels(token) : defaultOk([] as Label[]);
    },
    async getTags(token) {
      state.calls.push({ method: "getTags", args: [token] });
      return opts.getTags ? opts.getTags(token) : defaultOk([] as Tag[]);
    },
    async getCalendars(token) {
      state.calls.push({ method: "getCalendars", args: [token] });
      return opts.getCalendars ? opts.getCalendars(token) : defaultOk([] as Calendar[]);
    },
    async getEvents(token, date) {
      state.calls.push({ method: "getEvents", args: [token, date] });
      return opts.getEvents ? opts.getEvents(token, date) : defaultOk([] as CalendarEvent[]);
    },
    async getTimeSlots(token, date) {
      state.calls.push({ method: "getTimeSlots", args: [token, date] });
      return opts.getTimeSlots ? opts.getTimeSlots(token, date) : defaultOk([] as TimeSlot[]);
    },
  };
  return { port, state };
}

function createStubCache(initial?: { tasks?: Task[]; meta?: CacheMeta | null }): {
  port: CachePort;
  state: { tasks: Task[]; meta: CacheMeta | null; setTasksCalls: number; setMetaCalls: number };
} {
  const state = {
    tasks: initial?.tasks ?? [],
    meta: initial?.meta ?? null,
    setTasksCalls: 0,
    setMetaCalls: 0,
  };
  const port: CachePort = {
    async getTasks() {
      return state.tasks;
    },
    async setTasks(tasks) {
      state.setTasksCalls++;
      state.tasks = tasks;
    },
    async upsertTask() {},
    async removeTask() {},
    async getMeta() {
      return state.meta;
    },
    async setMeta(meta) {
      state.setMetaCalls++;
      state.meta = meta;
    },
    async saveShortIdMap() {},
    async resolveShortId() {
      return null;
    },
    async enqueuePending() {},
    async getPending() {
      return [];
    },
    async removePending() {},
    async clearAll() {},
    getCacheDir() {
      return "/tmp/test-cache";
    },
  };
  return { port, state };
}

describe("TaskQueryService", () => {
  describe("listTasks", () => {
    test("single page → one getTasks call, returns data", async () => {
      // Given: HTTP returns one page with no pagination flag
      const { port, state } = createStubHttp({
        async getTasks() {
          return {
            success: true,
            message: null,
            data: [makeTask({ id: "t1" }), makeTask({ id: "t2" })],
          };
        },
      });
      const service = new TaskQueryService({ auth: buildAuth(), http: port, logger: createLogger() });

      // When: list without options
      const tasks = await service.listTasks();

      // Then: one HTTP call, both tasks returned
      expect(state.calls.filter((c) => c.method === "getTasks")).toHaveLength(1);
      expect(tasks.map((t) => t.id)).toEqual(["t1", "t2"]);
    });

    test("multi-page pagination via sync_token", async () => {
      // Given: HTTP returns two pages, then stops
      let page = 0;
      const { port, state } = createStubHttp({
        async getTasks(_token, params) {
          page++;
          if (page === 1) {
            return {
              success: true,
              message: null,
              data: [makeTask({ id: "p1" })],
              sync_token: "tok2",
              has_next_page: true,
            };
          }
          // page 2 — ensure caller passed the sync_token
          expect(params?.sync_token).toBe("tok2");
          return {
            success: true,
            message: null,
            data: [makeTask({ id: "p2" })],
            has_next_page: false,
          };
        },
      });
      const service = new TaskQueryService({ auth: buildAuth(), http: port, logger: createLogger() });

      // When: list all
      const tasks = await service.listTasks();

      // Then: both pages accumulated
      expect(state.calls.filter((c) => c.method === "getTasks")).toHaveLength(2);
      expect(tasks.map((t) => t.id)).toEqual(["p1", "p2"]);
    });

    test("client-side filter by date", async () => {
      // Given: three tasks with various dates
      const { port } = createStubHttp({
        async getTasks() {
          return {
            success: true,
            message: null,
            data: [
              makeTask({ id: "a", date: "2026-04-16" }),
              makeTask({ id: "b", date: "2026-04-17" }),
              makeTask({ id: "c", date: null }),
            ],
          };
        },
      });
      const service = new TaskQueryService({ auth: buildAuth(), http: port, logger: createLogger() });

      // When: list with a specific date
      const tasks = await service.listTasks({ date: "2026-04-16" });

      // Then: only the matching task is returned
      expect(tasks.map((t) => t.id)).toEqual(["a"]);
    });

    test("search filter matches by title (case insensitive)", async () => {
      // Given: tasks with different titles
      const { port } = createStubHttp({
        async getTasks() {
          return {
            success: true,
            message: null,
            data: [
              makeTask({ id: "a", title: "Write ADR" }),
              makeTask({ id: "b", title: "Review PR" }),
              makeTask({ id: "c", title: null }),
            ],
          };
        },
      });
      const service = new TaskQueryService({ auth: buildAuth(), http: port, logger: createLogger() });

      // When: search for "adr"
      const tasks = await service.searchTasks("adr");

      // Then: only the matching task
      expect(tasks.map((t) => t.id)).toEqual(["a"]);
    });

    test("deleted tasks are filtered out", async () => {
      // Given: one deleted task mixed with active ones
      const { port } = createStubHttp({
        async getTasks() {
          return {
            success: true,
            message: null,
            data: [makeTask({ id: "a" }), makeTask({ id: "b", deleted_at: "2026-04-15T10:00:00.000Z" })],
          };
        },
      });
      const service = new TaskQueryService({ auth: buildAuth(), http: port, logger: createLogger() });

      // When: listed
      const tasks = await service.listTasks();

      // Then: deleted task excluded
      expect(tasks.map((t) => t.id)).toEqual(["a"]);
    });

    test("retries on 503 and eventually succeeds", async () => {
      // Given: first call fails with 503, second succeeds
      let attempts = 0;
      const { port } = createStubHttp({
        async getTasks() {
          attempts++;
          if (attempts === 1) throw new NetworkError("down", 503);
          return { success: true, message: null, data: [makeTask({ id: "ok" })] };
        },
      });
      const service = new TaskQueryService({ auth: buildAuth(), http: port, logger: createLogger() });

      // When: list tasks
      const tasks = await service.listTasks();

      // Then: the retry policy kicked in and the call succeeded
      expect(attempts).toBe(2);
      expect(tasks.map((t) => t.id)).toEqual(["ok"]);
    });
  });

  describe("getTodayTasks", () => {
    test("filters to today's ISO date", async () => {
      // Given: tasks including one dated today
      const today = new Date().toISOString().slice(0, 10);
      const { port } = createStubHttp({
        async getTasks() {
          return {
            success: true,
            message: null,
            data: [makeTask({ id: "today", date: today }), makeTask({ id: "yesterday", date: "2020-01-01" })],
          };
        },
      });
      const service = new TaskQueryService({ auth: buildAuth(), http: port, logger: createLogger() });

      // When: getTodayTasks
      const tasks = await service.getTodayTasks();

      // Then: only today's task remains
      expect(tasks.map((t) => t.id)).toEqual(["today"]);
    });
  });

  describe("getTaskById", () => {
    test("resolves by prefix when exact match missing", async () => {
      // Given: a task with UUID starts with ab12
      const { port } = createStubHttp({
        async getTasks() {
          return {
            success: true,
            message: null,
            data: [makeTask({ id: "ab12-full-uuid" })],
          };
        },
      });
      const service = new TaskQueryService({ auth: buildAuth(), http: port, logger: createLogger() });

      // When: query by prefix
      const task = await service.getTaskById("ab12");

      // Then: the task is returned
      expect(task?.id).toBe("ab12-full-uuid");
    });

    test("returns null when no match", async () => {
      // Given: no tasks
      const { port } = createStubHttp({
        async getTasks() {
          return { success: true, message: null, data: [] };
        },
      });
      const service = new TaskQueryService({ auth: buildAuth(), http: port, logger: createLogger() });

      // When: query with nonexistent id
      const task = await service.getTaskById("missing");

      // Then: null is returned
      expect(task).toBeNull();
    });
  });

  describe("cache integration", () => {
    test("cache hit within TTL → no API call", async () => {
      const cachedTasks = [makeTask({ id: "cached-1" }), makeTask({ id: "cached-2" })];
      const { port: cache } = createStubCache({
        tasks: cachedTasks,
        meta: { syncToken: "st1", lastSyncAt: new Date().toISOString(), itemCount: 2 },
      });
      const { port: http, state: httpState } = createStubHttp();
      const service = new TaskQueryService({
        auth: buildAuth(),
        http,
        logger: createLogger(),
        cache,
        cacheTtlSeconds: 30,
      });

      const tasks = await service.listTasks();

      expect(httpState.calls.filter((c) => c.method === "getTasks")).toHaveLength(0);
      expect(tasks.map((t) => t.id)).toEqual(["cached-1", "cached-2"]);
    });

    test("cache expired → API call with syncToken", async () => {
      const oldTasks = [makeTask({ id: "old-1" })];
      const { port: cache, state: cacheState } = createStubCache({
        tasks: oldTasks,
        meta: { syncToken: "prev-token", lastSyncAt: new Date(Date.now() - 60_000).toISOString(), itemCount: 1 },
      });
      const { port: http, state: httpState } = createStubHttp({
        async getTasks(_token, _params) {
          return {
            success: true,
            message: null,
            data: [makeTask({ id: "new-2" })],
          };
        },
      });
      const service = new TaskQueryService({
        auth: buildAuth(),
        http,
        logger: createLogger(),
        cache,
        cacheTtlSeconds: 30,
      });

      const tasks = await service.listTasks();

      expect(httpState.calls.filter((c) => c.method === "getTasks")).toHaveLength(1);
      const callArgs = httpState.calls[0].args[1] as ListTasksParams;
      expect(callArgs.sync_token).toBe("prev-token");
      expect(tasks.map((t) => t.id)).toContain("old-1");
      expect(tasks.map((t) => t.id)).toContain("new-2");
      expect(cacheState.setTasksCalls).toBe(1);
    });

    test("no cache injected → full fetch (backward compat)", async () => {
      const { port: http, state: httpState } = createStubHttp({
        async getTasks() {
          return {
            success: true,
            message: null,
            data: [makeTask({ id: "full-1" })],
          };
        },
      });
      const service = new TaskQueryService({ auth: buildAuth(), http, logger: createLogger() });

      const tasks = await service.listTasks();

      expect(httpState.calls.filter((c) => c.method === "getTasks")).toHaveLength(1);
      expect(tasks.map((t) => t.id)).toEqual(["full-1"]);
    });
  });

  describe("supporting data", () => {
    test("getLabels returns port's data array", async () => {
      // Given: http returns two labels
      const { port, state } = createStubHttp({
        async getLabels() {
          return {
            success: true,
            message: null,
            data: [
              { id: "l1", name: "Work", color: null },
              { id: "l2", name: "Home", color: "#fff" },
            ],
          };
        },
      });
      const service = new TaskQueryService({ auth: buildAuth(), http: port, logger: createLogger() });

      // When: labels requested
      const labels = await service.getLabels();

      // Then: data flows through unchanged
      expect(labels).toHaveLength(2);
      expect(state.calls.some((c) => c.method === "getLabels")).toBe(true);
    });

    test("getEvents delegates date to http port", async () => {
      // Given: capture the date argument
      let receivedDate = "";
      const { port } = createStubHttp({
        async getEvents(_token, date) {
          receivedDate = date;
          return { success: true, message: null, data: [] };
        },
      });
      const service = new TaskQueryService({ auth: buildAuth(), http: port, logger: createLogger() });

      // When: getEvents called with a date
      await service.getEvents("2026-04-16");

      // Then: the adapter saw the same date
      expect(receivedDate).toBe("2026-04-16");
    });
  });
});
