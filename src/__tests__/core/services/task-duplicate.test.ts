import { describe, expect, test } from "bun:test";
import { NotFoundError, ValidationError } from "@core/errors/index.ts";
import type { CreateTaskInput } from "@core/services/task-command-service.ts";
import { type DuplicateTaskDeps, duplicateTask } from "@core/services/task-duplicate.ts";
import type { Task } from "@core/types.ts";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "src-1",
    title: "source task",
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

interface FakeDeps {
  deps: DuplicateTaskDeps;
  createCalls: CreateTaskInput[];
}

function createFakeDeps(source: Task | null, created: Task): FakeDeps {
  const createCalls: CreateTaskInput[] = [];
  const deps: DuplicateTaskDeps = {
    async getTaskById() {
      return source;
    },
    async createTask(input) {
      createCalls.push(input);
      return created;
    },
  };
  return { deps, createCalls };
}

describe("duplicateTask", () => {
  test("copies all copyable fields into a new CreateTaskInput", async () => {
    // Given: a source task with title/date/datetime/duration/listId all set
    const source = makeTask({
      id: "src-1",
      title: "Source title",
      date: "2026-04-16",
      datetime: "2026-04-16T10:00:00",
      duration: 1_800_000,
      listId: "proj-1",
    });
    const created = makeTask({ id: "new-1", title: "Source title" });
    const { deps, createCalls } = createFakeDeps(source, created);

    // When: duplicateTask is called with the source id
    const result = await duplicateTask(deps, "src-1");

    // Then: createTask receives a CreateTaskInput with the copied fields
    expect(createCalls).toEqual([
      {
        title: "Source title",
        date: "2026-04-16",
        datetime: "2026-04-16T10:00:00",
        duration: 1_800_000,
        projectId: "proj-1",
      },
    ]);
    expect(result).toBe(created);
  });

  test("omits fields that are null on the source instead of passing null", async () => {
    // Given: a source task with no date/datetime/duration/listId
    const source = makeTask({
      id: "src-2",
      title: "No date",
      date: null,
      datetime: null,
      duration: null,
      listId: null,
    });
    const created = makeTask({ id: "new-2", title: "No date" });
    const { deps, createCalls } = createFakeDeps(source, created);

    // When: duplicateTask is called
    await duplicateTask(deps, "src-2");

    // Then: only title is present — no null-valued keys leak into CreateTaskInput
    expect(createCalls).toEqual([{ title: "No date" }]);
    expect(createCalls[0]).not.toHaveProperty("date");
    expect(createCalls[0]).not.toHaveProperty("datetime");
    expect(createCalls[0]).not.toHaveProperty("duration");
    expect(createCalls[0]).not.toHaveProperty("projectId");
  });

  test("source not found → rejects with NotFoundError, createTask never called", async () => {
    // Given: getTaskById resolves to null
    const createCalls: CreateTaskInput[] = [];
    const deps: DuplicateTaskDeps = {
      async getTaskById() {
        return null;
      },
      async createTask(input) {
        createCalls.push(input);
        return makeTask();
      },
    };

    // When/Then: rejects with NotFoundError and createTask is never invoked
    await expect(duplicateTask(deps, "missing-id")).rejects.toBeInstanceOf(NotFoundError);
    expect(createCalls).toHaveLength(0);
  });

  test("source found but title is null → rejects with ValidationError, createTask never called", async () => {
    // Given: source task exists but has no title
    const source = makeTask({ id: "src-3", title: null });
    const createCalls: CreateTaskInput[] = [];
    const deps: DuplicateTaskDeps = {
      async getTaskById() {
        return source;
      },
      async createTask(input) {
        createCalls.push(input);
        return makeTask();
      },
    };

    // When/Then: rejects with ValidationError and createTask is never invoked
    await expect(duplicateTask(deps, "src-3")).rejects.toBeInstanceOf(ValidationError);
    expect(createCalls).toHaveLength(0);
  });

  test("new task input does not include an id field", async () => {
    // Given: a valid source task
    const source = makeTask({ id: "src-4", title: "Has no id copy" });
    const created = makeTask({ id: "new-4" });
    const { deps, createCalls } = createFakeDeps(source, created);

    // When: duplicateTask is called
    await duplicateTask(deps, "src-4");

    // Then: the CreateTaskInput passed to createTask has no id — a new identity
    // is assigned downstream by createTask itself, not invented here.
    expect(createCalls[0]).not.toHaveProperty("id");
  });
});
