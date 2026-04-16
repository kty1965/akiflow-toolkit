// ---------------------------------------------------------------------------
// af do — mark one or more tasks complete (ADR-0010 command side)
// Accepts short IDs (1, 2, 3) from `af ls`, UUIDs, or 6+ char UUID prefixes.
// ---------------------------------------------------------------------------

import { defineCommand } from "citty";
import { NotFoundError } from "../../core/errors/index.ts";
import type { CachePort } from "../../core/ports/cache-port.ts";
import type { LoggerPort } from "../../core/ports/logger-port.ts";
import type { Task } from "../../core/types.ts";
import { resolveTaskId } from "../../core/utils/resolve-task-id.ts";
import { handleCliError } from "../app.ts";

export interface TaskCompleteApi {
  completeTask(id: string): Promise<Task>;
}

export type TaskCache = Pick<CachePort, "getTasks" | "resolveShortId">;

export interface DoCommandComponents {
  taskCommand: TaskCompleteApi;
  cache: TaskCache;
  logger: LoggerPort;
}

export interface CliWriter {
  write(chunk: string): boolean;
}

export interface DoCommandOptions {
  stdout?: CliWriter;
}

export function createDoCommand(components: DoCommandComponents, options: DoCommandOptions = {}) {
  const stdout = options.stdout ?? process.stdout;

  return defineCommand({
    meta: { name: "do", description: "Mark tasks complete (by short ID or UUID)" },
    args: {
      ids: { type: "positional", description: "Task IDs (short IDs, UUIDs, or 6+ char prefixes)", required: true },
    },
    async run({ args, rawArgs }) {
      try {
        const rawIds = collectIds(args.ids, rawArgs);
        if (rawIds.length === 0) {
          throw new NotFoundError("at least one task id is required");
        }
        const resolved = await resolveInputs(rawIds, components.cache);
        const completed: string[] = [];
        for (const id of resolved) {
          const task = await components.taskCommand.completeTask(id);
          completed.push(task.id);
        }
        stdout.write(`Completed ${completed.length} task${completed.length === 1 ? "" : "s"}\n`);
      } catch (err) {
        handleCliError(err, components.logger);
      }
    },
  });
}

function collectIds(positional: unknown, rawArgs: readonly string[]): string[] {
  const ids: string[] = [];
  if (Array.isArray(positional)) {
    for (const v of positional) if (typeof v === "string" && v.length > 0) ids.push(v);
  } else if (typeof positional === "string" && positional.length > 0) {
    ids.push(positional);
  }
  for (const arg of rawArgs) {
    if (arg.startsWith("-")) continue;
    if (!ids.includes(arg)) ids.push(arg);
  }
  return ids;
}

export async function resolveInputs(inputs: string[], cache: TaskCache): Promise<string[]> {
  const tasks = await cache.getTasks();
  const shortIdMap = await loadShortIdMap(inputs, cache);
  const resolved: string[] = [];
  for (const raw of inputs) {
    const id = resolveTaskId(raw, tasks, shortIdMap);
    if (!id) {
      throw new NotFoundError(`task not found for id: '${raw}'`);
    }
    resolved.push(id);
  }
  return resolved;
}

async function loadShortIdMap(inputs: string[], cache: TaskCache): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const input of inputs) {
    if (/^\d+$/.test(input)) {
      const full = await cache.resolveShortId(input);
      if (full) map[input] = full;
    }
  }
  return map;
}
