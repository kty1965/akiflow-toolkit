// ---------------------------------------------------------------------------
// MCP Schedule Tools — schedule_task, unschedule_task
// Outcome-first naming + isError boundary (ADR-0007, ADR-0008).
// Thin wrappers over TaskCommandService (ADR-0006, ADR-0010).
// ---------------------------------------------------------------------------

import type { LoggerPort } from "@core/ports/logger-port.ts";
import type { Task } from "@core/types.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatSingleTask, toolError } from "./tasks.ts";

export interface ScheduleToolsDeps {
  taskCommand: {
    scheduleTask(id: string, date: string, time?: string): Promise<Task>;
    unscheduleTask(id: string): Promise<Task>;
  };
  logger: LoggerPort;
}

type ToolTextResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function registerScheduleTools(server: McpServer, deps: ScheduleToolsDeps): void {
  registerScheduleTask(server, deps);
  registerUnscheduleTask(server, deps);
}

// ---------------------------------------------------------------------------
// schedule_task — move task onto a date (and optional time)
// ---------------------------------------------------------------------------

const ScheduleTaskInputShape = {
  id: z.string().min(1).describe("Task ID (UUID) to schedule"),
  date: z.string().regex(DATE_RE, "date must be YYYY-MM-DD").describe("Target date (YYYY-MM-DD)"),
  time: z.string().regex(TIME_RE, "time must be HH:MM (24h)").optional().describe("Optional time of day (HH:MM, 24h)"),
} as const;

function registerScheduleTask(server: McpServer, deps: ScheduleToolsDeps): void {
  server.registerTool(
    "schedule_task",
    {
      description:
        "Place a task on a specific date, optionally at a time. Use when the user asks to " +
        "'schedule this for Friday', 'move to 2026-04-20 at 9am', or similar scheduling " +
        "requests. Returns the updated task summary with its new schedule.\n\n" +
        "Examples:\n" +
        "- 'Schedule task for 2026-04-20' → { id: '<uuid>', date: '2026-04-20' }\n" +
        "- 'Schedule it 2026-04-20 09:00' → { id: '<uuid>', date: '2026-04-20', time: '09:00' }\n" +
        "- '내일 오후 3시로 옮겨줘' → { id: '<uuid>', date: '2026-04-17', time: '15:00' }",
      inputSchema: ScheduleTaskInputShape,
      annotations: {
        title: "Schedule task",
        idempotentHint: true,
      },
    },
    async (args): Promise<ToolTextResult> => {
      try {
        const task = await deps.taskCommand.scheduleTask(args.id, args.date, args.time);
        return {
          content: [{ type: "text", text: formatSingleTask("Scheduled", task) }],
        };
      } catch (err) {
        return toolError(err, deps, "schedule_task");
      }
    },
  );
}

// ---------------------------------------------------------------------------
// unschedule_task — return task to inbox (clear date/datetime)
// ---------------------------------------------------------------------------

const UnscheduleTaskInputShape = {
  id: z.string().min(1).describe("Task ID (UUID) to send back to inbox"),
} as const;

function registerUnscheduleTask(server: McpServer, deps: ScheduleToolsDeps): void {
  server.registerTool(
    "unschedule_task",
    {
      description:
        "Remove a task's date/time so it returns to the inbox. Use when the user asks to " +
        "'move this back to inbox', 'unschedule this', or '일정 취소해줘'. Returns the task " +
        "summary with its schedule cleared.\n\n" +
        "Examples:\n" +
        "- 'Unschedule this task' → { id: '<uuid>' }\n" +
        "- 'Move back to inbox' → { id: '<uuid>' }\n" +
        "- '인박스로 돌려줘' → { id: '<uuid>' }",
      inputSchema: UnscheduleTaskInputShape,
      annotations: {
        title: "Unschedule task",
        idempotentHint: true,
      },
    },
    async (args): Promise<ToolTextResult> => {
      try {
        const task = await deps.taskCommand.unscheduleTask(args.id);
        return {
          content: [{ type: "text", text: formatSingleTask("Unscheduled", task) }],
        };
      } catch (err) {
        return toolError(err, deps, "unschedule_task");
      }
    },
  );
}
