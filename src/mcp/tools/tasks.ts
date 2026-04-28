// ---------------------------------------------------------------------------
// MCP Task Tools — get_tasks, search_tasks, create_task, update_task, complete_task
// Outcome-first naming + isError boundary (ADR-0007, ADR-0008).
// Tool handlers are thin wrappers over TaskQueryService / TaskCommandService
// (ADR-0006 hexagonal, ADR-0010 CQRS). All errors convert to {isError:true};
// handlers never throw so the MCP client gets a structured failure response.
// ---------------------------------------------------------------------------

import { AkiflowError } from "@core/errors/index.ts";
import type { LoggerPort } from "@core/ports/logger-port.ts";
import type { CreateTaskInput, UpdateTaskInput } from "@core/services/task-command-service.ts";
import type { Task, TaskQueryOptions } from "@core/types.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface TaskToolsDeps {
  taskQuery: {
    listTasks(options?: TaskQueryOptions): Promise<Task[]>;
    getTaskById(id: string): Promise<Task | null>;
  };
  taskCommand: {
    createTask(input: CreateTaskInput): Promise<Task>;
    updateTask(id: string, patch: UpdateTaskInput): Promise<Task>;
    completeTask(id: string): Promise<Task>;
    deleteTask(id: string): Promise<Task>;
  };
  logger: LoggerPort;
}

type ToolTextResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function registerTaskTools(server: McpServer, deps: TaskToolsDeps): void {
  registerGetTasks(server, deps);
  registerGetTask(server, deps);
  registerSearchTasks(server, deps);
  registerCreateTask(server, deps);
  registerUpdateTask(server, deps);
  registerCompleteTask(server, deps);
  registerDeleteTask(server, deps);
}

// ---------------------------------------------------------------------------
// get_tasks — read
// ---------------------------------------------------------------------------

const GetTasksInputShape = {
  date: z
    .string()
    .regex(DATE_RE, "date must be YYYY-MM-DD")
    .optional()
    .describe("Specific date (YYYY-MM-DD) to show tasks for"),
  filter: z
    .enum(["today", "inbox", "done", "all"])
    .optional()
    .describe("Preset filter: today (scheduled today), inbox (no date), done (completed), all"),
  project: z.string().optional().describe("Project/list ID to restrict results to"),
  includeNotes: z
    .boolean()
    .optional()
    .describe("Include first 200 chars of each task's notes/description in output (default: false)"),
} as const;

