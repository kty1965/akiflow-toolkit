// ---------------------------------------------------------------------------
// MCP Calendar Tools — ADR-0007 (Outcome-first), ADR-0008 (isError boundary)
// Read-only tools that wrap TaskQueryService for calendar event retrieval.
// ---------------------------------------------------------------------------

import type { TaskCommandService } from "@core/services/task-command-service.ts";
import type { TaskQueryService } from "@core/services/task-query-service.ts";
import type { Calendar, CalendarEvent } from "@core/types.ts";
import { computeFreeSlotsByDate, type FreeSlot } from "@core/utils/free-slots.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface CalendarToolsDeps {
  taskQuery: Pick<TaskQueryService, "getEvents" | "getCalendars">;
  taskCommand: Pick<TaskCommandService, "createEvent">;
}

export const GET_EVENTS_TOOL_NAME = "get_events";
export const GET_FREE_SLOTS_TOOL_NAME = "get_free_slots";
export const GET_CALENDARS_TOOL_NAME = "get_calendars";
export const CREATE_EVENT_TOOL_NAME = "create_event";

export const DEFAULT_WORK_START = "09:00";
export const DEFAULT_WORK_END = "18:00";

export const GET_EVENTS_DESCRIPTION =
  "Akiflow 캘린더의 이벤트를 조회합니다. " +
  "오늘/특정 날짜/N일 구간의 일정(회의, 약속)을 가져옵니다. " +
  "날짜 미지정 시 오늘 기준, days 미지정 시 1일만 조회합니다. " +
  "결과는 날짜별로 정렬된 이벤트 목록 (제목, 시작, 종료, 캘린더ID). " +
  "예: '오늘 일정 보여줘', '다음 주 회의 확인', '4월 20일부터 3일간 일정'";

export const GET_FREE_SLOTS_DESCRIPTION =
  "지정한 기간 동안 캘린더 이벤트가 비어있는 시간대(free slot)를 계산합니다. " +
  "회의/약속 사이의 빈 시간을 찾아 태스크 배치나 집중 시간 확보에 활용합니다. " +
  "날짜 미지정 시 오늘 기준, days 미지정 시 1일만 조회, 업무 시간 미지정 시 09:00-18:00. " +
  "결과는 날짜별 빈 슬롯 목록 (HH:MM-HH:MM). " +
  "예: '오늘 빈 시간 알려줘', '내일 11시~6시 사이 비는 시간', '이번 주 집중 작업 시간 찾아줘'";

export const GET_CALENDARS_DESCRIPTION =
  "연결된 캘린더 목록을 조회합니다 (Google Calendar 등). " +
  "이벤트를 생성하기 전에 어느 캘린더에 넣을지 calendar_id를 확인할 때 사용합니다. " +
  "결과는 캘린더 목록 (id, name, provider, read_only 여부). " +
  "예: '캘린더 목록 보여줘', '어떤 캘린더에 일정 넣을 수 있어?'";

export const CREATE_EVENT_DESCRIPTION =
  "Akiflow 캘린더에 새 이벤트(일정/회의)를 생성합니다. 연결된 캘린더(Google 등)에 동기화됩니다. " +
  "calendar_id는 get_calendars로 미리 확인해야 하며, read-only 캘린더는 지정할 수 없습니다. " +
  "결과는 생성된 이벤트 요약 (id, title, 시간). " +
  "예: '내일 오후 2시에 팀 미팅 잡아줘', '금요일 종일 휴가 일정 추가해줘'";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]?\d|2[0-3]):([0-5]\d)$/;
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

export function formatFreeSlotsForLLM(byDate: Record<string, FreeSlot[]>, workStart: string, workEnd: string): string {
  const dates = Object.keys(byDate).sort();
  if (dates.length === 0) {
    return `## 빈 시간 — ${workStart}-${workEnd}\n조회할 날짜가 없습니다.`;
  }
  const sections: string[] = [];
  let totalSlots = 0;
  for (const date of dates) {
    const slots = byDate[date];
    totalSlots += slots.length;
    sections.push(`## ${date} — 빈 시간 (${workStart}-${workEnd})`);
    if (slots.length === 0) {
      sections.push("  빈 시간이 없습니다.");
      continue;
    }
    for (const slot of slots) {
      sections.push(`  ${slot.start}-${slot.end}`);
    }
  }
  const header = `빈 시간 — ${dates.length}일 — 총 ${totalSlots}개 슬롯`;
  return `## ${header}\n${sections.join("\n")}`;
}

export function formatCalendarsForLLM(calendars: Calendar[]): string {
  if (calendars.length === 0) {
    return "## 캘린더\n연결된 캘린더가 없습니다.";
  }
  const lines = calendars.map((c, i) => {
    const readOnly = c.readOnly ? " (읽기 전용)" : "";
    return `${i + 1}. ${c.name} [${c.provider}]${readOnly} {id: ${c.id}}`;
  });
  return `## 캘린더 — ${calendars.length}건\n${lines.join("\n")}`;
}

