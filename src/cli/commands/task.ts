// ---------------------------------------------------------------------------
// af task — edit / move / plan / snooze / delete subcommands
// (ADR-0010 command side, ADR-0008 error mapping)
// Accepts short IDs (1, 2, 3) from `af ls`, UUIDs, or 6+ char UUID prefixes.
// ---------------------------------------------------------------------------

import { NotFoundError, ValidationError } from "@core/errors/index.ts";
import type { CachePort } from "@core/ports/cache-port.ts";
import type { LoggerPort } from "@core/ports/logger-port.ts";
import type { CreateTaskInput, UpdateTaskInput } from "@core/services/task-command-service.ts";
import { duplicateTask } from "@core/services/task-duplicate.ts";
import type { Task } from "@core/types.ts";
import { resolveTaskId } from "@core/utils/resolve-task-id.ts";
import * as chrono from "chrono-node";
import { defineCommand } from "citty";
import { RRule } from "rrule";
import { handleCliError } from "../app.ts";
import { parseDurationMs } from "./add.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export interface TaskWriteApi {
  updateTask(id: string, patch: UpdateTaskInput): Promise<Task>;
  scheduleTask(id: string, date: string, time?: string): Promise<Task>;
  deleteTask(id: string): Promise<Task>;
  uncompleteTask(id: string): Promise<Task>;
  restoreTask(id: string): Promise<Task>;
  shareTask(id: string): Promise<Task>;
  unshareTask(id: string): Promise<Task>;
  createTask(input: CreateTaskInput): Promise<Task>;
}

export type TaskCache = Pick<CachePort, "getTasks" | "resolveShortId">;

export interface TaskCommandComponents {
  taskCommand: TaskWriteApi;
  cache: TaskCache;
  logger: LoggerPort;
  taskQuery: { getTaskById(id: string): Promise<Task | null> };
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
    meta: {
      name: "task",
      description: "Edit, move, plan, snooze, delete, undo, restore, share, unshare, or duplicate a task",
    },
    subCommands: {
      edit: () => createEditCommand(components, options),
      move: () => createMoveCommand(components, options),
      plan: () => createPlanCommand(components, options),
      snooze: () => createSnoozeCommand(components, options),
      delete: () => createDeleteCommand(components, options),
      undo: () => createUndoCommand(components, options),
      restore: () => createRestoreCommand(components, options),
      share: () => createShareCommand(components, options),
      unshare: () => createUnshareCommand(components, options),
      dup: () => createDupCommand(components, options),
    },
  });
}

// ---------------------------------------------------------------------------
// af task edit <id> [--title T] [--date D] [--description T] [--priority N]
//               [--duration D] [--project ID] [--parent ID] [--position N]
// ---------------------------------------------------------------------------