function registerGetTasks(server: McpServer, deps: TaskToolsDeps): void {
  server.registerTool(
    "get_tasks",
    {
      description:
        "List Akiflow tasks with optional date/filter/project. Use when the user asks " +
        "'what's on my plate', 'show today's tasks', or 'what's in my inbox'. " +
        "Returns a markdown list summarising time, title, project, and completion state.\n\n" +
        "Examples:\n" +
        "- 'Show me today's tasks' → { filter: 'today' }\n" +
        "- 'List my inbox' → { filter: 'inbox' }\n" +
        "- '오늘 할 일 보여줘' → { filter: 'today' }",
      inputSchema: GetTasksInputShape,
      annotations: {
        title: "Get tasks",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (args): Promise<ToolTextResult> => {
      try {
        const options: TaskQueryOptions = {};
        if (args.date) options.date = args.date;
        if (args.filter) options.filter = args.filter;
        if (args.project) options.project = args.project;

        const tasks = await deps.taskQuery.listTasks(options);
        return textResult(formatTaskList(tasks, summariseFilter(args), { includeNotes: args.includeNotes ?? false }));
      } catch (err) {
        return toolError(err, deps, "get_tasks");
      }
    },
  );
}

// ---------------------------------------------------------------------------
// get_task — read (single task with full detail incl. description/notes)
// ---------------------------------------------------------------------------

const GetTaskInputShape = {
  id: z.string().min(1).describe("Task ID (UUID) to fetch"),
} as const;

function registerGetTask(server: McpServer, deps: TaskToolsDeps): void {
  server.registerTool(
    "get_task",
    {
      description:
        "Fetch a single Akiflow task by ID and return its full detail, including notes/description, " +
        "priority, labels, tags, and schedule. Use when the user asks to read a task's notes or " +
        "needs the body content beyond the title, e.g. 'show me the notes on task X' or " +
        "'이 태스크 내용 보여줘'.\n\n" +
        "Examples:\n" +
        "- 'Show task detail' → { id: '<uuid>' }\n" +
        "- 'Read the notes on this task' → { id: '<uuid>' }\n" +
        "- '이 태스크 본문 읽어줘' → { id: '<uuid>' }",
      inputSchema: GetTaskInputShape,
      annotations: {
        title: "Get task detail",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (args): Promise<ToolTextResult> => {
      try {
        const task = await deps.taskQuery.getTaskById(args.id);
        if (!task) {
          return textResult(`get_task: task not found — id=${args.id}`, true);
        }
        return textResult(formatTaskDetail(task));
      } catch (err) {
        return toolError(err, deps, "get_task");
      }
    },
  );
}

// ---------------------------------------------------------------------------
// search_tasks — read
// ---------------------------------------------------------------------------

const SearchTasksInputShape = {
  query: z.string().min(1).describe("Keyword to search across task titles"),
  project: z.string().optional().describe("Project/list ID to narrow search"),
  label: z.string().optional().describe("Label name or ID to narrow search"),
  includeNotes: z
    .boolean()
    .optional()
    .describe("Include first 200 chars of each task's notes/description in output (default: false)"),
} as const;

function registerSearchTasks(server: McpServer, deps: TaskToolsDeps): void {
  server.registerTool(
    "search_tasks",
    {
      description:
        "Search tasks by keyword with optional project and label filters. Use when the " +
        "user asks to find tasks by topic, such as 'search for PR review tasks' or " +
        "'find tasks labelled urgent'. Returns a markdown list of matches.\n\n" +
        "Examples:\n" +
        "- 'Find standup meetings' → { query: 'standup' }\n" +
        "- 'Search Work project for review' → { query: 'review', project: '<listId>' }\n" +
        "- 'urgent 라벨 붙은 할일' → { query: '', label: 'urgent' }",
      inputSchema: SearchTasksInputShape,
      annotations: {
        title: "Search tasks",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (args): Promise<ToolTextResult> => {
      try {
        const options: TaskQueryOptions = { search: args.query };
        if (args.project) options.project = args.project;

        let tasks = await deps.taskQuery.listTasks(options);
        if (args.label) {
          const needle = args.label.toLowerCase();
          tasks = tasks.filter((t) => t.labels.some((l) => l.toLowerCase() === needle));
        }

        const header = `## Search results for "${args.query}" — ${tasks.length} match(es)`;
        return textResult(formatTaskList(tasks, header, { includeNotes: args.includeNotes ?? false }));
      } catch (err) {
        return toolError(err, deps, "search_tasks");
      }
    },
  );
}

// ---------------------------------------------------------------------------
// create_task — write
// ---------------------------------------------------------------------------

const CreateTaskInputShape = {
  title: z.string().min(1).describe("Task title"),
  date: z
    .string()
    .regex(DATE_RE, "date must be YYYY-MM-DD")
    .optional()
    .describe("Scheduled date (YYYY-MM-DD). Required when `time` is set"),
  time: z
    .string()
    .regex(TIME_RE, "time must be HH:MM (24h)")
    .optional()
    .describe("Scheduled time of day (HH:MM, 24h). Requires `date`"),
  duration: z.number().int().positive().optional().describe("Duration in minutes (e.g. 30 for half an hour)"),
  project: z.string().optional().describe("Project/list ID the task belongs to"),
} as const;

function registerCreateTask(server: McpServer, deps: TaskToolsDeps): void {
  server.registerTool(
    "create_task",
    {
      description:
        "Create a new Akiflow task with optional schedule, duration, and project. Use when " +
        "the user asks to add or capture a new todo, such as 'add buy groceries' or " +
        "'create a task for 9am standup tomorrow'. Returns the created task summary.\n\n" +
        "Examples:\n" +
        "- 'Add buy groceries' → { title: 'buy groceries' }\n" +
        "- 'Schedule standup 2026-04-17 09:00 for 30 min' → { title: 'standup', date: '2026-04-17', time: '09:00', duration: 30 }\n" +
        "- '내일 오후 2시 PR 리뷰 잡아줘' → { title: 'PR 리뷰', date: '2026-04-18', time: '14:00' }",
      inputSchema: CreateTaskInputShape,
      annotations: {
        title: "Create task",
      },
    },
    async (args): Promise<ToolTextResult> => {
      try {
        if (args.time && !args.date) {
          return textResult("create_task: `time` requires a `date`.", true);
        }

        const input: {
          title: string;
          date?: string;
          datetime?: string;
          duration?: number;
          projectId?: string;
        } = { title: args.title };
        if (args.date) input.date = args.date;
        if (args.date && args.time) input.datetime = `${args.date}T${args.time}:00`;
        if (args.duration !== undefined) input.duration = args.duration * 60_000;
        if (args.project) input.projectId = args.project;

        const task = await deps.taskCommand.createTask(input);
        return textResult(formatSingleTask("Created", task));
      } catch (err) {
        return toolError(err, deps, "create_task");
      }
    },
  );
}

// ---------------------------------------------------------------------------
// update_task — write
// ---------------------------------------------------------------------------

const UpdateTaskInputShape = {
  id: z.string().min(1).describe("Task ID (UUID) to update"),
  title: z.string().min(1).optional().describe("New title"),
  date: z
    .string()
    .regex(DATE_RE, "date must be YYYY-MM-DD")
    .nullable()
    .optional()
    .describe("New scheduled date (YYYY-MM-DD) or null to clear"),
  time: z
    .string()
    .regex(TIME_RE, "time must be HH:MM (24h)")
    .nullable()
    .optional()
    .describe("New scheduled time (HH:MM) or null to clear"),
} as const;

function registerUpdateTask(server: McpServer, deps: TaskToolsDeps): void {
  server.registerTool(
    "update_task",
    {
      description:
        "Update fields on an existing Akiflow task (title/date/time). Use when the user " +
        "asks to rename or reschedule a specific task, such as 'rename task X to Y' or " +
        "'move this task to tomorrow'. Returns the updated task summary.\n\n" +
        "Examples:\n" +
        "- 'Rename task to Write draft' → { id: '<uuid>', title: 'Write draft' }\n" +
        "- 'Move task to 2026-04-20' → { id: '<uuid>', date: '2026-04-20' }\n" +
        "- '이 태스크 시간 비워줘' → { id: '<uuid>', time: null }",
      inputSchema: UpdateTaskInputShape,
      annotations: {
        title: "Update task",
        idempotentHint: true,
      },
    },
    async (args): Promise<ToolTextResult> => {
      try {
        const patch: {
          title?: string;
          date?: string | null;
          datetime?: string | null;
        } = {};
        if (args.title !== undefined) patch.title = args.title;
        if (args.date !== undefined) patch.date = args.date;
        if (args.time !== undefined) {
          if (args.time === null) {
            patch.datetime = null;
          } else {
            if (args.date === null) {
              return textResult("update_task: cannot set `time` while clearing `date`.", true);
            }
            const resolvedDate = args.date ?? (await resolveExistingDate(deps, args.id));
            if (!resolvedDate) {
              return textResult("update_task: task has no date — provide `date` alongside `time`.", true);
            }
            patch.datetime = `${resolvedDate}T${args.time}:00`;
          }
        }

        if (Object.keys(patch).length === 0) {
          return textResult("update_task: no fields to update.", true);
        }

        const task = await deps.taskCommand.updateTask(args.id, patch);
        return textResult(formatSingleTask("Updated", task));
      } catch (err) {
        return toolError(err, deps, "update_task");
      }
    },
  );
}

// ---------------------------------------------------------------------------
// complete_task — destructive write
// ---------------------------------------------------------------------------

const CompleteTaskInputShape = {
  id: z.string().min(1).describe("Task ID (UUID) to mark as done"),
} as const;

function registerCompleteTask(server: McpServer, deps: TaskToolsDeps): void {
  server.registerTool(
    "complete_task",
    {
      description:
        "Mark an Akiflow task as done. Use when the user reports a task is finished, e.g. " +
        "'mark task X done', 'complete this', or '이거 완료 처리해줘'. Returns the completed " +
        "task summary. Destructive: the task is no longer in active lists afterwards.\n\n" +
        "Examples:\n" +
        "- 'Mark task done' → { id: '<uuid>' }\n" +
        "- 'Complete the standup task' → { id: '<uuid>' }\n" +
        "- '완료 처리해줘' → { id: '<uuid>' }",
      inputSchema: CompleteTaskInputShape,
      annotations: {
        title: "Complete task",
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async (args): Promise<ToolTextResult> => {
      try {
        const task = await deps.taskCommand.completeTask(args.id);
        return textResult(formatSingleTask("Completed", task));
      } catch (err) {
        return toolError(err, deps, "complete_task");
      }
    },
  );
}

// ---------------------------------------------------------------------------
// delete_task — destructive write (soft-delete via deleted_at)
// ---------------------------------------------------------------------------

const DeleteTaskInputShape = {
  id: z.string().min(1).describe("Task ID (UUID) to delete"),
} as const;

function registerDeleteTask(server: McpServer, deps: TaskToolsDeps): void {
  server.registerTool(
    "delete_task",
    {
      description:
        "Soft-delete an Akiflow task (sets deleted_at). Use when the user asks to remove or " +
        "drop a task permanently, e.g. 'delete task X', 'remove this', or '이 태스크 삭제해줘'. " +
        "Returns the deleted task summary. Destructive: the task disappears from active lists.\n\n" +
        "Examples:\n" +
        "- 'Delete task' → { id: '<uuid>' }\n" +
        "- 'Remove the standup task' → { id: '<uuid>' }\n" +
        "- '삭제해줘' → { id: '<uuid>' }",
      inputSchema: DeleteTaskInputShape,
      annotations: {
        title: "Delete task",
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async (args): Promise<ToolTextResult> => {
      try {
        const task = await deps.taskCommand.deleteTask(args.id);
        return textResult(formatSingleTask("Deleted", task));
      } catch (err) {
        return toolError(err, deps, "delete_task");
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function resolveExistingDate(deps: TaskToolsDeps, id: string): Promise<string | null> {
  const existing = await deps.taskQuery.getTaskById(id);
  return existing?.date ?? null;
}

function textResult(text: string, isError = false): ToolTextResult {
  const result: ToolTextResult = { content: [{ type: "text", text }] };
  if (isError) result.isError = true;
  return result;
}

export function toolError(err: unknown, deps: { logger: LoggerPort }, label: string): ToolTextResult {
  if (err instanceof AkiflowError) {
    deps.logger.debug(`${label} failed`, { code: err.code, message: err.message });
    const hintLine = err.hint ? `\n${err.hint}` : "";
    return textResult(`${err.userMessage}${hintLine}`, true);
  }
  const message = err instanceof Error ? err.message : String(err);
  deps.logger.error(`${label} unexpected error`, { message });
  return textResult(`${label}: unexpected error — ${message}`, true);
}

export function summariseFilter(args: { date?: string; filter?: string; project?: string }): string {
  const parts: string[] = [];
  if (args.filter) parts.push(`filter=${args.filter}`);
  if (args.date) parts.push(`date=${args.date}`);
  if (args.project) parts.push(`project=${args.project}`);
  const suffix = parts.length ? ` (${parts.join(", ")})` : "";
  return `## Tasks${suffix}`;
}

export function formatTaskList(tasks: Task[], header: string, options: { includeNotes?: boolean } = {}): string {
  if (tasks.length === 0) {
    return `${header} — 0\n\n(no matching tasks)`;
  }
  const lines = tasks.map((t, i) => {
    const head = `${i + 1}. ${formatTaskLine(t)}`;
    if (options.includeNotes) {
      const preview = formatNotesPreview(t.description);
      if (preview) return `${head}\n   notes: ${preview}`;
    }
    return head;
  });
  return `${header} — ${tasks.length}\n\n${lines.join("\n")}`;
}

export function formatSingleTask(verb: string, task: Task): string {
  return `${verb}: ${formatTaskLine(task)}`;
}

const NOTES_PREVIEW_LIMIT = 200;

function formatNotesPreview(description: string | null): string | null {
  if (!description) return null;
  const normalised = description.replace(/\s+/g, " ").trim();
  if (!normalised) return null;
  if (normalised.length <= NOTES_PREVIEW_LIMIT) return normalised;
  return `${normalised.slice(0, NOTES_PREVIEW_LIMIT)}…`;
}

export function formatTaskDetail(task: Task): string {
  const title = task.title ?? "(untitled)";
  const lines: string[] = [`## Task: ${title}`];
  lines.push(`- id: ${task.id}`);
  lines.push(`- when: ${formatWhen(task).trim() || "(inbox)"}`);
  if (task.duration) {
    const minutes = Math.round(task.duration / 60_000);
    if (minutes > 0) lines.push(`- duration: ${minutes}m`);
  }
  if (task.listId) lines.push(`- project: ${task.listId}`);
  if (task.priority !== null && task.priority !== undefined) lines.push(`- priority: ${task.priority}`);
  if (Array.isArray(task.labels) && task.labels.length > 0) lines.push(`- labels: ${task.labels.join(", ")}`);
  if (Array.isArray(task.tags) && task.tags.length > 0) lines.push(`- tags: ${task.tags.join(", ")}`);
  if (task.recurrence) lines.push(`- recurrence: ${task.recurrence}`);
  lines.push(`- done: ${task.done ? "✓" : "✗"}`);
  lines.push("");
  lines.push("### Notes");
  lines.push(task.description ? task.description : "(no notes)");
  return lines.join("\n");
}

function formatTaskLine(task: Task): string {
  const title = task.title ?? "(untitled)";
  const when = formatWhen(task);
  const project = task.listId ? ` [project: ${task.listId}]` : "";
  const done = task.done ? " ✓" : "";
  const idTag = ` {id: ${task.id}}`;
  return `${when}${title}${project}${done}${idTag}`;
}

function formatWhen(task: Task): string {
  if (task.datetime) {
    const [, time = ""] = task.datetime.split("T");
    const hhmm = time.slice(0, 5);
    if (task.duration) {
      const end = addMinutes(task.datetime, Math.round(task.duration / 60_000));
      return `[${hhmm}-${end}] `;
    }
    return `[${hhmm}] `;
  }
  if (task.date) return `[${task.date}] `;
  return "(inbox) ";
}

function addMinutes(isoDatetime: string, minutes: number): string {
  const d = new Date(isoDatetime);
  if (Number.isNaN(d.getTime())) return "??:??";
  d.setMinutes(d.getMinutes() + minutes);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
