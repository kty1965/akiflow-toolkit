// ---------------------------------------------------------------------------
// Free-slot computation — pure domain utility shared by CLI `af cal --free`
// and MCP `get_free_slots` tool. Inputs are calendar events + a work window;
// output is a list of gaps (HH:MM ranges). No external deps, no I/O.
// ---------------------------------------------------------------------------

import type { CalendarEvent } from "../types.ts";

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

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((v) => Number(v));
  return h * 60 + m;
}

export function minutesToHhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Parse ISO timestamp as-is (strip timezone) so tests are deterministic.
// If the date portion is outside `fallbackDate`, clamp to window edges.
export function extractLocalMinutes(iso: string, fallbackDate: string): number {
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!match) return 0;
  const [, ymd, hh, mm] = match;
  if (ymd < fallbackDate) return 0;
  if (ymd > fallbackDate) return 24 * 60;
  return Number(hh) * 60 + Number(mm);
}
