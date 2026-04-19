// ---------------------------------------------------------------------------
// af cal — view calendar events (ADR-0010 query side, ADR-0013 cache-aware)
// Default: today's events. Flags: --date, --days N, --free, --json.
// --free computes gaps in a default work window (09:00–18:00).
// ---------------------------------------------------------------------------

import { ValidationError } from "@core/errors/index.ts";
import type { LoggerPort } from "@core/ports/logger-port.ts";
import type { Calendar, CalendarEvent } from "@core/types.ts";
import { computeFreeSlotsByDate, type FreeSlot } from "@core/utils/free-slots.ts";
import { defineCommand } from "citty";
import { handleCliError } from "../app.ts";

// Re-export pure utilities so existing CLI tests (and any external callers)
// keep their import path; logic now lives in @core/utils/free-slots.ts.
export { computeFreeSlots, computeFreeSlotsByDate, type FreeSlot } from "@core/utils/free-slots.ts";

export interface CalQueryApi {
  getEvents(date: string): Promise<CalendarEvent[]>;
  getCalendars(): Promise<Calendar[]>;
}

export interface CalCommandComponents {
  taskQuery: CalQueryApi;
  logger: LoggerPort;
}

export interface CliWriter {
  write(chunk: string): boolean;
}

export interface CalCommandOptions {
  stdout?: CliWriter;
  now?: () => Date;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 14;
const DEFAULT_WORK_START = "09:00";
const DEFAULT_WORK_END = "18:00";

export function createCalCommand(components: CalCommandComponents, options: CalCommandOptions = {}) {
  const stdout = options.stdout ?? process.stdout;
  const now = options.now ?? (() => new Date());

  return defineCommand({
    meta: { name: "cal", description: "View calendar events" },
    args: {
      date: { type: "string", alias: "d", description: "Start date (YYYY-MM-DD). Defaults to today." },
      days: { type: "string", description: "Number of days to span (1-14). Defaults to 1." },
      free: { type: "boolean", description: "Show free slots within 09:00-18:00 instead of events", default: false },
      json: { type: "boolean", description: "Emit JSON instead of text", default: false },
    },
    async run({ args }) {
      try {
        const start = resolveStartDate(args.date ? String(args.date) : undefined, now());
        const days = parseDays(args.days ? String(args.days) : undefined);
        const byDate = await fetchRange(components.taskQuery, start, days);

        if (args.free) {
          const freeByDate = computeFreeSlotsByDate(byDate, DEFAULT_WORK_START, DEFAULT_WORK_END);
          if (args.json) {
            stdout.write(`${JSON.stringify(freeByDate, null, 2)}\n`);
          } else {
            stdout.write(formatFreeText(freeByDate));
          }
          return;
        }

        const calendars = await components.taskQuery.getCalendars().catch(() => [] as Calendar[]);
        if (args.json) {
          stdout.write(`${JSON.stringify(byDate, null, 2)}\n`);
        } else {
          stdout.write(formatEventsText(byDate, calendars));
        }
      } catch (err) {
        handleCliError(err, components.logger);
      }
    },
  });
}

export function resolveStartDate(input: string | undefined, now: Date): string {
  if (!input) return toIsoDate(now);
  if (!DATE_RE.test(input)) {
    throw new ValidationError(`invalid date: '${input}' (expected YYYY-MM-DD)`, "date");
  }
  return input;
}

export function parseDays(input: string | undefined): number {
  if (input === undefined) return 1;
  const n = Number(input);
  if (!Number.isInteger(n) || n < 1 || n > MAX_DAYS) {
    throw new ValidationError(`invalid days: '${input}' (expected 1-${MAX_DAYS})`, "days");
  }
  return n;
}

export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function fetchRange(
  api: CalQueryApi,
  start: string,
  days: number,
): Promise<Record<string, CalendarEvent[]>> {
  const byDate: Record<string, CalendarEvent[]> = {};
  for (let i = 0; i < days; i++) {
    const date = i === 0 ? start : addDaysIso(start, i);
    byDate[date] = await api.getEvents(date);
  }
  return byDate;
}

export function formatEventsText(byDate: Record<string, CalendarEvent[]>, calendars: Calendar[]): string {
  const calendarName = new Map(calendars.map((c) => [c.id, c.name]));
  const dates = Object.keys(byDate).sort();
  const sections: string[] = [];

  for (const date of dates) {
    const events = byDate[date].slice().sort((a, b) => a.start.localeCompare(b.start));
    sections.push(`## ${date}`);
    if (events.length === 0) {
      sections.push("  (no events)");
      continue;
    }
    for (const ev of events) {
      const timeRange = `${localTime(ev.start, date)}-${localTime(ev.end, date)}`;
      const calName = calendarName.get(ev.calendarId) ?? ev.calendarId;
      sections.push(`  ${timeRange}  ${ev.title}  [${calName}]`);
    }
  }
  return `${sections.join("\n")}\n`;
}

export function formatFreeText(byDate: Record<string, FreeSlot[]>): string {
  const dates = Object.keys(byDate).sort();
  const sections: string[] = [];
  for (const date of dates) {
    sections.push(`## ${date} — free slots (${DEFAULT_WORK_START}-${DEFAULT_WORK_END})`);
    const slots = byDate[date];
    if (slots.length === 0) {
      sections.push("  (no free slots)");
      continue;
    }
    for (const slot of slots) {
      sections.push(`  ${slot.start}-${slot.end}`);
    }
  }
  return `${sections.join("\n")}\n`;
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function localTime(iso: string, _date: string): string {
  const match = iso.match(/T(\d{2}:\d{2})/);
  return match ? match[1] : iso;
}
