// ---------------------------------------------------------------------------
// Raw Akiflow API → domain type mappers (ADR-0006 Hexagonal)
// Pure functions, zero I/O — kept separate from akiflow-api.ts so the
// raw-field-name assumptions here are unit-testable without mocking fetch.
//
// Field names come from reverse engineering (no official Akiflow API docs).
// Event/Calendar field names in particular are defensive: the community
// reference (shrimpwtf/akiflow-mcp) shows the v3 *write* payload using
// start_time/end_time/start_date/end_date while its v5 *read* response type
// uses start_datetime/end_datetime/all_day — the two are NOT guaranteed to
// match. Each mapper below tries every observed candidate field name so it
// degrades gracefully if the live shape differs from what's documented here.
// ---------------------------------------------------------------------------

import type {
  ActionItem,
  Calendar,
  CalendarEvent,
  MeetingBrief,
  Recording,
  TranscriptEntry,
} from "../../core/types.ts";

/** biome-ignore-start lint/suspicious/noExplicitAny: raw, undocumented API JSON */

export function mapCalendarEvent(raw: any): CalendarEvent {
  const start = raw?.start_datetime ?? raw?.start_time ?? (raw?.start_date ? `${raw.start_date}T00:00:00Z` : "");
  const end = raw?.end_datetime ?? raw?.end_time ?? (raw?.end_date ? `${raw.end_date}T23:59:59Z` : "");
  return {
    id: String(raw?.id ?? ""),
    title: raw?.title ?? "(no title)",
    start,
    end,
    calendarId: String(raw?.calendar_id ?? raw?.calendarId ?? ""),
  };
}

/**
 * True if a mapped CalendarEvent's [start, end) span touches `date` (YYYY-MM-DD).
 * Needed because `/v3/events?date=...` does not actually filter server-side
 * (live-probed 2026-08-30: a single-date request returned 250+ events spanning
 * multiple years) — see issue #86. Compares the UTC date portion of the ISO
 * start/end (both always populated by mapCalendarEvent's own fallbacks), so an
 * event with neither start nor end info (empty string) is excluded rather than
 * matching every date.
 */
export function eventOccursOnDate(event: CalendarEvent, date: string): boolean {
  const startDay = event.start.slice(0, 10);
  const endDay = event.end.slice(0, 10);
  if (!startDay) return false;
  return startDay <= date && date <= (endDay || startDay);
}

export function mapCalendar(raw: any): Calendar {
  return {
    id: String(raw?.id ?? ""),
    name: raw?.title ?? raw?.name ?? "(unnamed)",
    provider: raw?.connector_id ?? raw?.provider ?? "unknown",
    timezone: raw?.timezone ?? null,
    color: raw?.color ?? null,
    originId: raw?.origin_id ?? null,
    akiflowAccountId: raw?.akiflow_account_id ?? null,
    originAccountId: raw?.origin_account_id ?? null,
    readOnly: Boolean(raw?.read_only),
  };
}

export function mapActionItem(raw: any): ActionItem {
  return {
    id: String(raw?.id ?? ""),
    title: raw?.title ?? "(no title)",
    dueDate: raw?.dueDate ?? raw?.due_date ?? null,
  };
}

export function mapTranscriptEntry(raw: any): TranscriptEntry {
  return {
    speakerName: raw?.speakerName ?? raw?.speaker_name ?? "unknown",
    paragraph: raw?.paragraph ?? "",
    startTimeSec: raw?.startTimestamp?.relative ?? raw?.start_timestamp?.relative ?? 0,
  };
}

export function mapRecording(raw: any): Recording {
  const data = raw?.data ?? {};
  return {
    id: String(raw?.id ?? ""),
    title: data.title ?? "(no title)",
    startTime: data.startTime ?? data.start_time ?? "",
    endTime: data.endTime ?? data.end_time ?? "",
    summary: data.summary ?? null,
    actionItems: Array.isArray(data.actionItems ?? data.action_items)
      ? (data.actionItems ?? data.action_items).map(mapActionItem)
      : [],
    transcript: Array.isArray(data.transcript) ? data.transcript.map(mapTranscriptEntry) : [],
  };
}

export function mapMeetingBrief(raw: any): MeetingBrief {
  return {
    id: String(raw?.id ?? ""),
    originEventId: raw?.originEventId ?? raw?.origin_event_id ?? null,
    createdAt: raw?.createdAt ?? raw?.created_at ?? null,
    data: raw?.data && typeof raw.data === "object" ? raw.data : null,
  };
}

/**
 * Akiflow's write endpoints (PATCH/POST) sometimes return the upserted
 * records wrapped in an envelope (`{ data: [...] }`) and sometimes a bare
 * array or a single object, depending on endpoint/version. Normalize to an
 * array so callers never have to special-case the response shape.
 */
export function asDataArray(response: unknown): unknown[] {
  if (Array.isArray(response)) return response;
  if (response && typeof response === "object") {
    const obj = response as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data;
    if (typeof obj.id === "string") return [obj];
  }
  return [];
}

/** biome-ignore-end lint/suspicious/noExplicitAny: raw, undocumented API JSON */
