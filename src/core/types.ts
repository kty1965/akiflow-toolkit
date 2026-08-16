// ---------------------------------------------------------------------------
// Domain Types — shared across CLI & MCP
// core/ has ZERO external dependency imports (ADR-0006)
// ---------------------------------------------------------------------------

// API response wrapper
export interface ApiResponse<T> {
  success: boolean;
  message: string | null;
  data: T;
  sync_token?: string;
  has_next_page?: boolean;
}

// Task status: 0=active, 1=done, 2=time-blocked
export type TaskStatus = 0 | 1 | 2 | null;

// Task (45+ fields — core fields explicit, rest extensible)
export interface Task {
  id: string; // UUID (client-generated)
  title: string | null;
  date: string | null; // YYYY-MM-DD
  datetime: string | null; // ISO8601
  duration: number | null; // milliseconds
  done: boolean;
  listId: string | null; // Label ID
  status: TaskStatus;
  recurrence: string | null; // RRULE
  deleted_at: string | null;
  global_created_at: string;
  global_updated_at: string;
  description: string | null;
  priority: number | null;
  tags: string[];
  labels: string[];
  shared: boolean;
  source: string | null;
  parent_id: string | null;
  position: number | null;
  due_date: string | null; // YYYY-MM-DD — deadline, distinct from `date` (scheduled day)
}

// Create payload — H1: client-side UUID required for PATCH UPSERT
export interface CreateTaskPayload {
  id: string; // crypto.randomUUID() — resolves issue H1
  title: string;
  date?: string;
  datetime?: string;
  duration?: number;
  listId?: string;
  due_date?: string;
  global_created_at: string;
  global_updated_at: string;
}

// Update payload
export interface UpdateTaskPayload {
  id: string;
  global_updated_at: string;
  title?: string;
  date?: string | null;
  datetime?: string | null;
  duration?: number | null;
  listId?: string | null;
  done?: boolean;
  status?: TaskStatus;
  deleted_at?: string | null;
  recurrence?: string | null;
  description?: string | null;
  priority?: number | null;
  parent_id?: string | null;
  position?: number | null;
  shared?: boolean;
  tags_ids?: string[];
  due_date?: string | null;
}

// Label
export interface Label {
  id: string;
  name: string;
  color: string | null;
}

// Tag
export interface Tag {
  id: string;
  name: string;
}

// Calendar Event
export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  calendarId: string;
}

// Calendar
export interface Calendar {
  id: string;
  name: string;
  provider: string; // connector_id, e.g. "google"
  timezone: string | null;
  color: string | null;
  originId: string | null;
  akiflowAccountId: string | null;
  originAccountId: string | null;
  readOnly: boolean;
}

// Create event input (service + port level — adapter resolves calendar
// identity and constructs the full Akiflow v3 write envelope internally)
export interface CreateEventInput {
  calendarId: string;
  title: string;
  startDatetime: string; // ISO 8601
  endDatetime: string; // ISO 8601
  description?: string | null;
  location?: string | null;
  allDay?: boolean;
}

// Update event input — partial: only fields present are changed server-side
// (live-probed: POST /v3/events with just the identity envelope + changed
// fields preserves everything else, unlike createEvent's full envelope)
export interface UpdateEventInput {
  calendarId: string;
  eventId: string;
  title?: string;
  startDatetime?: string; // ISO 8601
  endDatetime?: string; // ISO 8601
  description?: string | null;
  location?: string | null;
}

// Meeting Assistant (Akiflow paid add-on) — aki.akiflow.com/api/v1
export interface ActionItem {
  id: string;
  title: string;
  dueDate: string | null;
}

export interface TranscriptEntry {
  speakerName: string;
  paragraph: string;
  startTimeSec: number;
}

export interface Recording {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  summary: string | null;
  actionItems: ActionItem[];
  transcript: TranscriptEntry[];
}

export interface MeetingBrief {
  id: string;
  originEventId: string | null;
  createdAt: string | null;
  data: Record<string, unknown> | null;
}

// Cursor-paginated response wrapper for aki.akiflow.com endpoints
// (distinct from ApiResponse<T>'s sync_token pagination used by api.akiflow.com)
export interface AkiPageResponse<T> {
  data: T[];
  nextCursor: string | null;
}

// Time Slot — Akiflow's routine/block scheduling entity, distinct from both
// Task and CalendarEvent. Live-probed GET /v5/time_slots: no `date`/`task_id`
// field on the entity itself (a Task can reference one via its own
// `time_slot_id`, but that's a one-way pointer, not present here).
export interface TimeSlot {
  id: string;
  calendarId: string | null;
  title: string | null;
  description: string | null;
  start: string; // ISO8601
  end: string; // ISO8601
  status: string | null;
  recurrence: string | null;
}

// Create time slot input — writes go through the same simple PATCH-upsert
// pattern as tasks (live-probed: PATCH /v5/time_slots, not the complex v3
// calendar-event envelope), so no calendar-identity resolution needed.
export interface CreateTimeSlotInput {
  calendarId: string;
  title: string;
  startDatetime: string; // ISO 8601
  endDatetime: string; // ISO 8601
  description?: string | null;
}

// Update time slot input — true partial update (live-probed: omitted
// fields are left unchanged server-side, same as tasks).
export interface UpdateTimeSlotInput {
  timeSlotId: string;
  title?: string;
  startDatetime?: string; // ISO 8601
  endDatetime?: string; // ISO 8601
  description?: string | null;
}

// Credentials
export interface Credentials {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  expiresAt: number; // Unix ms
  savedAt: string; // ISO8601
  source: "indexeddb" | "cookie" | "cdp" | "manual";
}

// Auth status
export interface AuthStatus {
  isAuthenticated: boolean;
  expiresAt: number | null;
  source: Credentials["source"] | null;
  isExpired: boolean;
}

// Token refresh response
export interface TokenRefreshResponse {
  token_type: string;
  expires_in: number;
  access_token: string;
  refresh_token: string;
}

// Query options for task listing
export interface TaskQueryOptions {
  date?: string;
  filter?: "today" | "inbox" | "done" | "all";
  project?: string;
  search?: string;
  limit?: number;
}

// Extracted token from browser (before conversion to Credentials)
export interface ExtractedToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // Unix seconds (from JWT exp)
  browser: string; // "Chrome", "Arc", "Brave", "Edge"
}

// Sync result
export interface SyncResult {
  tasks: Task[];
  syncToken: string;
  hasNextPage: boolean;
}
