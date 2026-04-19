import { describe, expect, test } from "bun:test";
import { ApiSchemaError, NetworkError } from "@core/errors/index.ts";
import type { AkiflowHttpPort } from "@core/ports/akiflow-http-port.ts";
import type { CacheMeta, CachePort, PendingEntry } from "@core/ports/cache-port.ts";
import type { LoggerPort } from "@core/ports/logger-port.ts";
import type { StoragePort } from "@core/ports/storage-port.ts";
import { AuthService } from "@core/services/auth-service.ts";
import { TaskCommandService } from "@core/services/task-command-service.ts";
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
} from "@core/types.ts";

function createLogger(): LoggerPort {
  return {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function makeCredentials(): Credentials {
  return {
    accessToken: "access_xyz",
    refreshToken: "refresh_xyz",
    clientId: "client-1",
    expiresAt: Date.now() + 60 * 60 * 1000,
    savedAt: new Date().toISOString(),
    source: "manual",
  };
}

function createStorage(initial: Credentials | null): StoragePort {
  let current = initial;
  return {
    async saveCredentials(c) {
      current = c;
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
      access_token: "r",
      refresh_token: "r",
    }),
    logger: createLogger(),
  });
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "echo",
    title: "echo",
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

interface PatchCall {
  token: string;
  tasks: Array<CreateTaskPayload | UpdateTaskPayload>;
}

function createHttp(handler?: (call: PatchCall) => Promise<ApiResponse<Task[]>>): {
  port: AkiflowHttpPort;
  calls: PatchCall[];
} {
  const calls: PatchCall[] = [];
  const port: AkiflowHttpPort = {
    async getTasks() {
      return { success: true, message: null, data: [] as Task[] };
    },
    async patchTasks(token, tasks) {
      const call = { token, tasks };
      calls.push(call);
      if (handler) return handler(call);
      return {
        success: true,
        message: null,
        data: tasks.map((t) => makeTask({ id: t.id })),
      };
    },
    async getLabels() {
      return { success: true, message: null, data: [] as Label[] };
    },
    async getTags() {
      return { success: true, message: null, data: [] as Tag[] };
    },
    async getCalendars() {
      return { success: true, message: null, data: [] as Calendar[] };
    },
    async getEvents() {
      return { success: true, message: null, data: [] as CalendarEvent[] };
    },
    async getTimeSlots() {
      return { success: true, message: null, data: [] as TimeSlot[] };
    },
  };
  return { port, calls };
}

describe("TaskCommandService", () => {
  describe("createTask", () => {
    test("generates UUID and sends PATCH array body", async () => {
      // Given: a capturing http port
      const { port, calls } = createHttp();
      const service = new TaskCommandService({ auth: buildAuth(), http: port, logger: createLogger() });

      // When: createTask is called
      await service.createTask({ title: "hello world", date: "2026-04-16" });

      // Then: body is an array of one task with a UUID-shaped id
      expect(calls).toHaveLength(1);
      expect(Array.isArray(calls[0].tasks)).toBe(true);
      expect(calls[0].tasks).toHaveLength(1);
      const first = calls[0].tasks[0] as CreateTaskPayload;
      expect(first.title).toBe("hello world");
      expect(first.date).toBe("2026-04-16");
      expect(first.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(typeof first.global_created_at).toBe("string");
      expect(typeof first.global_updated_at).toBe("string");
    });

    test("retries on 5xx then succeeds", async () => {
      // Given: first call throws 503, second succeeds
      let attempts = 0;
      const { port } = createHttp(async ({ tasks }) => {
        attempts++;
        if (attempts === 1) throw new NetworkError("down", 503);
        return { success: true, message: null, data: tasks.map((t) => makeTask({ id: t.id })) };
      });
      const service = new TaskCommandService({ auth: buildAuth(), http: port, logger: createLogger() });

      // When: createTask
      const task = await service.createTask({ title: "retry me" });

      // Then: succeeded after a retry
      expect(attempts).toBe(2);
      expect(task.id).toMatch(/^[0-9a-f-]{36}$/i);
    });

    test("empty response data → ApiSchemaError", async () => {
      // Given: server returns empty data array
      const { port } = createHttp(async () => ({ success: true, message: null, data: [] }));
      const service = new TaskCommandService({ auth: buildAuth(), http: port, logger: createLogger() });

      // When/Then: rejects with ApiSchemaError
      await expect(service.createTask({ title: "x" })).rejects.toBeInstanceOf(ApiSchemaError);
    });
  });

  describe("updateTask", () => {
    test("sends id and updated fields only", async () => {
      // Given: a port that echoes patch data
      const { port, calls } = createHttp();
      const service = new TaskCommandService({ auth: buildAuth(), http: port, logger: createLogger() });

      // When: update title only
      await service.updateTask("id-1", { title: "new title" });

      // Then: payload contains id + title + global_updated_at
      const payload = calls[0].tasks[0] as UpdateTaskPayload;
      expect(payload.id).toBe("id-1");
      expect(payload.title).toBe("new title");
      expect(payload).not.toHaveProperty("date");
      expect(typeof payload.global_updated_at).toBe("string");
    });
  });

  describe("completeTask", () => {
    test("sets done=true and status=1", async () => {
      // Given: a capturing port
      const { port, calls } = createHttp();
      const service = new TaskCommandService({ auth: buildAuth(), http: port, logger: createLogger() });

      // When: completeTask
      await service.completeTask("id-1");

      // Then: payload has done=true and status=1
      const payload = calls[0].tasks[0] as UpdateTaskPayload;
      expect(payload.done).toBe(true);
      expect(payload.status).toBe(1);
      expect(payload.id).toBe("id-1");
    });
  });

  describe("scheduleTask / unscheduleTask", () => {
    test("scheduleTask with time sets date + datetime", async () => {
      // Given: a capturing port
      const { port, calls } = createHttp();
      const service = new TaskCommandService({ auth: buildAuth(), http: port, logger: createLogger() });

      // When: scheduleTask with date + time
      await service.scheduleTask("id-1", "2026-04-16", "10:30");

      // Then: payload includes both
      const payload = calls[0].tasks[0] as UpdateTaskPayload;
      expect(payload.date).toBe("2026-04-16");
      expect(payload.datetime).toBe("2026-04-16T10:30:00");
    });

    test("scheduleTask without time sets date and null datetime", async () => {
      // Given: a capturing port
      const { port, calls } = createHttp();
      const service = new TaskCommandService({ auth: buildAuth(), http: port, logger: createLogger() });

      // When: scheduleTask with only date
      await service.scheduleTask("id-1", "2026-04-16");

      // Then: datetime is null
      const payload = calls[0].tasks[0] as UpdateTaskPayload;
      expect(payload.date).toBe("2026-04-16");
      expect(payload.datetime).toBeNull();
    });

    test("unscheduleTask clears date and datetime", async () => {
      // Given: a capturing port
      const { port, calls } = createHttp();
      const service = new TaskCommandService({ auth: buildAuth(), http: port, logger: createLogger() });

      // When: unscheduleTask
      await service.unscheduleTask("id-1");

      // Then: both cleared to null
      const payload = calls[0].tasks[0] as UpdateTaskPayload;
      expect(payload.date).toBeNull();
      expect(payload.datetime).toBeNull();
    });
  });

  describe("deleteTask", () => {
    test("sets deleted_at to an ISO timestamp", async () => {
      // Given: a capturing port
      const { port, calls } = createHttp();
      const service = new TaskCommandService({ auth: buildAuth(), http: port, logger: createLogger() });

      // When: deleteTask
      await service.deleteTask("id-1");

      // Then: deleted_at is a string timestamp
      const payload = calls[0].tasks[0] as UpdateTaskPayload;
      expect(payload.id).toBe("id-1");
      expect(typeof payload.deleted_at).toBe("string");
      expect(payload.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // -------------------------------------------------------------------------
  // Cache integration — write methods must merge the server response into
  // the read cache so subsequent TaskQueryService.listTasks sees the write
  // immediately (read-your-writes consistency within the same process).
  // -------------------------------------------------------------------------

  describe("cache integration (read-your-writes)", () => {
    interface CacheStub extends CachePort {
      upsertCalls: Task[];
    }

    function createCacheStub(overrides: Partial<Pick<CachePort, "upsertTask">> = {}): CacheStub {
      const upsertCalls: Task[] = [];
      const stub: CacheStub = {
        upsertCalls,
        async upsertTask(task) {
          upsertCalls.push(task);
          if (overrides.upsertTask) await overrides.upsertTask(task);
        },
        async getTasks() {
          return [];
        },
        async setTasks() {},
        async removeTask() {},
        async getMeta(): Promise<CacheMeta | null> {
          return null;
        },
        async setMeta() {},
        async saveShortIdMap() {},
        async resolveShortId() {
          return null;
        },
        async enqueuePending() {},
        async getPending(): Promise<PendingEntry[]> {
          return [];
        },
        async removePending() {},
        async clearAll() {},
        getCacheDir() {
          return "/tmp/test-cache";
        },
      };
      return stub;
    }

    test("createTask upserts the returned task into the cache", async () => {
      // Given: http echoes the payload back as the created task
      const { port } = createHttp(async ({ tasks }) => ({
        success: true,
        message: null,
        data: tasks.map((t) => makeTask({ id: t.id, title: (t as CreateTaskPayload).title })),
      }));
      const cache = createCacheStub();
      const service = new TaskCommandService({
        auth: buildAuth(),
        http: port,
        logger: createLogger(),
        cache,
      });

      // When: createTask succeeds
      const task = await service.createTask({ title: "write-through" });

      // Then: cache.upsertTask was called exactly once with the server-returned task
      expect(cache.upsertCalls).toHaveLength(1);
      expect(cache.upsertCalls[0]).toBe(task);
      expect(cache.upsertCalls[0].title).toBe("write-through");
    });

    test("updateTask, completeTask, scheduleTask, unscheduleTask, deleteTask all upsert", async () => {
      // Given: a shared cache stub across successive writes
      const { port } = createHttp();
      const cache = createCacheStub();
      const service = new TaskCommandService({
        auth: buildAuth(),
        http: port,
        logger: createLogger(),
        cache,
      });

      // When: one of each write method is invoked
      await service.updateTask("id-u", { title: "renamed" });
      await service.completeTask("id-c");
      await service.scheduleTask("id-s", "2026-04-20", "09:00");
      await service.unscheduleTask("id-us");
      await service.deleteTask("id-d");

      // Then: cache.upsertTask fired once per write, in order, with matching ids
      expect(cache.upsertCalls.map((t) => t.id)).toEqual(["id-u", "id-c", "id-s", "id-us", "id-d"]);
    });

    test("cache is optional — service works without a cache port (undefined)", async () => {
      // Given: no cache injected (production behavior for callers that opt out)
      const { port } = createHttp();
      const service = new TaskCommandService({
        auth: buildAuth(),
        http: port,
        logger: createLogger(),
      });

      // When / Then: write completes without throwing
      const task = await service.createTask({ title: "no-cache" });
      expect(task.id).toMatch(/^[0-9a-f-]{36}$/i);
    });

    test("cache.upsertTask throwing does not fail the write (logged then swallowed)", async () => {
      // Given: cache that fails on upsert
      const { port } = createHttp();
      const cache = createCacheStub({
        upsertTask: async () => {
          throw new Error("disk full");
        },
      });
      const service = new TaskCommandService({
        auth: buildAuth(),
        http: port,
        logger: createLogger(),
        cache,
      });

      // When: createTask — should not propagate the cache error
      const task = await service.createTask({ title: "cache-ignored" });

      // Then: server task still returned, and we still attempted the upsert
      expect(task.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(cache.upsertCalls).toHaveLength(1); // our stub records before the override throws
    });

    test("ApiSchemaError (empty response) short-circuits before touching cache", async () => {
      // Given: empty server response
      const { port } = createHttp(async () => ({ success: true, message: null, data: [] }));
      const cache = createCacheStub();
      const service = new TaskCommandService({
        auth: buildAuth(),
        http: port,
        logger: createLogger(),
        cache,
      });

      // When / Then: ApiSchemaError and cache was NOT touched
      await expect(service.createTask({ title: "x" })).rejects.toBeInstanceOf(ApiSchemaError);
      expect(cache.upsertCalls).toHaveLength(0);
    });
  });
});
