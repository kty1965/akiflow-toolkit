import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyncCache } from "@adapters/fs/sync-cache.ts";
import type { CacheMeta, PendingEntry } from "@core/ports/cache-port.ts";
import type { Task } from "@core/types.ts";

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    id: overrides.id,
    title: overrides.title ?? "Sample task",
    date: null,
    datetime: null,
    duration: null,
    done: false,
    listId: null,
    status: 0,
    recurrence: null,
    deleted_at: null,
    global_created_at: "2026-04-15T00:00:00.000Z",
    global_updated_at: "2026-04-15T00:00:00.000Z",
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

describe("SyncCache", () => {
  let tempDir: string;
  let cache: SyncCache;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "akiflow-cache-test-"));
    cache = new SyncCache(tempDir, 30);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("getCacheDir / getTtlSeconds", () => {
    test("exposes configured values", () => {
      // Given: a SyncCache constructed with tempDir and ttl 30
      // Then: accessors return those values
      expect(cache.getCacheDir()).toBe(tempDir);
      expect(cache.getTtlSeconds()).toBe(30);
    });
  });

  describe("tasks roundtrip", () => {
    test("setTasks then getTasks returns the same set", async () => {
      // Given: two tasks
      const tasks = [
        makeTask({ id: "11111111-1111-1111-1111-111111111111", title: "Alpha" }),
        makeTask({ id: "22222222-2222-2222-2222-222222222222", title: "Beta" }),
      ];

      // When: we persist and read back
      await cache.setTasks(tasks);
      const loaded = await cache.getTasks();

      // Then: loaded set equals the original (order-agnostic)
      expect(loaded).toHaveLength(2);
      const byId = Object.fromEntries(loaded.map((t) => [t.id, t.title]));
      expect(byId["11111111-1111-1111-1111-111111111111"]).toBe("Alpha");
      expect(byId["22222222-2222-2222-2222-222222222222"]).toBe("Beta");
    });

    test("getTasks on fresh cache returns empty array", async () => {
      // Given: no writes yet
      // When: reading tasks
      const loaded = await cache.getTasks();

      // Then: empty array (no error)
      expect(loaded).toEqual([]);
    });
  });

  describe("upsertTask", () => {
    test("adds a new task when id is absent", async () => {
      // Given: empty cache
      const task = makeTask({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", title: "new" });

      // When: upsert
      await cache.upsertTask(task);

      // Then: task appears
      const loaded = await cache.getTasks();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.title).toBe("new");
    });

    test("updates an existing task by id", async () => {
      // Given: a task already stored
      const id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
      await cache.setTasks([makeTask({ id, title: "old" })]);

      // When: upsert with new title
      await cache.upsertTask(makeTask({ id, title: "new" }));

      // Then: single task with updated title
      const loaded = await cache.getTasks();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.title).toBe("new");
    });
  });

  describe("removeTask", () => {
    test("removes an existing task", async () => {
      // Given: two tasks
      const a = "cccccccc-cccc-cccc-cccc-cccccccccccc";
      const b = "dddddddd-dddd-dddd-dddd-dddddddddddd";
      await cache.setTasks([makeTask({ id: a }), makeTask({ id: b })]);

      // When: remove one
      await cache.removeTask(a);

      // Then: only the other remains
      const loaded = await cache.getTasks();
      expect(loaded.map((t) => t.id)).toEqual([b]);
    });

    test("is a noop when id is missing", async () => {
      // Given: empty cache
      // When: remove a non-existent id
      await cache.removeTask("missing");

      // Then: no throw, still empty
      const loaded = await cache.getTasks();
      expect(loaded).toEqual([]);
    });
  });

  describe("meta", () => {
    test("setMeta then getMeta returns the same meta", async () => {
      // Given: a meta record
      const meta: CacheMeta = {
        syncToken: "token-xyz",
        lastSyncAt: "2026-04-15T12:00:00.000Z",
        itemCount: 42,
      };

      // When: persist and reload
      await cache.setMeta(meta);
      const loaded = await cache.getMeta();

      // Then: matches exactly
      expect(loaded).toEqual(meta);
    });

    test("getMeta on fresh cache returns null", async () => {
      // Given: no meta saved
      // Then: null
      expect(await cache.getMeta()).toBeNull();
    });
  });

  describe("short ID map", () => {
    test("saveShortIdMap then resolveShortId returns the uuid", async () => {
      // Given: a short→uuid map
      const map = {
        "1": "11111111-1111-1111-1111-111111111111",
        "2": "22222222-2222-2222-2222-222222222222",
      };

      // When: save then resolve
      await cache.saveShortIdMap(map);

      // Then: resolves known ids and returns null for unknown
      expect(await cache.resolveShortId("1")).toBe("11111111-1111-1111-1111-111111111111");
      expect(await cache.resolveShortId("99")).toBeNull();
    });

    test("resolveShortId returns null when map file absent", async () => {
      // Given: no saved map
      // Then: resolve returns null without throwing
      expect(await cache.resolveShortId("1")).toBeNull();
    });
  });

  describe("pending queue", () => {
    test("enqueue / get / remove cycle", async () => {
      // Given: two pending entries
      const e1: PendingEntry = {
        kind: "create",
        taskId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        payload: { title: "Alpha" },
        enqueuedAt: "2026-04-15T12:00:00.000Z",
        attempts: 0,
      };
      const e2: PendingEntry = {
        kind: "update",
        taskId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        payload: { title: "Beta" },
        enqueuedAt: "2026-04-15T12:00:01.000Z",
        attempts: 1,
      };

      // When: enqueue both, read, then remove one
      await cache.enqueuePending(e1);
      await cache.enqueuePending(e2);
      const all = await cache.getPending();
      await cache.removePending(e1.taskId);
      const after = await cache.getPending();

      // Then: both present initially, only e2 remains after remove
      expect(all).toHaveLength(2);
      expect(all[0]?.taskId).toBe(e1.taskId);
      expect(all[1]?.taskId).toBe(e2.taskId);
      expect(after).toHaveLength(1);
      expect(after[0]?.taskId).toBe(e2.taskId);
    });

    test("getPending on fresh cache returns empty array", async () => {
      // Given: no pending writes
      // Then: empty array, no throw
      expect(await cache.getPending()).toEqual([]);
    });

    test("malformed JSONL lines are skipped gracefully", async () => {
      // Given: a pending file with one valid + one garbage line
      const pendingDir = join(tempDir, "pending");
      const pendingFile = join(pendingDir, "tasks-pending.jsonl");
      await mkdir(pendingDir, { recursive: true, mode: 0o700 });
      const valid: PendingEntry = {
        kind: "delete",
        taskId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        payload: null,
        enqueuedAt: "2026-04-15T12:00:00.000Z",
        attempts: 0,
      };
      await appendFile(pendingFile, `${JSON.stringify(valid)}\n{not-json}\n`);

      // When: reading pending
      const entries = await cache.getPending();

      // Then: only the valid line is returned
      expect(entries).toHaveLength(1);
      expect(entries[0]?.taskId).toBe(valid.taskId);
    });

    test("removePending is a noop when taskId is absent", async () => {
      // Given: one pending entry
      const e: PendingEntry = {
        kind: "create",
        taskId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        payload: {},
        enqueuedAt: "2026-04-15T12:00:00.000Z",
        attempts: 0,
      };
      await cache.enqueuePending(e);

      // When: remove an unrelated id
      await cache.removePending("unrelated");

      // Then: entry still there
      const remaining = await cache.getPending();
      expect(remaining).toHaveLength(1);
    });
  });

  describe("clearAll", () => {
    test("removes the cache directory entirely", async () => {
      // Given: writes that create files and a pending subdir
      await cache.setTasks([makeTask({ id: "ffffffff-ffff-ffff-ffff-ffffffffffff" })]);
      await cache.enqueuePending({
        kind: "create",
        taskId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
        payload: {},
        enqueuedAt: "2026-04-15T12:00:00.000Z",
        attempts: 0,
      });

      // When: clearAll
      await cache.clearAll();

      // Then: directory is gone
      let missing = false;
      try {
        await stat(tempDir);
      } catch (err: unknown) {
        if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
          missing = true;
        }
      }
      expect(missing).toBe(true);
    });

    test("clearAll on non-existent directory is a noop", async () => {
      // Given: cleared once
      await cache.clearAll();

      // When: clearAll again
      // Then: no throw
      await expect(cache.clearAll()).resolves.toBeUndefined();
    });
  });

  describe("atomic write", () => {
    test("tasks.json is produced (no .tmp residue) after setTasks", async () => {
      // Given/When: a set
      await cache.setTasks([makeTask({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" })]);

      // Then: final file exists and no .tmp sibling
      const final = await readFile(join(tempDir, "tasks.json"), "utf-8");
      expect(final).toContain("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
      let tmpPresent = true;
      try {
        await stat(join(tempDir, "tasks.json.tmp"));
      } catch {
        tmpPresent = false;
      }
      expect(tmpPresent).toBe(false);
    });
  });
});
