// ---------------------------------------------------------------------------
// af cal — view calendar events (ADR-0010 query side, ADR-0013 cache-aware)
// Default: today's events. Flags: --date, --days N, --free, --json.
// --free computes gaps in a default work window (09:00–18:00).
// ---------------------------------------------------------------------------

import { defineCommand } from "citty";
import { ValidationError } from "../../core/errors/index.ts";
import type { LoggerPort } from "../../core/ports/logger-port.ts";
import type { Calendar, CalendarEvent } from "../../core/types.ts";
import { handleCliError } from "../app.ts";

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

export interface FreeSlot {
  start: string; // HH:MM
  end: string; // HH:MM
}

export function computeFreeSlots(
  events: CalendarEvent[],
  date: string,
  workStart: string,
  workEnd: string,
): FreeSlot[] {
  const windowStart = hhmmToMinutes(workStart);
  const windowEnd = hhmmToMinutes(workEnd);
  if (windowEnd <= windowStart) return [];

  const busy = events
    .map((ev) => ({ start: extractLocalMinutes(ev.start, date), end: extractLocalMinutes(ev.end, date) }))
    .filter((iv) => iv.end > windowStart && iv.start < windowEnd)
    .map((iv) => ({
      start: Math.max(iv.start, windowStart),
      end: Math.min(iv.end, windowEnd),
    }))
    .sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const iv of busy) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      merged.push({ ...iv });
    }
  }

  const slots: FreeSlot[] = [];
  let cursor = windowStart;
  for (const iv of merged) {
    if (iv.start > cursor) {
      slots.push({ start: minutesToHhmm(cursor), end: minutesToHhmm(iv.start) });
    }
    cursor = Math.max(cursor, iv.end);
  }
  if (cursor < windowEnd) {
    slots.push({ start: minutesToHhmm(cursor), end: minutesToHhmm(windowEnd) });
  }
  return slots;
}

export function computeFreeSlotsByDate(
  byDate: Record<string, CalendarEvent[]>,
  workStart: string,
  workEnd: string,
): Record<string, FreeSlot[]> {
  const out: Record<string, FreeSlot[]> = {};
  for (const [date, events] of Object.entries(byDate)) {
    out[date] = computeFreeSlots(events, date, workStart, workEnd);
  }
  return out;
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

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((v) => Number(v));
  return h * 60 + m;
}

function minutesToHhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function extractLocalMinutes(iso: string, fallbackDate: string): number {
  // Parse ISO timestamp as-is (strip timezone) so tests are deterministic.
  // If the date portion is outside `fallbackDate`, clamp to window edges.
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!match) return 0;
  const [, ymd, hh, mm] = match;
  if (ymd < fallbackDate) return 0;
  if (ymd > fallbackDate) return 24 * 60;
  return Number(hh) * 60 + Number(mm);
}

function localTime(iso: string, _date: string): string {
  const match = iso.match(/T(\d{2}:\d{2})/);
  return match ? match[1] : iso;
}
