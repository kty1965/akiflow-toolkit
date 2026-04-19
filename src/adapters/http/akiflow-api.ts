// ---------------------------------------------------------------------------
// Akiflow HTTP adapter — ADR-0006 Hexagonal, ADR-0008 errors
// Thin REST client. Services call these methods with an auth token supplied
// by AuthService.withAuth. Retries are composed at the service layer (ADR-0014).
// ---------------------------------------------------------------------------

import { ApiSchemaError, NetworkError } from "@core/errors/index.ts";
import type { AkiflowHttpPort, ListTasksParams } from "@core/ports/akiflow-http-port.ts";
import type { LoggerPort } from "@core/ports/logger-port.ts";
import type {
  ApiResponse,
  Calendar,
  CalendarEvent,
  CreateTaskPayload,
  Label,
  Tag,
  Task,
  TimeSlot,
  UpdateTaskPayload,
} from "@core/types.ts";

const BASE_URL = "https://api.akiflow.com";

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
    const url = `${this.baseUrl}${path}`;
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

  async getTasks(token: string, params: ListTasksParams = {}): Promise<ApiResponse<Task[]>> {
    const qs = new URLSearchParams();
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    if (params.sync_token) qs.set("sync_token", params.sync_token);
    const path = qs.toString() ? `/v5/tasks?${qs.toString()}` : "/v5/tasks";
    const res = await this.request<ApiResponse<Task[]>>("GET", path, token);
    assertApiResponseArray(res, "getTasks");
    return res;
  }

  async patchTasks(token: string, tasks: Array<CreateTaskPayload | UpdateTaskPayload>): Promise<ApiResponse<Task[]>> {
    const res = await this.request<ApiResponse<Task[]>>("PATCH", "/v5/tasks", token, tasks);
    assertApiResponseArray(res, "patchTasks");
    return res;
  }

  async getLabels(token: string): Promise<ApiResponse<Label[]>> {
    const res = await this.request<ApiResponse<Label[]>>("GET", "/v5/labels", token);
    assertApiResponseArray(res, "getLabels");
    return res;
  }

  async getTags(token: string): Promise<ApiResponse<Tag[]>> {
    const res = await this.request<ApiResponse<Tag[]>>("GET", "/v5/tags", token);
    assertApiResponseArray(res, "getTags");
    return res;
  }

  async getTimeSlots(token: string, date: string): Promise<ApiResponse<TimeSlot[]>> {
    const res = await this.request<ApiResponse<TimeSlot[]>>(
      "GET",
      `/v5/time_slots?date=${encodeURIComponent(date)}`,
      token,
    );
    assertApiResponseArray(res, "getTimeSlots");
    return res;
  }

  async getEvents(token: string, date: string): Promise<ApiResponse<CalendarEvent[]>> {
    const res = await this.request<ApiResponse<CalendarEvent[]>>(
      "GET",
      `/v3/events?date=${encodeURIComponent(date)}`,
      token,
    );
    assertApiResponseArray(res, "getEvents");
    return res;
  }

  async getCalendars(token: string): Promise<ApiResponse<Calendar[]>> {
    const res = await this.request<ApiResponse<Calendar[]>>("GET", "/v3/calendars", token);
    assertApiResponseArray(res, "getCalendars");
    return res;
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
