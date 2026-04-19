// ---------------------------------------------------------------------------
// af task — edit / move / plan / snooze / delete subcommands
// (ADR-0010 command side, ADR-0008 error mapping)
// Accepts short IDs (1, 2, 3) from `af ls`, UUIDs, or 6+ char UUID prefixes.
// ---------------------------------------------------------------------------

import { NotFoundError, ValidationError } from "@core/errors/index.ts";
import type { CachePort } from "@core/ports/cache-port.ts";
import type { LoggerPort } from "@core/ports/logger-port.ts";
import type { UpdateTaskInput } from "@core/services/task-command-service.ts";
import type { Task } from "@core/types.ts";
import { resolveTaskId } from "@core/utils/resolve-task-id.ts";
import * as chrono from "chrono-node";
import { defineCommand } from "citty";
import { RRule } from "rrule";
import { handleCliError } from "../app.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export interface TaskWriteApi {
  updateTask(id: string, patch: UpdateTaskInput): Promise<Task>;
  scheduleTask(id: string, date: string, time?: string): Promise<Task>;
  deleteTask(id: string): Promise<Task>;
}

export type TaskCache = Pick<CachePort, "getTasks" | "resolveShortId">;

export interface TaskCommandComponents {
  taskCommand: TaskWriteApi;
  cache: TaskCache;
  logger: LoggerPort;
}

export interface CliWriter {
  write(chunk: string): boolean;
}

export interface TaskCommandOptions {
  stdout?: CliWriter;
  now?: () => Date;
}

export function createTaskCommand(components: TaskCommandComponents, options: TaskCommandOptions = {}) {
  return defineCommand({
    meta: { name: "task", description: "Edit, move, plan, snooze, or delete a task" },
    subCommands: {
      edit: () => createEditCommand(components, options),
      move: () => createMoveCommand(components, options),
      plan: () => createPlanCommand(components, options),
      snooze: () => createSnoozeCommand(components, options),
      delete: () => createDeleteCommand(components, options),
    },
  });
}

// ---------------------------------------------------------------------------
// af task edit <id> [--title T] [--date D]
// ---------------------------------------------------------------------------

