import { describe, expect, test } from "bun:test";
import type { CreateTaskPayload, Credentials, Task, TaskQueryOptions, TaskStatus } from "@core/types.ts";

describe("core/types", () => {
  describe("CreateTaskPayload", () => {
    test("requires id field for client-side UUID (H1 resolution)", () => {
      // Given: a valid CreateTaskPayload
      const payload: CreateTaskPayload = {
        id: crypto.randomUUID(),
        title: "Test task",
        global_created_at: new Date().toISOString(),
        global_updated_at: new Date().toISOString(),
      };

      // When: we access the id field
      // Then: it exists and is a string
      expect(payload.id).toBeDefined();
      expect(typeof payload.id).toBe("string");
      expect(payload.id.length).toBeGreaterThan(0);
    });

    test("accepts optional fields", () => {
      // Given: a CreateTaskPayload with all optional fields
      const payload: CreateTaskPayload = {
        id: crypto.randomUUID(),
        title: "Full payload",
        date: "2026-04-16",
        datetime: "2026-04-16T10:00:00+09:00",
        duration: 3600000,
        listId: "label-123",
        global_created_at: new Date().toISOString(),
        global_updated_at: new Date().toISOString(),
      };

      // Then: all fields are set
      expect(payload.date).toBe("2026-04-16");
      expect(payload.duration).toBe(3600000);
      expect(payload.listId).toBe("label-123");
    });
  });

  describe("TaskStatus", () => {
    test("valid values are 0, 1, 2, or null", () => {
      // Given: all valid TaskStatus values
      const statuses: TaskStatus[] = [0, 1, 2, null];

      // Then: each is a valid TaskStatus
      for (const s of statuses) {
        expect(s === 0 || s === 1 || s === 2 || s === null).toBe(true);
      }
    });
  });

  describe("Credentials", () => {
    test("requires all mandatory fields", () => {
      // Given: a valid Credentials object
      const creds: Credentials = {
        accessToken: "access-abc",
        refreshToken: "refresh-xyz",
        clientId: "client-123",
        expiresAt: Date.now() + 3600_000,
        savedAt: new Date().toISOString(),
        source: "indexeddb",
      };

      // Then: all required fields are present and typed correctly
      expect(typeof creds.accessToken).toBe("string");
      expect(typeof creds.refreshToken).toBe("string");
      expect(typeof creds.clientId).toBe("string");
      expect(typeof creds.expiresAt).toBe("number");
      expect(typeof creds.savedAt).toBe("string");
      expect(["indexeddb", "cookie", "cdp", "manual"]).toContain(creds.source);
    });

    test("source field accepts all valid values", () => {
      // Given: all valid source values
      const sources: Credentials["source"][] = ["indexeddb", "cookie", "cdp", "manual"];

      // Then: each is valid
      for (const source of sources) {
        expect(["indexeddb", "cookie", "cdp", "manual"]).toContain(source);
      }
    });
  });

  describe("Task", () => {
    test("can construct a full Task object", () => {
      // Given: a complete Task
      const task: Task = {
        id: crypto.randomUUID(),
        title: "Sample task",
        date: "2026-04-16",
        datetime: "2026-04-16T09:00:00Z",
        duration: 1800000,
        done: false,
        listId: null,
        status: 0,
        recurrence: null,
        deleted_at: null,
        global_created_at: new Date().toISOString(),
        global_updated_at: new Date().toISOString(),
        description: null,
        priority: null,
        tags: [],
        labels: [],
        shared: false,
        source: null,
        parent_id: null,
        position: null,
      };

      // Then: required fields are present
      expect(task.id).toBeDefined();
      expect(task.done).toBe(false);
      expect(task.status).toBe(0);
    });
  });

  describe("TaskQueryOptions", () => {
    test("all fields are optional", () => {
      // Given: an empty TaskQueryOptions
      const opts: TaskQueryOptions = {};

      // Then: it's a valid object
      expect(opts).toBeDefined();
    });

    test("filter accepts valid values", () => {
      // Given: valid filter values
      const filters: NonNullable<TaskQueryOptions["filter"]>[] = ["today", "inbox", "done", "all"];

      // Then: each is valid
      for (const f of filters) {
        const opts: TaskQueryOptions = { filter: f };
        expect(opts.filter).toBe(f);
      }
    });
  });
});