export function formatCreatedEventForLLM(event: CalendarEvent): string {
  return `Created: ${event.title} (${event.start} → ${event.end}) {id: ${event.id}}`;
}

export function registerCalendarTools(server: McpServer, components: CalendarToolsDeps): void {
  registerGetEvents(server, components);
  registerGetFreeSlots(server, components);
  registerGetCalendars(server, components);
  registerCreateEvent(server, components);
}

function registerGetEvents(server: McpServer, components: CalendarToolsDeps): void {
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

function registerGetFreeSlots(server: McpServer, components: CalendarToolsDeps): void {
  server.registerTool(
    GET_FREE_SLOTS_TOOL_NAME,
    {
      description: GET_FREE_SLOTS_DESCRIPTION,
      inputSchema: {
        date: z
          .string()
          .regex(DATE_REGEX, "YYYY-MM-DD format required")
          .optional()
          .describe("조회 시작 날짜 (YYYY-MM-DD). 미지정 시 오늘"),
        days: z.number().int().min(1).max(MAX_DAYS).optional().describe(`조회할 일수 (1~${MAX_DAYS}). 미지정 시 1`),
        work_start: z
          .string()
          .regex(TIME_REGEX, "HH:MM (24h) format required")
          .optional()
          .describe(`업무 시작 시각 (HH:MM). 미지정 시 ${DEFAULT_WORK_START}`),
        work_end: z
          .string()
          .regex(TIME_REGEX, "HH:MM (24h) format required")
          .optional()
          .describe(`업무 종료 시각 (HH:MM). 미지정 시 ${DEFAULT_WORK_END}`),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const workStart = args.work_start ?? DEFAULT_WORK_START;
      const workEnd = args.work_end ?? DEFAULT_WORK_END;
      if (toMinutes(workEnd) <= toMinutes(workStart)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `빈 시간 계산 실패: work_end(${workEnd})는 work_start(${workStart})보다 뒤여야 합니다.`,
            },
          ],
          isError: true,
        };
      }

      try {
        const start = args.date ?? todayIso();
        const days = args.days ?? 1;
        const byDate: Record<string, CalendarEvent[]> = {};
        for (let i = 0; i < days; i++) {
          const date = i === 0 ? start : addDaysIso(start, i);
          byDate[date] = await components.taskQuery.getEvents(date);
        }
        const freeByDate = computeFreeSlotsByDate(byDate, workStart, workEnd);
        return {
          content: [{ type: "text" as const, text: formatFreeSlotsForLLM(freeByDate, workStart, workEnd) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `빈 시간 조회 실패: ${message}. 'af auth' 명령으로 재인증 후 다시 시도하세요.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

function registerGetCalendars(server: McpServer, components: CalendarToolsDeps): void {
  server.registerTool(
    GET_CALENDARS_TOOL_NAME,
    {
      description: GET_CALENDARS_DESCRIPTION,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const calendars = await components.taskQuery.getCalendars();
        return {
          content: [{ type: "text" as const, text: formatCalendarsForLLM(calendars) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `캘린더 조회 실패: ${message}. 'af auth' 명령으로 재인증 후 다시 시도하세요.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

function registerCreateEvent(server: McpServer, components: CalendarToolsDeps): void {
  server.registerTool(
    CREATE_EVENT_TOOL_NAME,
    {
      description: CREATE_EVENT_DESCRIPTION,
      inputSchema: {
        calendar_id: z.string().min(1).describe("이벤트를 생성할 캘린더 ID (get_calendars로 확인, read-only 불가)"),
        title: z.string().min(1).describe("이벤트 제목"),
        start_datetime: z.string().min(1).describe("시작 일시 (ISO 8601, 예: 2026-04-20T14:00:00+09:00)"),
        end_datetime: z.string().min(1).describe("종료 일시 (ISO 8601)"),
        description: z.string().optional().describe("이벤트 설명"),
        location: z.string().optional().describe("장소"),
        all_day: z.boolean().optional().describe("종일 이벤트 여부 (기본값: false)"),
      },
      annotations: { openWorldHint: true },
    },
    async (args) => {
      try {
        const event = await components.taskCommand.createEvent({
          calendarId: args.calendar_id,
          title: args.title,
          startDatetime: args.start_datetime,
          endDatetime: args.end_datetime,
          description: args.description,
          location: args.location,
          allDay: args.all_day,
        });
        return {
          content: [{ type: "text" as const, text: formatCreatedEventForLLM(event) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `이벤트 생성 실패: ${message}. calendar_id는 get_calendars로 확인하세요.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((v) => Number(v));
  return h * 60 + m;
}
