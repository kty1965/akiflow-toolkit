// ---------------------------------------------------------------------------
// Akiflow HTTP adapter — ADR-0006 Hexagonal, ADR-0008 errors
// Thin REST client. Services call these methods with an auth token supplied
// by AuthService.withAuth. Retries are composed at the service layer (ADR-0014).
// ---------------------------------------------------------------------------

import { ApiSchemaError, NetworkError } from "@core/errors/index.ts";
import type { AkiflowHttpPort, CreatedTaskFromActionItem, ListTasksParams } from "@core/ports/akiflow-http-port.ts";
import type { LoggerPort } from "@core/ports/logger-port.ts";
import type {
  AkiPageResponse,
  ApiResponse,
  Calendar,
  CalendarEvent,
  CreateEventInput,
  CreateTaskPayload,
  CreateTimeSlotInput,
  Label,
  MeetingBrief,
  Recording,
  Tag,
  Task,
  TimeSlot,
  UpdateEventInput,
  UpdateTaskPayload,
  UpdateTimeSlotInput,
} from "@core/types.ts";
import {
  asDataArray,
  eventOccursOnDate,
  mapCalendar,
  mapCalendarEvent,
  mapMeetingBrief,
  mapRecording,
} from "./akiflow-mappers.ts";

const BASE_URL = "https://api.akiflow.com";
// Meeting Assistant (recordings/briefs) lives on a separate Akiflow host —
// not configurable via AF_API_BASE_URL since it's a fixed internal detail,
// same precedent as the hardcoded refresh-token URL in token-refresh.ts.
const AKI_API_BASE_URL = "https://aki.akiflow.com/api/v1";

const BASE_HEADERS = {
  "Akiflow-Platform": "mac",
  "Akiflow-Version": "3",
  Accept: "application/json",
  "Content-Type": "application/json",
} as const;

export type { ListTasksParams };

export class AkiflowHttpAdapter implements AkiflowHttpPort {
  constructor(
    private readonly clientId: string,
    private readonly logger: LoggerPort,
    private readonly baseUrl: string = BASE_URL,
  ) {}

