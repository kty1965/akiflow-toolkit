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
}

// Create payload — H1: client-side UUID required for PATCH UPSERT
export interface CreateTaskPayload {
  id: string; // crypto.randomUUID() — resolves issue H1
  title: string;
  date?: string;
  datetime?: string;
  duration?: number;
  listId?: string;
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
  done?: boolean;
  status?: TaskStatus;
  deleted_at?: string | null;
  recurrence?: string | null;
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
  provider: string;
}

// Time Slot
export interface TimeSlot {
  id: string;
  date: string;
  start: string;
  end: string;
  taskId: string;
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