export function createEditCommand(components: TaskCommandComponents, options: TaskCommandOptions = {}) {
  const stdout = options.stdout ?? process.stdout;
  const now = options.now ?? (() => new Date());

  return defineCommand({
    meta: {
      name: "edit",
      description: "Edit task fields (title, date, description, priority, duration, project, parent, position)",
    },
    args: {
      id: { type: "positional", description: "Task ID (short ID, UUID, or 6+ char prefix)", required: true },
      title: { type: "string", description: "New task title" },
      date: { type: "string", alias: "d", description: "New date (YYYY-MM-DD or natural, e.g. 'tomorrow')" },
      description: { type: "string", description: "New description/notes" },
      priority: { type: "string", description: "New priority level" },
      duration: { type: "string", description: "New duration (e.g. 1h, 30m, 45s)" },
      project: { type: "string", alias: "p", description: "New project/list ID" },
      parent: { type: "string", description: "New parent task ID (makes this a subtask)" },
      position: { type: "string", description: "New position/sort order" },
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

        if (args.description !== undefined) {
          patch.description = String(args.description);
        }

        if (args.priority !== undefined) {
          const raw = String(args.priority).trim();
          const parsed = Number(raw);
          if (!raw || !Number.isInteger(parsed)) {
            throw new ValidationError("priority must be an integer", "priority");
          }
          patch.priority = parsed;
        }

        if (args.duration !== undefined) {
          patch.duration = parseDurationMs(String(args.duration));
        }

        if (args.project !== undefined) {
          const projectId = String(args.project).trim();
          if (!projectId) throw new ValidationError("project must not be empty", "project");
          patch.projectId = projectId;
        }

        if (args.parent !== undefined) {
          const parentId = String(args.parent).trim();
          if (!parentId) throw new ValidationError("parent must not be empty", "parent");
          patch.parentId = parentId;
        }

        if (args.position !== undefined) {
          const raw = String(args.position).trim();
          const parsed = Number(raw);
          if (!raw || !Number.isInteger(parsed)) {
            throw new ValidationError("position must be an integer", "position");
          }
          patch.position = parsed;
        }

        if (Object.keys(patch).length === 0) {
          throw new ValidationError(
            "edit: at least one of --title, --date, --description, --priority, --duration, --project, --parent, or --position is required",
          );
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
// af task undo <id>
// Un-completes a task — clears done/status.
// ---------------------------------------------------------------------------

export function createUndoCommand(components: TaskCommandComponents, options: TaskCommandOptions = {}) {
  const stdout = options.stdout ?? process.stdout;

  return defineCommand({
    meta: { name: "undo", description: "Un-complete a task (clears done/status)" },
    args: {
      id: { type: "positional", description: "Task ID (short ID, UUID, or 6+ char prefix)", required: true },
    },
    async run({ args }) {
      try {
        const id = await resolveInput(String(args.id), components.cache);
        const task = await components.taskCommand.uncompleteTask(id);
        stdout.write(`${formatUpdated("Undone", task)}\n`);
      } catch (err) {
        handleCliError(err, components.logger);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// af task restore <id>
// Un-deletes a task — clears deleted_at.
// ---------------------------------------------------------------------------

export function createRestoreCommand(components: TaskCommandComponents, options: TaskCommandOptions = {}) {
  const stdout = options.stdout ?? process.stdout;

  return defineCommand({
    meta: { name: "restore", description: "Restore a soft-deleted task (clears deleted_at)" },
    args: {
      id: { type: "positional", description: "Task ID (short ID, UUID, or 6+ char prefix)", required: true },
    },
    async run({ args }) {
      try {
        const id = await resolveInput(String(args.id), components.cache);
        const task = await components.taskCommand.restoreTask(id);
        stdout.write(`${formatUpdated("Restored", task)}\n`);
      } catch (err) {
        handleCliError(err, components.logger);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// af task share <id>
// Sets shared=true.
// ---------------------------------------------------------------------------

export function createShareCommand(components: TaskCommandComponents, options: TaskCommandOptions = {}) {
  const stdout = options.stdout ?? process.stdout;

  return defineCommand({
    meta: { name: "share", description: "Share a task (sets shared=true)" },
    args: {
      id: { type: "positional", description: "Task ID (short ID, UUID, or 6+ char prefix)", required: true },
    },
    async run({ args }) {
      try {
        const id = await resolveInput(String(args.id), components.cache);
        const task = await components.taskCommand.shareTask(id);
        stdout.write(`${formatUpdated("Shared", task)}\n`);
      } catch (err) {
        handleCliError(err, components.logger);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// af task unshare <id>
// Sets shared=false.
// ---------------------------------------------------------------------------

export function createUnshareCommand(components: TaskCommandComponents, options: TaskCommandOptions = {}) {
  const stdout = options.stdout ?? process.stdout;

  return defineCommand({
    meta: { name: "unshare", description: "Unshare a task (sets shared=false)" },
    args: {
      id: { type: "positional", description: "Task ID (short ID, UUID, or 6+ char prefix)", required: true },
    },
    async run({ args }) {
      try {
        const id = await resolveInput(String(args.id), components.cache);
        const task = await components.taskCommand.unshareTask(id);
        stdout.write(`${formatUpdated("Unshared", task)}\n`);
      } catch (err) {
        handleCliError(err, components.logger);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// af task dup <id>
// Reads the source task, then creates a copy via task-duplicate.ts.
// ---------------------------------------------------------------------------

export function createDupCommand(components: TaskCommandComponents, options: TaskCommandOptions = {}) {
  const stdout = options.stdout ?? process.stdout;

  return defineCommand({
    meta: { name: "dup", description: "Duplicate a task (copies title, date, duration, and project)" },
    args: {
      id: { type: "positional", description: "Task ID (short ID, UUID, or 6+ char prefix)", required: true },
    },
    async run({ args }) {
      try {
        const id = await resolveInput(String(args.id), components.cache);
        const task = await duplicateTask(
          {
            getTaskById: (taskId) => components.taskQuery.getTaskById(taskId),
            createTask: (input) => components.taskCommand.createTask(input),
          },
          id,
        );
        stdout.write(`${formatUpdated("Duplicated", task)}\n`);
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
