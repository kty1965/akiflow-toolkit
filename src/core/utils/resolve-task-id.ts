import type { Task } from "../types.ts";

export function resolveTaskId(input: string, tasks: Task[], shortIdMap: Record<string, string>): string | null {
  if (/^\d+$/.test(input) && shortIdMap[input]) {
    return shortIdMap[input];
  }

  if (tasks.some((t) => t.id === input)) {
    return input;
  }

  if (input.length >= 6) {
    const matches = tasks.filter((t) => typeof t.id === "string" && t.id.startsWith(input));
    if (matches.length === 1) {
      return matches[0].id;
    }
  }

  return null;
}
