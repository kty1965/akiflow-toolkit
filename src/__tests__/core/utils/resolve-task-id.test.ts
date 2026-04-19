import { describe, expect, test } from "bun:test";
import type { Task } from "@core/types.ts";
import { resolveTaskId } from "@core/utils/resolve-task-id.ts";

function task(id: string): Task {
  return {
    id,
    title: null,
    date: null,
    datetime: null,
    duration: null,
    done: false,
    listId: null,
    status: 0,
    recurrence: null,
    deleted_at: null,
    global_created_at: "",
    global_updated_at: "",
    description: null,
    priority: null,
    tags: [],
    labels: [],
    shared: false,
    source: null,
    parent_id: null,
    position: null,
  };
}

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";
const UUID_C = "12abcdef-0000-0000-0000-000000000000";
const UUID_D = "12abcd99-ffff-ffff-ffff-ffffffffffff";

describe("resolveTaskId", () => {
  test("short numeric ID hits the short ID map", () => {
    // Given: short ID map with '1' → UUID_A
    const tasks = [task(UUID_A)];
    const map = { "1": UUID_A };

    // When: resolving "1"
    const resolved = resolveTaskId("1", tasks, map);

    // Then: returns UUID_A
    expect(resolved).toBe(UUID_A);
  });

  test("short numeric ID miss returns null", () => {
    // Given: short map has only '1'
    const tasks = [task(UUID_A)];
    const map = { "1": UUID_A };

    // When: resolving unknown short ID "99"
    const resolved = resolveTaskId("99", tasks, map);

    // Then: null
    expect(resolved).toBeNull();
  });

  test("exact UUID match is returned as-is", () => {
    // Given: tasks contain UUID_B
    const tasks = [task(UUID_A), task(UUID_B)];

    // When: resolving UUID_B
    const resolved = resolveTaskId(UUID_B, tasks, {});

    // Then: returns UUID_B
    expect(resolved).toBe(UUID_B);
  });

  test("UUID prefix with unique match resolves", () => {
    // Given: two tasks with clearly distinct prefixes
    const tasks = [task(UUID_A), task(UUID_B)];

    // When: resolving an unambiguous 8-char prefix
    const resolved = resolveTaskId("11111111", tasks, {});

    // Then: returns UUID_A
    expect(resolved).toBe(UUID_A);
  });

  test("UUID prefix with ambiguous match returns null", () => {
    // Given: two UUIDs that share a 6-char prefix
    const tasks = [task(UUID_C), task(UUID_D)];

    // When: resolving the shared prefix
    const resolved = resolveTaskId("12abcd", tasks, {});

    // Then: null (ambiguous)
    expect(resolved).toBeNull();
  });

  test("prefix shorter than 6 characters is not attempted", () => {
    // Given: a task whose UUID starts with "abc"
    const tasks = [task("abcdef12-aaaa-aaaa-aaaa-aaaaaaaaaaaa")];

    // When: resolving a 3-char prefix
    const resolved = resolveTaskId("abc", tasks, {});

    // Then: null (prefix too short)
    expect(resolved).toBeNull();
  });

  test("unknown input returns null", () => {
    // Given: populated tasks + empty short map
    const tasks = [task(UUID_A)];

    // When: resolving a non-matching string
    const resolved = resolveTaskId("not-a-match", tasks, {});

    // Then: null
    expect(resolved).toBeNull();
  });

  test("numeric input without short map entry falls through to UUID prefix match", () => {
    // Given: tasks contain a UUID starting with "12345678"; short map empty
    const uuid = "12345678-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const tasks = [task(uuid)];

    // When: resolving "12345678" (numeric — short map misses, UUID prefix matches)
    const resolved = resolveTaskId("12345678", tasks, {});

    // Then: resolves via UUID prefix branch
    expect(resolved).toBe(uuid);
  });
});
