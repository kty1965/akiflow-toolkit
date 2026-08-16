// ---------------------------------------------------------------------------
// AkiflowHttpPort — HTTP contract for Akiflow v5/v3 REST (ADR-0006)
// core/services/ depends on this port; adapters/http implements it.
// ---------------------------------------------------------------------------

import type {
  AkiPageResponse,
  ApiResponse,
  Calendar,
  CalendarEvent,
  CreateEventInput,
  CreateTaskPayload,
  Label,
  MeetingBrief,
  Recording,
  Tag,
  Task,
  TimeSlot,
  UpdateTaskPayload,
} from "../types.ts";

export interface ListTasksParams {
  sync_token?: string;
  limit?: number;
}

export interface CreatedTaskFromActionItem {
  id: string | null;
  title: string | null;
}

export interface AkiflowHttpPort {
  getTasks(token: string, params?: ListTasksParams): Promise<ApiResponse<Task[]>>;
  patchTasks(token: string, tasks: Array<CreateTaskPayload | UpdateTaskPayload>): Promise<ApiResponse<Task[]>>;
  getLabels(token: string): Promise<ApiResponse<Label[]>>;
  getTags(token: string): Promise<ApiResponse<Tag[]>>;
  getTimeSlots(token: string, date: string): Promise<ApiResponse<TimeSlot[]>>;
  getEvents(token: string, date: string): Promise<ApiResponse<CalendarEvent[]>>;
  getCalendars(token: string): Promise<ApiResponse<Calendar[]>>;
  createEvent(token: string, input: CreateEventInput): Promise<ApiResponse<CalendarEvent[]>>;
  deleteEvent(token: string, calendarId: string, eventId: string): Promise<ApiResponse<CalendarEvent[]>>;
  getRecordings(token: string, cursor?: string): Promise<AkiPageResponse<Recording>>;
  getRecording(token: string, id: string): Promise<Recording>;
  getMeetingBriefs(token: string, cursor?: string): Promise<AkiPageResponse<MeetingBrief>>;
  getMeetingBrief(token: string, id: string): Promise<MeetingBrief>;
  createTaskFromActionItem(
    token: string,
    recordingId: string,
    actionItemId: string,
  ): Promise<CreatedTaskFromActionItem>;
}