  async request<T>(method: string, path: string, token: string, body?: unknown): Promise<T> {
    // AKI Meeting Assistant endpoints pass a full absolute URL (different host);
    // every other call passes a relative path against `this.baseUrl`.
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        ...BASE_HEADERS,
        "Akiflow-Client-Id": this.clientId,
        Authorization: `Bearer ${token}`,
      },
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    this.logger.trace("akiflow request", { method, path });

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      throw new NetworkError(`fetch failed: ${method} ${path}`, undefined, err as Error);
    }

    if (res.status === 401) {
      throw new NetworkError(`unauthorized: ${method} ${path}`, 401);
    }

    if (!res.ok) {
      throw new NetworkError(`${method} ${path} failed: ${res.status}`, res.status);
    }

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch (err) {
      throw new ApiSchemaError(`invalid JSON from ${method} ${path}`, res.status, err as Error);
    }

    return parsed as T;
  }

  /**
   * Akiflow's raw /v5/tasks response has no `tags` field — the tag
   * association is `tags_ids` (live-probed and confirmed: setting
   * `tags_ids` via patchTasks round-trips correctly, but reading it back
   * needs this mapping, since the domain `Task.tags` field name doesn't
   * match the wire field).
   */
  async getTasks(token: string, params: ListTasksParams = {}): Promise<ApiResponse<Task[]>> {
    const qs = new URLSearchParams();
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    if (params.sync_token) qs.set("sync_token", params.sync_token);
    const path = qs.toString() ? `/v5/tasks?${qs.toString()}` : "/v5/tasks";
    const res = await this.request<ApiResponse<unknown[]>>("GET", path, token);
    assertApiResponseArray(res, "getTasks");
    return { ...res, data: res.data.map(mapTaskTags) };
  }

  async patchTasks(token: string, tasks: Array<CreateTaskPayload | UpdateTaskPayload>): Promise<ApiResponse<Task[]>> {
    const res = await this.request<ApiResponse<unknown[]>>("PATCH", "/v5/tasks", token, tasks);
    assertApiResponseArray(res, "patchTasks");
    return { ...res, data: res.data.map(mapTaskTags) };
  }

  /**
   * Akiflow's raw /v5/labels and /v5/tags responses use `title`, not `name`
   * (same convention as tasks) — live-probed and confirmed. Mapped here so
   * the domain `Label`/`Tag` types (which use `name`, matching how callers
   * already read them) don't silently render "undefined".
   */
  async getLabels(token: string): Promise<ApiResponse<Label[]>> {
    const res = await this.request<ApiResponse<unknown[]>>("GET", "/v5/labels", token);
    assertApiResponseArray(res, "getLabels");
    return { ...res, data: res.data.map(mapLabel) };
  }

  async getTags(token: string): Promise<ApiResponse<Tag[]>> {
    const res = await this.request<ApiResponse<unknown[]>>("GET", "/v5/tags", token);
    assertApiResponseArray(res, "getTags");
    return { ...res, data: res.data.map(mapTag) };
  }

  async getTimeSlots(token: string, date: string): Promise<ApiResponse<TimeSlot[]>> {
    const res = await this.request<ApiResponse<unknown[]>>(
      "GET",
      `/v5/time_slots?date=${encodeURIComponent(date)}`,
      token,
    );
    assertApiResponseArray(res, "getTimeSlots");
    return { ...res, data: res.data.map(mapTimeSlot) };
  }

  /**
   * Time slots use the same simple PATCH-upsert pattern as tasks
   * (live-probed: PATCH /v5/time_slots, not the complex v3 calendar-event
   * envelope createEvent needs) — no calendar-identity resolution required.
   */
  async createTimeSlot(token: string, input: CreateTimeSlotInput): Promise<ApiResponse<TimeSlot[]>> {
    const nowIso = new Date().toISOString();
    const toUtc = (s: string) => `${new Date(s).toISOString().slice(0, 19)}.000Z`;
    const rawSlot = {
      id: crypto.randomUUID(),
      calendar_id: input.calendarId,
      title: input.title,
      description: input.description ?? null,
      start_time: toUtc(input.startDatetime),
      end_time: toUtc(input.endDatetime),
      start_datetime_tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      status: "confirmed",
      global_created_at: nowIso,
      global_updated_at: nowIso,
    };
    const raw = await this.request<unknown>("PATCH", "/v5/time_slots", token, [rawSlot]);
    const data = asDataArray(raw).map(mapTimeSlot);
    return { success: true, message: null, data };
  }

  /** True partial update — live-probed: fields omitted here are left unchanged server-side. */
  async updateTimeSlot(token: string, input: UpdateTimeSlotInput): Promise<ApiResponse<TimeSlot[]>> {
    const toUtc = (s: string) => `${new Date(s).toISOString().slice(0, 19)}.000Z`;
    const rawSlot: Record<string, unknown> = {
      id: input.timeSlotId,
      global_updated_at: new Date().toISOString(),
    };
    if (input.title !== undefined) rawSlot.title = input.title;
    if (input.startDatetime !== undefined) rawSlot.start_time = toUtc(input.startDatetime);
    if (input.endDatetime !== undefined) rawSlot.end_time = toUtc(input.endDatetime);
    if (input.description !== undefined) rawSlot.description = input.description;

    const raw = await this.request<unknown>("PATCH", "/v5/time_slots", token, [rawSlot]);
    const data = asDataArray(raw).map(mapTimeSlot);
    return { success: true, message: null, data };
  }

  async deleteTimeSlot(token: string, timeSlotId: string): Promise<ApiResponse<TimeSlot[]>> {
    const rawSlot = {
      id: timeSlotId,
      deleted_at: new Date().toISOString(),
      global_updated_at: new Date().toISOString(),
    };
    const raw = await this.request<unknown>("PATCH", "/v5/time_slots", token, [rawSlot]);
    const data = asDataArray(raw).map(mapTimeSlot);
    return { success: true, message: null, data };
  }

  /**
   * `date` is sent as a query param but the server does not actually filter
   * by it (live-probed 2026-08-30, issue #86: a single-date request returned
   * 250+ events spanning multiple years) — so filtering happens client-side.
   */
  async getEvents(token: string, date: string): Promise<ApiResponse<CalendarEvent[]>> {
    const res = await this.request<ApiResponse<unknown[]>>("GET", `/v3/events?date=${encodeURIComponent(date)}`, token);
    assertApiResponseArray(res, "getEvents");
    const events = res.data.map(mapCalendarEvent).filter((event) => eventOccursOnDate(event, date));
    return { ...res, data: events };
  }

  async getCalendars(token: string): Promise<ApiResponse<Calendar[]>> {
    const res = await this.request<ApiResponse<unknown[]>>("GET", "/v3/calendars", token);
    assertApiResponseArray(res, "getCalendars");
    return { ...res, data: res.data.map(mapCalendar) };
  }

  /**
   * Create a calendar event. Akiflow's v3 write endpoint requires the full
   * calendar identity envelope (origin/account/connector ids), so this
   * resolves the target calendar first and rejects unknown/read-only ones —
   * mirroring the verified approach in the shrimpwtf/akiflow-mcp reference
   * (their v5-PATCH attempt 405'd; POST /v3/events with resolved identity is
   * what actually works).
   */
  async createEvent(token: string, input: CreateEventInput): Promise<ApiResponse<CalendarEvent[]>> {
    const calendars = await this.getCalendars(token);
    const calendar = calendars.data.find((c) => c.id === input.calendarId);
    if (!calendar) {
      throw new ApiSchemaError(`createEvent: calendar ${input.calendarId} not found — call get_calendars first`);
    }
    if (calendar.readOnly) {
      throw new ApiSchemaError(`createEvent: calendar "${calendar.name}" is read-only`);
    }

    const allDay = input.allDay ?? false;
    const toUtc = (s: string) => `${new Date(s).toISOString().slice(0, 19)}.000Z`;
    const nowIso = new Date().toISOString();

    const rawEvent = {
      id: crypto.randomUUID(),
      title: input.title,
      description: input.description ?? null,
      start_time: allDay ? null : toUtc(input.startDatetime),
      end_time: allDay ? null : toUtc(input.endDatetime),
      start_date: allDay ? input.startDatetime.split("T")[0] : null,
      end_date: allDay ? input.endDatetime.split("T")[0] : null,
      status: "confirmed",
      start_datetime_tz: calendar.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      end_datetime_tz: null,
      creator_id: calendar.originId,
      organizer_id: calendar.originId,
      origin_id: null,
      connector_id: calendar.provider,
      akiflow_account_id: calendar.akiflowAccountId,
      origin_account_id: calendar.originAccountId,
      recurring_id: null,
      origin_recurring_id: null,
      calendar_id: input.calendarId,
      origin_calendar_id: calendar.originId,
      original_start_time: null,
      original_start_date: null,
      origin_updated_at: null,
      etag: null,
      content: { sendUpdates: "all" },
      attendees: [],
      recurrence: null,
      recurrence_exception: false,
      declined: false,
      read_only: false,
      hidden: false,
      url: null,
      meeting_status: null,
      meeting_url: null,
      meeting_icon: null,
      meeting_solution: null,
      color: null,
      calendar_color: calendar.color,
      task_id: null,
      time_slot_id: null,
      recurrence_exception_delete: false,
      global_created_at: null,
      deleted_at: null,
      global_updated_at: nowIso,
      ...(input.location && { location: input.location }),
    };

    const raw = await this.request<unknown>("POST", "/v3/events", token, [rawEvent]);
    const data = asDataArray(raw).map(mapCalendarEvent);
    return { success: true, message: null, data };
  }

  /**
   * Partially update a calendar event. Same POST /v3/events write endpoint
   * as createEvent, but live-probed as a true partial update: only the
   * calendar identity envelope (connector/account/calendar ids) plus
   * creator_id/organizer_id are required, and any field omitted (e.g.
   * start_time/end_time when only renaming) is left unchanged server-side —
   * unlike createEvent, which must supply the full event shape.
   */
  async updateEvent(token: string, input: UpdateEventInput): Promise<ApiResponse<CalendarEvent[]>> {
    const calendars = await this.getCalendars(token);
    const calendar = calendars.data.find((c) => c.id === input.calendarId);
    if (!calendar) {
      throw new ApiSchemaError(`updateEvent: calendar ${input.calendarId} not found — call get_calendars first`);
    }
    if (calendar.readOnly) {
      throw new ApiSchemaError(`updateEvent: calendar "${calendar.name}" is read-only`);
    }

    const toUtc = (s: string) => `${new Date(s).toISOString().slice(0, 19)}.000Z`;

    const rawEvent: Record<string, unknown> = {
      id: input.eventId,
      connector_id: calendar.provider,
      origin_account_id: calendar.originAccountId,
      akiflow_account_id: calendar.akiflowAccountId,
      calendar_id: calendar.id,
      origin_calendar_id: calendar.originId,
      creator_id: calendar.originId,
      organizer_id: calendar.originId,
      global_updated_at: new Date().toISOString(),
    };
    if (input.title !== undefined) rawEvent.title = input.title;
    if (input.startDatetime !== undefined) rawEvent.start_time = toUtc(input.startDatetime);
    if (input.endDatetime !== undefined) rawEvent.end_time = toUtc(input.endDatetime);
    if (input.description !== undefined) rawEvent.description = input.description;
    if (input.location !== undefined) rawEvent.location = input.location;

    const raw = await this.request<unknown>("POST", "/v3/events", token, [rawEvent]);
    const data = asDataArray(raw).map(mapCalendarEvent);
    return { success: true, message: null, data };
  }

  /**
   * Soft-delete a calendar event. Same POST /v3/events write endpoint as
   * createEvent (confirmed live: the server rejects a minimal
   * `{id, deleted_at}` payload with "connector id/origin account id/akiflow
   * account id/calendar id/origin calendar id required" — it needs the same
   * calendar identity envelope, just without title/start/end).
   */
  async deleteEvent(token: string, calendarId: string, eventId: string): Promise<ApiResponse<CalendarEvent[]>> {
    const calendars = await this.getCalendars(token);
    const calendar = calendars.data.find((c) => c.id === calendarId);
    if (!calendar) {
      throw new ApiSchemaError(`deleteEvent: calendar ${calendarId} not found — call get_calendars first`);
    }

    const rawEvent = {
      id: eventId,
      deleted_at: new Date().toISOString(),
      connector_id: calendar.provider,
      origin_account_id: calendar.originAccountId,
      akiflow_account_id: calendar.akiflowAccountId,
      calendar_id: calendar.id,
      origin_calendar_id: calendar.originId,
    };

    const raw = await this.request<unknown>("POST", "/v3/events", token, [rawEvent]);
    const data = asDataArray(raw).map(mapCalendarEvent);
    return { success: true, message: null, data };
  }

  async getRecordings(token: string, cursor?: string): Promise<AkiPageResponse<Recording>> {
    const params = new URLSearchParams({ per_page: "100" });
    if (cursor) params.set("cursor", cursor);
    const res = await this.request<{ data: unknown[]; next_cursor?: string | null }>(
      "GET",
      `${AKI_API_BASE_URL}/recordings?${params.toString()}`,
      token,
    );
    return { data: (res.data ?? []).map(mapRecording), nextCursor: res.next_cursor ?? null };
  }

  async getRecording(token: string, id: string): Promise<Recording> {
    const res = await this.request<{ data: unknown }>("GET", `${AKI_API_BASE_URL}/recordings/${id}`, token);
    return mapRecording(res.data);
  }

  async getMeetingBriefs(token: string, cursor?: string): Promise<AkiPageResponse<MeetingBrief>> {
    const params = new URLSearchParams({ per_page: "100" });
    if (cursor) params.set("cursor", cursor);
    const res = await this.request<{ data: unknown[]; next_cursor?: string | null }>(
      "GET",
      `${AKI_API_BASE_URL}/researches?${params.toString()}`,
      token,
    );
    return { data: (res.data ?? []).map(mapMeetingBrief), nextCursor: res.next_cursor ?? null };
  }

  async getMeetingBrief(token: string, id: string): Promise<MeetingBrief> {
    const res = await this.request<{ data: unknown }>("GET", `${AKI_API_BASE_URL}/researches/${id}`, token);
    return mapMeetingBrief(res.data);
  }

  async createTaskFromActionItem(
    token: string,
    recordingId: string,
    actionItemId: string,
  ): Promise<CreatedTaskFromActionItem> {
    const raw = await this.request<unknown>(
      "POST",
      `${AKI_API_BASE_URL}/recordings/createTaskFromActionItem/${recordingId}/${actionItemId}`,
      token,
    );
    const created = asDataArray(raw)[0] as { id?: unknown; title?: unknown } | undefined;
    return {
      id: typeof created?.id === "string" ? created.id : null,
      title: typeof created?.title === "string" ? created.title : null,
    };
  }
}

