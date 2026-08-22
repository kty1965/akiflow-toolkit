// ---------------------------------------------------------------------------
// MCP Time Slot Tools — ADR-0007 (Outcome-first), ADR-0008 (isError boundary)
// Time slots are Akiflow's routine/block scheduling entity — distinct from
// both Task and CalendarEvent. Unlike calendar events, writes go through the
// same simple PATCH-upsert pattern as tasks (no calendar-identity envelope).
// ---------------------------------------------------------------------------

import type { TaskCommandService } from "@core/services/task-command-service.ts";
import type { TaskQueryService } from "@core/services/task-query-service.ts";
import type { TimeSlot } from "@core/types.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface TimeSlotToolsDeps {
  taskQuery: Pick<TaskQueryService, "getTimeSlots">;
  taskCommand: Pick<TaskCommandService, "createTimeSlot" | "updateTimeSlot" | "deleteTimeSlot">;
}

export const GET_TIME_SLOTS_TOOL_NAME = "get_time_slots";
export const CREATE_TIME_SLOT_TOOL_NAME = "create_time_slot";
export const UPDATE_TIME_SLOT_TOOL_NAME = "update_time_slot";
export const DELETE_TIME_SLOT_TOOL_NAME = "delete_time_slot";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const GET_TIME_SLOTS_DESCRIPTION =
  "Akiflow 타임 슬롯(루틴/블록 일정)을 조회합니다. get_events(캘린더 이벤트)와는 별개 엔티티입니다. " +
  "날짜 미지정 시 오늘 기준. 결과는 타임 슬롯 목록 (제목, 시작, 종료, 캘린더ID). " +
  "예: '오늘 루틴 블록 보여줘', '이번주 타임슬롯 확인'";

export const CREATE_TIME_SLOT_DESCRIPTION =
  "Akiflow에 새 타임 슬롯(루틴/집중 시간 블록)을 생성합니다. " +
  "calendar_id는 get_calendars로 확인하세요. " +
  "결과는 생성된 타임 슬롯 요약 (id, title, 시간). " +
  "예: '내일 오전에 집중 시간 블록 잡아줘', '매일 아침 루틴 슬롯 추가'";

export const UPDATE_TIME_SLOT_DESCRIPTION =
  "Akiflow 타임 슬롯의 필드(제목/시간/설명)를 수정합니다. 부분 수정만 지원 — 지정하지 않은 필드는 그대로 유지됩니다. " +
  "time_slot_id는 get_time_slots로 확인하세요. " +
  "결과는 수정된 타임 슬롯 요약. " +
  "예: '그 집중 시간 블록을 1시간 뒤로 옮겨줘'";

export const DELETE_TIME_SLOT_DESCRIPTION =
  "Akiflow 타임 슬롯을 삭제합니다. time_slot_id는 get_time_slots로 확인하세요. " +
  "결과는 삭제된 타임 슬롯 요약. " +
  "예: '이 타임 슬롯 삭제해줘'";

export function formatTimeSlotsForLLM(slots: TimeSlot[], range: string): string {
  if (slots.length === 0) {
    return `## 타임 슬롯 — ${range}\n타임 슬롯이 없습니다.`;
  }
  const lines = slots.map((s, i) => {
    const title = s.title ?? "(no title)";
    const cal = s.calendarId ? ` [cal:${s.calendarId}]` : "";
    return `${i + 1}. ${title} (${s.start} → ${s.end})${cal} {id: ${s.id}}`;
  });
  return `## 타임 슬롯 — ${range} — ${slots.length}건\n${lines.join("\n")}`;
}

export function formatCreatedTimeSlotForLLM(slot: TimeSlot): string {
  return `Created: ${slot.title ?? "(no title)"} (${slot.start} → ${slot.end}) {id: ${slot.id}}`;
}

export function formatUpdatedTimeSlotForLLM(slot: TimeSlot): string {
  return `Updated: ${slot.title ?? "(no title)"} (${slot.start} → ${slot.end}) {id: ${slot.id}}`;
}

