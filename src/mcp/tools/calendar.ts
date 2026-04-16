// ---------------------------------------------------------------------------
// MCP Calendar Tools — ADR-0007 (Outcome-first), ADR-0008 (isError boundary)
// Read-only tools that wrap TaskQueryService for calendar event retrieval.
// ---------------------------------------------------------------------------

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TaskQueryService } from "../../core/services/task-query-service.ts";
import type { CalendarEvent } from "../../core/types.ts";

export interface CalendarToolsDeps {
  taskQuery: Pick<TaskQueryService, "getEvents">;
}

export const GET_EVENTS_TOOL_NAME = "get_events";

export const GET_EVENTS_DESCRIPTION =
  "Akiflow 캘린더의 이벤트를 조회합니다. " +
  "오늘/특정 날짜/N일 구간의 일정(회의, 약속)을 가져옵니다. " +
  "날짜 미지정 시 오늘 기준, days 미지정 시 1일만 조회합니다. " +
  "결과는 날짜별로 정렬된 이벤트 목록 (제목, 시작, 종료, 캘린더ID). " +
  "예: '오늘 일정 보여줘', '다음 주 회의 확인', '4월 20일부터 3일간 일정'";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 14;

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatEventsForLLM(events: CalendarEvent[], range: string): string {
  if (events.length === 0) {
    return `## 이벤트 — ${range}\n일정이 없습니다.`;
  }
  const lines = events
    .slice()
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((ev, i) => `${i + 1}. ${ev.title} (${ev.start} → ${ev.end}) [cal:${ev.calendarId}]`);
  return `## 이벤트 — ${range} — ${events.length}건\n${lines.join("\n")}`;
}

export function registerCalendarTools(server: McpServer, components: CalendarToolsDeps): void {
  server.registerTool(
    GET_EVENTS_TOOL_NAME,
    {
      description: GET_EVENTS_DESCRIPTION,
      inputSchema: {
        date: z
          .string()
          .regex(DATE_REGEX, "YYYY-MM-DD format required")
          .optional()
          .describe("조회 시작 날짜 (YYYY-MM-DD). 미지정 시 오늘"),
        days: z.number().int().min(1).max(MAX_DAYS).optional().describe(`조회할 일수 (1~${MAX_DAYS}). 미지정 시 1`),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const start = args.date ?? todayIso();
        const days = args.days ?? 1;
        const collected: CalendarEvent[] = [];
        for (let i = 0; i < days; i++) {
          const date = i === 0 ? start : addDaysIso(start, i);
          const events = await components.taskQuery.getEvents(date);
          collected.push(...events);
        }
        const range = days === 1 ? start : `${start} ~ ${addDaysIso(start, days - 1)}`;
        return {
          content: [{ type: "text" as const, text: formatEventsForLLM(collected, range) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `이벤트 조회 실패: ${message}. 'af auth' 명령으로 재인증 후 다시 시도하세요.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