function assertApiResponseArray(value: unknown, label: string): void {
  if (
    !value ||
    typeof value !== "object" ||
    !("data" in (value as Record<string, unknown>)) ||
    !Array.isArray((value as { data: unknown }).data)
  ) {
    throw new ApiSchemaError(`${label}: expected ApiResponse with data array`);
  }
}

// biome-ignore lint/suspicious/noExplicitAny: raw API response, shape asserted by assertApiResponseArray
function mapTimeSlot(raw: any): TimeSlot {
  return {
    id: String(raw?.id ?? ""),
    calendarId: raw?.calendar_id ?? null,
    title: raw?.title ?? null,
    description: raw?.description ?? null,
    start: raw?.start_time ?? "",
    end: raw?.end_time ?? "",
    status: raw?.status ?? null,
    recurrence: raw?.recurrence ?? null,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: raw API response, shape asserted by assertApiResponseArray
function mapTaskTags(raw: any): Task {
  return { ...raw, tags: raw?.tags_ids ?? [], links: raw?.links ?? [] } as Task;
}

// biome-ignore lint/suspicious/noExplicitAny: raw API response, shape asserted by assertApiResponseArray
function mapLabel(raw: any): Label {
  return {
    id: String(raw?.id ?? ""),
    name: raw?.title ?? raw?.name ?? "(unnamed)",
    color: raw?.color ?? null,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: raw API response, shape asserted by assertApiResponseArray
function mapTag(raw: any): Tag {
  return {
    id: String(raw?.id ?? ""),
    name: raw?.title ?? raw?.name ?? "(unnamed)",
  };
}