export function formatDeletedTimeSlotForLLM(slot: TimeSlot): string {
  return `Deleted: ${slot.title ?? "(no title)"} (${slot.start} → ${slot.end}) {id: ${slot.id}}`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function registerTimeSlotTools(server: McpServer, components: TimeSlotToolsDeps): void {
  registerGetTimeSlots(server, components);
  registerCreateTimeSlot(server, components);
  registerUpdateTimeSlot(server, components);
  registerDeleteTimeSlot(server, components);
}

function registerGetTimeSlots(server: McpServer, components: TimeSlotToolsDeps): void {
  server.registerTool(
    GET_TIME_SLOTS_TOOL_NAME,
    {
      description: GET_TIME_SLOTS_DESCRIPTION,
      inputSchema: {
        date: z
          .string()
          .regex(DATE_REGEX, "YYYY-MM-DD format required")
          .optional()
          .describe("조회할 날짜 (YYYY-MM-DD). 미지정 시 오늘"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const date = args.date ?? todayIso();
        const slots = await components.taskQuery.getTimeSlots(date);
        return {
          content: [{ type: "text" as const, text: formatTimeSlotsForLLM(slots, date) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `타임 슬롯 조회 실패: ${message}. 'af auth' 명령으로 재인증 후 다시 시도하세요.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

function registerCreateTimeSlot(server: McpServer, components: TimeSlotToolsDeps): void {
  server.registerTool(
    CREATE_TIME_SLOT_TOOL_NAME,
    {
      description: CREATE_TIME_SLOT_DESCRIPTION,
      inputSchema: {
        calendar_id: z.string().min(1).describe("타임 슬롯을 생성할 캘린더 ID (get_calendars로 확인)"),
        title: z.string().min(1).describe("타임 슬롯 제목"),
        start_datetime: z.string().min(1).describe("시작 일시 (ISO 8601, 예: 2026-04-20T09:00:00+09:00)"),
        end_datetime: z.string().min(1).describe("종료 일시 (ISO 8601)"),
        description: z.string().optional().describe("설명"),
      },
      annotations: { openWorldHint: true },
    },
    async (args) => {
      try {
        const slot = await components.taskCommand.createTimeSlot({
          calendarId: args.calendar_id,
          title: args.title,
          startDatetime: args.start_datetime,
          endDatetime: args.end_datetime,
          description: args.description,
        });
        return {
          content: [{ type: "text" as const, text: formatCreatedTimeSlotForLLM(slot) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `타임 슬롯 생성 실패: ${message}. calendar_id는 get_calendars로 확인하세요.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

function registerUpdateTimeSlot(server: McpServer, components: TimeSlotToolsDeps): void {
  server.registerTool(
    UPDATE_TIME_SLOT_TOOL_NAME,
    {
      description: UPDATE_TIME_SLOT_DESCRIPTION,
      inputSchema: {
        time_slot_id: z.string().min(1).describe("수정할 타임 슬롯 ID (get_time_slots로 확인)"),
        title: z.string().min(1).optional().describe("새 제목"),
        start_datetime: z.string().min(1).optional().describe("새 시작 일시 (ISO 8601)"),
        end_datetime: z.string().min(1).optional().describe("새 종료 일시 (ISO 8601)"),
        description: z.string().optional().describe("새 설명"),
      },
      annotations: { idempotentHint: true },
    },
    async (args) => {
      try {
        if (
          args.title === undefined &&
          args.start_datetime === undefined &&
          args.end_datetime === undefined &&
          args.description === undefined
        ) {
          return {
            content: [{ type: "text" as const, text: "update_time_slot: no fields to update." }],
            isError: true,
          };
        }
        const slot = await components.taskCommand.updateTimeSlot({
          timeSlotId: args.time_slot_id,
          title: args.title,
          startDatetime: args.start_datetime,
          endDatetime: args.end_datetime,
          description: args.description,
        });
        return {
          content: [{ type: "text" as const, text: formatUpdatedTimeSlotForLLM(slot) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `타임 슬롯 수정 실패: ${message}. time_slot_id는 get_time_slots로 확인하세요.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

function registerDeleteTimeSlot(server: McpServer, components: TimeSlotToolsDeps): void {
  server.registerTool(
    DELETE_TIME_SLOT_TOOL_NAME,
    {
      description: DELETE_TIME_SLOT_DESCRIPTION,
      inputSchema: {
        time_slot_id: z.string().min(1).describe("삭제할 타임 슬롯 ID (get_time_slots로 확인)"),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async (args) => {
      try {
        const slot = await components.taskCommand.deleteTimeSlot(args.time_slot_id);
        return {
          content: [{ type: "text" as const, text: formatDeletedTimeSlotForLLM(slot) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `타임 슬롯 삭제 실패: ${message}. time_slot_id는 get_time_slots로 확인하세요.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
