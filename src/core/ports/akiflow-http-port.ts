// ---------------------------------------------------------------------------
// AkiflowHttpPort — HTTP contract for Akiflow v5/v3 REST (ADR-0006)
// core/services/ depends on this port; adapters/http implements it.
// ---------------------------------------------------------------------------

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
} from "../types.ts";

export interface ListTasksParams {
  sync_token?: string;
  limit?: number;
}

export interface AkiflowHttpPort {
  getTasks(token: string, params?: ListTasksParams): Promise<ApiResponse<Task[]>>;
  patchTasks(token: string, tasks: Array<CreateTaskPayload | UpdateTaskPayload>): Promise<ApiResponse<Task[]>>;
  getLabels(token: string): Promise<ApiResponse<Label[]>>;
  getTags(token: string): Promise<ApiResponse<Tag[]>>;
  getTimeSlots(token: string, date: string): Promise<ApiResponse<TimeSlot[]>>;
  getEvents(token: string, date: string): Promise<ApiResponse<CalendarEvent[]>>;
  getCalendars(token: string): Promise<ApiResponse<Calendar[]>>;
}
