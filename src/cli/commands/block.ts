// ---------------------------------------------------------------------------
// af block — create a time-blocked task (ADR-0010 command side)
// Akiflow models time blocks as tasks with duration + scheduled datetime.
// Duration supports 1h, 30m, 2h30m composite forms.
// ---------------------------------------------------------------------------

import { ValidationError } from "@core/errors/index.ts";
import type { LoggerPort } from "@core/ports/logger-port.ts";
import type { CreateTaskInput } from "@core/services/task-command-service.ts";
import type { Task } from "@core/types.ts";
import { defineCommand } from "citty";
import { handleCliError } from "../app.ts";

export interface TaskCommandApi {
  createTask(input: CreateTaskInput): Promise<Task>;
}

export interface BlockCommandComponents {
  taskCommand: TaskCommandApi;
  logger: LoggerPort;
}

export interface CliWriter {
  write(chunk: string): boolean;
}

export interface BlockCommandOptions {
  stdout?: CliWriter;
  now?: () => Date;
}

const DURATION_TOKEN_RE = /^(?:(\d+)h)?(?:(\d+)m)?$/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function createBlockCommand(components: BlockCommandComponents, options: BlockCommandOptions = {}) {
  const stdout = options.stdout ?? process.stdout;
  const now = options.now ?? (() => new Date());

  return defineCommand({
    meta: { name: "block", description: "Create a time block" },
    args: {
      duration: { type: "positional", description: "Duration (e.g. 1h, 30m, 2h30m)", required: true },
      title: { type: "positional", description: "Block title", required: true },
      at: { type: "string", description: "Start time (HH:MM). Defaults to next round hour." },
      date: { type: "string", alias: "d", description: "Date (YYYY-MM-DD). Defaults to today." },
    },
    async run({ args }) {
      try {
        const input = buildBlockInput(
          String(args.title),
          {
            duration: String(args.duration),
            at: args.at ? String(args.at) : undefined,
            date: args.date ? String(args.date) : undefined,
          },
          now(),
        );
        const task = await components.taskCommand.createTask(input);
        stdout.write(`${formatBlock(task, input)}\n`);
      } catch (err) {
        handleCliError(err, components.logger);
      }
    },
  });
}

export interface BlockFlags {
  duration: string;
  at?: string;
  date?: string;
}

export function buildBlockInput(title: string, flags: BlockFlags, now: Date): CreateTaskInput {
  if (!title.trim()) throw new ValidationError("title is required", "title");

  const duration = parseBlockDuration(flags.duration);

  const date = flags.date ? validateDate(flags.date) : toIsoDate(now);
  const time = flags.at ? validateTime(flags.at) : nextRoundHour(now);

  return {
    title,
    date,
    datetime: `${date}T${time}:00`,
    duration,
  };
}

export function parseBlockDuration(value: string): number {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    throw new ValidationError("duration is required (e.g. 1h, 30m, 2h30m)", "duration");
  }
  const match = trimmed.match(DURATION_TOKEN_RE);
  if (!match || (!match[1] && !match[2])) {
    throw new ValidationError(`invalid duration: '${value}' (e.g. 1h, 30m, 2h30m)`, "duration");
  }
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = match[2] ? Number(match[2]) : 0;
  const ms = hours * 3_600_000 + minutes * 60_000;
  if (ms <= 0) {
    throw new ValidationError(`duration must be greater than 0: '${value}'`, "duration");
  }
  return ms;
}

function validateTime(value: string): string {
  if (!TIME_RE.test(value)) {
    throw new ValidationError(`invalid time: '${value}' (expected HH:MM)`, "at");
  }
  const [h, m] = value.split(":");
  return `${h.padStart(2, "0")}:${m}`;
}

function validateDate(value: string): string {
  if (!DATE_RE.test(value)) {
    throw new ValidationError(`invalid date: '${value}' (expected YYYY-MM-DD)`, "date");
  }
  return value;
}

function nextRoundHour(now: Date): string {
  const d = new Date(now.getTime());
  d.setMinutes(0, 0, 0);
  if (d <= now) d.setHours(d.getHours() + 1);
  return `${String(d.getHours()).padStart(2, "0")}:00`;
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatBlock(task: Task, input: CreateTaskInput): string {
  const shortId = task.id.slice(0, 8);
  const title = task.title ?? input.title;
  const when = input.datetime ?? input.date ?? "(unscheduled)";
  const durationMin = Math.round((input.duration ?? 0) / 60_000);
  return `Blocked ${shortId}: ${title} @ ${when} (${durationMin}m)`;
}
