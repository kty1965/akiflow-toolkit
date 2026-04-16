// ---------------------------------------------------------------------------
// af ls — list tasks with filters (ADR-0010 query side, ADR-0013 cache)
// Output: text → stdout (short IDs saved to cache); JSON → stdout if --json
// ---------------------------------------------------------------------------

import { defineCommand } from "citty";
import type { CachePort } from "../../core/ports/cache-port.ts";
import type { LoggerPort } from "../../core/ports/logger-port.ts";
import type { Task, TaskQueryOptions } from "../../core/types.ts";
import { handleCliError } from "../app.ts";

export interface TaskQueryApi {
  listTasks(options?: TaskQueryOptions): Promise<Task[]>;
  searchTasks(query: string): Promise<Task[]>;
}

export type ShortIdCache = Pick<CachePort, "saveShortIdMap">;

export interface LsCommandComponents {
  taskQuery: TaskQueryApi;
  cache: ShortIdCache;
  logger: LoggerPort;
}

export interface CliWriter {
  write(chunk: string): boolean;
}

export interface LsCommandOptions {
  stdout?: CliWriter;
  now?: () => Date;
}

export function createLsCommand(components: LsCommandComponents, options: LsCommandOptions = {}) {
  const stdout = options.stdout ?? process.stdout;
  const now = options.now ?? (() => new Date());

  return defineCommand({
    meta: { name: "ls", description: "List tasks" },
    args: {
      inbox: { type: "boolean", description: "Only inbox (unscheduled) tasks", default: false },
      done: { type: "boolean", description: "Only completed tasks", default: false },
      all: { type: "boolean", description: "All tasks (no date filter)", default: false },
      today: { type: "boolean", description: "Tasks scheduled for today (default)", default: false },
      date: { type: "string", description: "Tasks scheduled on a specific YYYY-MM-DD" },
      project: { type: "string", alias: "p", description: "Filter by project/list ID" },
      search: { type: "string", description: "Keyword search across task titles" },
      json: { type: "boolean", description: "Emit JSON instead of text", default: false },
    },
    async run({ args }) {
      try {
        const options = buildQueryOptions(
          {
            inbox: Boolean(args.inbox),
            done: Boolean(args.done),
            all: Boolean(args.all),
            today: Boolean(args.today),
            date: args.date ? String(args.date) : undefined,
            project: args.project ? String(args.project) : undefined,
            search: args.search ? String(args.search) : undefined,
          },
          now(),
        );

        const tasks = options.search
          ? await components.taskQuery.searchTasks(options.search)
          : await components.taskQuery.listTasks(options);

        const shortIdMap = buildShortIdMap(tasks);
        await components.cache.saveShortIdMap(shortIdMap);

        if (args.json) {
          stdout.write(`${JSON.stringify(tasks, null, 2)}\n`);
        } else {
          stdout.write(formatTasksText(tasks));
        }
      } catch (err) {
        handleCliError(err, components.logger);
      }
    },
  });
}

export interface LsFlags {
  inbox: boolean;
  done: boolean;
  all: boolean;
  today: boolean;
  date?: string;
  project?: string;
  search?: string;
}

export function buildQueryOptions(flags: LsFlags, now: Date): TaskQueryOptions {
  const options: TaskQueryOptions = {};

  if (flags.inbox) {
    options.filter = "inbox";
  } else if (flags.done) {
    options.filter = "done";
  } else if (flags.all) {
    options.filter = "all";
  } else if (flags.date) {
    options.date = flags.date;
  } else if (flags.today || (!flags.search && !flags.project)) {
    options.filter = "today";
    options.date = toIsoDate(now);
  }

  if (flags.project) options.project = flags.project;
  if (flags.search) options.search = flags.search;

  return options;
}

export function buildShortIdMap(tasks: Task[]): Record<string, string> {
  const map: Record<string, string> = {};
  tasks.forEach((task, idx) => {
    map[String(idx + 1)] = task.id;
  });
  return map;
}

export function formatTasksText(tasks: Task[]): string {
  if (tasks.length === 0) return "(no tasks)\n";
  const lines = tasks.map((task, idx) => formatTaskLine(task, idx + 1));
  return `${lines.join("\n")}\n`;
}

function formatTaskLine(task: Task, shortId: number): string {
  const id = String(shortId).padStart(3, " ");
  const time = formatTime(task);
  const title = task.title ?? "(untitled)";
  const project = task.listId ? ` [${task.listId}]` : "";
  const done = task.done ? " ✓" : "";
  return `${id} ${time} ${title}${project}${done}`;
}

function formatTime(task: Task): string {
  if (task.datetime) {
    const [, time = ""] = task.datetime.split("T");
    return time.slice(0, 5).padEnd(5, " ") || "--:--";
  }
  if (task.date) return " date";
  return "inbox";
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