export function createEditCommand(components: TaskCommandComponents, options: TaskCommandOptions = {}) {
  const stdout = options.stdout ?? process.stdout;
  const now = options.now ?? (() => new Date());

  return defineCommand({
    meta: { name: "edit", description: "Edit task fields (title, date)" },
    args: {
      id: { type: "positional", description: "Task ID (short ID, UUID, or 6+ char prefix)", required: true },
      title: { type: "string", description: "New task title" },
      date: { type: "string", alias: "d", description: "New date (YYYY-MM-DD or natural, e.g. 'tomorrow')" },
    },
    async run({ args }) {
      try {
        const id = await resolveInput(String(args.id), components.cache);
        const patch: UpdateTaskInput = {};

        if (args.title !== undefined) {
          const title = String(args.title);
          if (!title.trim()) throw new ValidationError("title must not be empty", "title");
          patch.title = title;
        }

        if (args.date !== undefined) {
          patch.date = parseDateFlag(String(args.date), now());
        }

        if (Object.keys(patch).length === 0) {
          throw new ValidationError("edit: at least one of --title or --date is required");
        }

        const task = await components.taskCommand.updateTask(id, patch);
        stdout.write(`${formatUpdated("Edited", task)}\n`);
      } catch (err) {
        handleCliError(err, components.logger);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// af task move <id> -d <date> [--at HH:MM]
// Reschedules the task to a new date (with optional time).
// ---------------------------------------------------------------------------

export function createMoveCommand(components: TaskCommandComponents, options: TaskCommandOptions = {}) {
  return buildScheduleCommand(components, options, {
    name: "move",
    description: "Move task to a new date/time",
    verb: "Moved",
  });
}

// ---------------------------------------------------------------------------
// af task snooze <id> -d <date> [--at HH:MM]
// Alias of move in shape — differs only in output verb.
// ---------------------------------------------------------------------------

export function createSnoozeCommand(components: TaskCommandComponents, options: TaskCommandOptions = {}) {
  return buildScheduleCommand(components, options, {
    name: "snooze",
    description: "Snooze task to a later date/time",
    verb: "Snoozed",
  });
}

interface ScheduleCommandConfig {
  name: "move" | "snooze";
  description: string;
  verb: "Moved" | "Snoozed";
}

function buildScheduleCommand(
  components: TaskCommandComponents,
  options: TaskCommandOptions,
  config: ScheduleCommandConfig,
) {
  const stdout = options.stdout ?? process.stdout;
  const now = options.now ?? (() => new Date());

  return defineCommand({
    meta: { name: config.name, description: config.description },
    args: {
      id: { type: "positional", description: "Task ID (short ID, UUID, or 6+ char prefix)", required: true },
      date: {
        type: "string",
        alias: "d",
        description: "New date (YYYY-MM-DD or natural, e.g. 'next monday')",
        required: true,
      },
      at: { type: "string", description: "Time of day (HH:MM, 24h)" },
    },
    async run({ args }) {
      try {
        const id = await resolveInput(String(args.id), components.cache);
        const date = parseDateFlag(String(args.date), now());

        let time: string | undefined;
        if (args.at !== undefined) {
          const at = String(args.at);
          if (!TIME_RE.test(at)) {
            throw new ValidationError(`invalid time: '${at}' (expected HH:MM)`, "at");
          }
          time = at;
        }

        const task = await components.taskCommand.scheduleTask(id, date, time);
        stdout.write(`${formatUpdated(config.verb, task)}\n`);
      } catch (err) {
        handleCliError(err, components.logger);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// af task plan <id> --at HH:MM [--recurrence RRULE]
// Sets a time (requires existing or explicit date) and optional RRULE.
// ---------------------------------------------------------------------------

export function createPlanCommand(components: TaskCommandComponents, options: TaskCommandOptions = {}) {
  const stdout = options.stdout ?? process.stdout;
  const now = options.now ?? (() => new Date());

  return defineCommand({
    meta: { name: "plan", description: "Plan a task (set time and/or recurrence)" },
    args: {
      id: { type: "positional", description: "Task ID (short ID, UUID, or 6+ char prefix)", required: true },
      at: { type: "string", description: "Time of day (HH:MM, 24h)", required: true },
      date: { type: "string", alias: "d", description: "Date (YYYY-MM-DD or natural) — required if task has no date" },
      recurrence: {
        type: "string",
        alias: "r",
        description: "RRULE string, e.g. 'FREQ=WEEKLY;BYDAY=MO'",
      },
    },
    async run({ args }) {
      try {
        const tasks = await components.cache.getTasks();
        const shortIdMap = await loadShortIdMap([String(args.id)], components.cache);
        const id = resolveTaskId(String(args.id), tasks, shortIdMap);
        if (!id) {
          throw new NotFoundError(`task not found for id: '${String(args.id)}'`);
        }

        const at = String(args.at);
        if (!TIME_RE.test(at)) {
          throw new ValidationError(`invalid time: '${at}' (expected HH:MM)`, "at");
        }

        const date = args.date !== undefined ? parseDateFlag(String(args.date), now()) : findExistingDate(tasks, id);
        if (!date) {
          throw new ValidationError("plan: task has no date — provide --date alongside --at", "date");
        }

        let recurrence: string | undefined;
        if (args.recurrence !== undefined) {
          recurrence = validateRecurrence(String(args.recurrence));
        }

        const patch: UpdateTaskInput = {
          date,
          datetime: `${date}T${at}:00`,
        };
        if (recurrence !== undefined) patch.recurrence = recurrence;

        const task = await components.taskCommand.updateTask(id, patch);
        stdout.write(`${formatUpdated("Planned", task)}\n`);
      } catch (err) {
        handleCliError(err, components.logger);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// af task delete <id>
// Soft delete — sets deleted_at; task no longer appears in active lists.
// ---------------------------------------------------------------------------

export function createDeleteCommand(components: TaskCommandComponents, options: TaskCommandOptions = {}) {
  const stdout = options.stdout ?? process.stdout;

  return defineCommand({
    meta: { name: "delete", description: "Soft-delete a task (sets deleted_at)" },
    args: {
      id: { type: "positional", description: "Task ID (short ID, UUID, or 6+ char prefix)", required: true },
    },
    async run({ args }) {
      try {
        const id = await resolveInput(String(args.id), components.cache);
        const task = await components.taskCommand.deleteTask(id);
        stdout.write(`${formatUpdated("Deleted", task)}\n`);
      } catch (err) {
        handleCliError(err, components.logger);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function resolveInput(raw: string, cache: TaskCache): Promise<string> {
  const tasks = await cache.getTasks();
  const shortIdMap = await loadShortIdMap([raw], cache);
  const id = resolveTaskId(raw, tasks, shortIdMap);
  if (!id) {
    throw new NotFoundError(`task not found for id: '${raw}'`);
  }
  return id;
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

export function parseDateFlag(value: string, now: Date): string {
  if (DATE_RE.test(value)) return value;
  const parsed = chrono.parseDate(value, now);
  if (!parsed) {
    throw new ValidationError(`unrecognized date: '${value}'`, "date");
  }
  return toIsoDate(parsed);
}

export function validateRecurrence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ValidationError("recurrence must not be empty", "recurrence");
  }
  try {
    RRule.parseString(trimmed);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`invalid RRULE: ${reason}`, "recurrence");
  }
  return trimmed;
}

function findExistingDate(tasks: Task[], id: string): string | null {
  const hit = tasks.find((t) => t.id === id);
  return hit?.date ?? null;
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatUpdated(verb: string, task: Task): string {
  const shortId = task.id.slice(0, 8);
  const when = task.datetime ?? task.date ?? "(inbox)";
  const title = task.title ?? "(untitled)";
  return `${verb} task ${shortId}: ${title} @ ${when}`;
}
