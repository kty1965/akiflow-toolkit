// ---------------------------------------------------------------------------
// af add — create a new task (ADR-0010 command side, ADR-0009 output policy)
// ---------------------------------------------------------------------------

import * as chrono from "chrono-node";
import { defineCommand } from "citty";
import { ValidationError } from "../../core/errors/index.ts";
import type { LoggerPort } from "../../core/ports/logger-port.ts";
import type { CreateTaskInput } from "../../core/services/task-command-service.ts";
import type { Task } from "../../core/types.ts";
import { handleCliError } from "../app.ts";

export interface TaskCommandApi {
  createTask(input: CreateTaskInput): Promise<Task>;
}

export interface AddCommandComponents {
  taskCommand: TaskCommandApi;
  logger: LoggerPort;
}

export interface CliWriter {
  write(chunk: string): boolean;
}

export interface AddCommandOptions {
  stdout?: CliWriter;
  now?: () => Date;
}

const DURATION_RE = /^(\d+)(ms|s|m|h)$/i;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function createAddCommand(components: AddCommandComponents, options: AddCommandOptions = {}) {
  const stdout = options.stdout ?? process.stdout;
  const now = options.now ?? (() => new Date());

  return defineCommand({
    meta: { name: "add", description: "Create a new task" },
    args: {
      title: { type: "positional", description: "Task title", required: true },
      today: { type: "boolean", alias: "t", description: "Schedule for today", default: false },
      tomorrow: { type: "boolean", description: "Schedule for tomorrow", default: false },
      date: { type: "string", alias: "d", description: "Date (YYYY-MM-DD or natural, e.g. 'next monday')" },
      at: { type: "string", description: "Time of day (HH:MM)" },
      duration: { type: "string", description: "Duration (e.g. 1h, 30m, 45s)" },
      project: { type: "string", alias: "p", description: "Project/List ID" },
    },
    async run({ args }) {
      try {
        const title = String(args.title);
        if (!title.trim()) throw new ValidationError("title is required", "title");

        const input = buildCreateInput(
          title,
          {
            today: Boolean(args.today),
            tomorrow: Boolean(args.tomorrow),
            date: args.date ? String(args.date) : undefined,
            at: args.at ? String(args.at) : undefined,
            duration: args.duration ? String(args.duration) : undefined,
            project: args.project ? String(args.project) : undefined,
          },
          now(),
        );

        const task = await components.taskCommand.createTask(input);
        stdout.write(`${formatCreated(task)}\n`);
      } catch (err) {
        handleCliError(err, components.logger);
      }
    },
  });
}

export interface AddFlags {
  today: boolean;
  tomorrow: boolean;
  date?: string;
  at?: string;
  duration?: string;
  project?: string;
}

export function buildCreateInput(title: string, flags: AddFlags, now: Date): CreateTaskInput {
  const input: CreateTaskInput = { title };

  const resolvedDate = resolveDate(flags, now);
  if (resolvedDate) input.date = resolvedDate;

  if (flags.at) {
    if (!TIME_RE.test(flags.at)) {
      throw new ValidationError(`invalid time: '${flags.at}' (expected HH:MM)`, "at");
    }
    if (!resolvedDate) {
      throw new ValidationError("--at requires a date (use --today, --tomorrow, or --date)", "at");
    }
    input.datetime = `${resolvedDate}T${flags.at}:00`;
  }

  if (flags.duration) {
    input.duration = parseDurationMs(flags.duration);
  }

  if (flags.project) {
    input.projectId = flags.project;
  }

  return input;
}

export function resolveDate(flags: AddFlags, now: Date): string | undefined {
  const exclusive = [flags.today, flags.tomorrow, Boolean(flags.date)].filter(Boolean).length;
  if (exclusive > 1) {
    throw new ValidationError("--today, --tomorrow, and --date are mutually exclusive", "date");
  }

  if (flags.today) return toIsoDate(now);
  if (flags.tomorrow) {
    const d = new Date(now.getTime());
    d.setDate(d.getDate() + 1);
    return toIsoDate(d);
  }
  if (flags.date) {
    if (DATE_RE.test(flags.date)) return flags.date;
    const parsed = chrono.parseDate(flags.date, now);
    if (!parsed) throw new ValidationError(`unrecognized date: '${flags.date}'`, "date");
    return toIsoDate(parsed);
  }

  return undefined;
}

export function parseDurationMs(value: string): number {
  const match = value.trim().match(DURATION_RE);
  if (!match) {
    throw new ValidationError(`invalid duration: '${value}' (e.g. 1h, 30m, 45s)`, "duration");
  }
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case "ms":
      return n;
    case "s":
      return n * 1000;
    case "m":
      return n * 60_000;
    case "h":
      return n * 3_600_000;
    default:
      throw new ValidationError(`invalid duration unit: '${unit}'`, "duration");
  }
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatCreated(task: Task): string {
  const shortId = task.id.slice(0, 8);
  const when = task.datetime ?? task.date ?? "(inbox)";
  return `Created task ${shortId}: ${task.title ?? "(untitled)"} @ ${when}`;
}
