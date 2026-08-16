// ---------------------------------------------------------------------------
// MCP Meeting Assistant Tools — ADR-0007 (Outcome-first), ADR-0008 (isError)
// Wraps Akiflow's Meeting Assistant add-on (recordings/transcripts/action
// items + pre-meeting briefs), reverse-engineered from aki.akiflow.com/api/v1
// (see shrimpwtf/akiflow-mcp community reference). This is a paid Akiflow
// add-on — an empty list from these tools commonly means "no subscription /
// no recordings yet", not a broken integration.
// ---------------------------------------------------------------------------

import type { TaskCommandService } from "@core/services/task-command-service.ts";
import type { TaskQueryService } from "@core/services/task-query-service.ts";
import type { MeetingBrief, Recording } from "@core/types.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface MeetingToolsDeps {
  taskQuery: Pick<TaskQueryService, "getRecordings" | "getRecording" | "getMeetingBriefs" | "getMeetingBrief">;
  taskCommand: Pick<TaskCommandService, "createTaskFromActionItem">;
}

export const GET_RECORDINGS_TOOL_NAME = "get_recordings";
export const GET_RECORDING_TOOL_NAME = "get_recording";
export const GET_MEETING_BRIEFS_TOOL_NAME = "get_meeting_briefs";
export const GET_MEETING_BRIEF_TOOL_NAME = "get_meeting_brief";
export const CREATE_TASK_FROM_ACTION_ITEM_TOOL_NAME = "create_task_from_action_item";

const NO_ADDON_HINT = "(Meeting Assistant 유료 add-on 미구독이거나 아직 데이터가 없을 수 있습니다)";

export const GET_RECORDINGS_DESCRIPTION =
  "Akiflow Meeting Assistant의 회의 녹음 목록을 조회합니다 (요약, action item, 녹취록 포함). " +
  "Meeting Assistant 유료 add-on이 필요합니다. " +
  "결과는 녹음 목록 (제목, 시간, id). " +
  "예: '최근 회의 녹음 보여줘', '지난 미팅 요약 확인'";

export const GET_RECORDING_DESCRIPTION =
  "특정 회의 녹음의 상세 정보를 조회합니다 (요약, action item 목록, 녹취록 일부 포함). " +
  "action item에서 태스크를 만들려면 이 tool로 action_item_id를 먼저 확인하세요. " +
  "예: '이 녹음 요약 보여줘', 'X 녹음의 액션 아이템 알려줘'";

export const GET_MEETING_BRIEFS_DESCRIPTION =
  "Akiflow Meeting Assistant의 사전 회의 브리프(참석자 배경 정보 등) 목록을 조회합니다. " +
  "Meeting Assistant 유료 add-on이 필요합니다. " +
  "결과는 브리프 목록 (id, 관련 이벤트). " +
  "예: '다음 미팅 브리프 있어?', '사전 자료 확인해줘'";

export const GET_MEETING_BRIEF_DESCRIPTION =
  "특정 사전 회의 브리프의 상세 내용을 조회합니다. " + "예: '이 브리프 내용 보여줘'";

export const CREATE_TASK_FROM_ACTION_ITEM_DESCRIPTION =
  "회의 녹음의 action item으로부터 Akiflow 태스크를 생성합니다. " +
  "get_recording으로 recording_id와 action_item_id를 먼저 확인해야 합니다. " +
  "결과는 생성된 태스크 요약. " +
  "예: '이 액션 아이템 태스크로 만들어줘'";

export function formatRecordingsForLLM(recordings: Recording[]): string {
  if (recordings.length === 0) {
    return `## 회의 녹음\n녹음이 없습니다. ${NO_ADDON_HINT}`;
  }
  const lines = recordings.map((r, i) => {
    const actionCount = r.actionItems.length;
    const actionNote = actionCount > 0 ? `, action items: ${actionCount}` : "";
    return `${i + 1}. ${r.title} (${r.startTime} → ${r.endTime})${actionNote} {id: ${r.id}}`;
  });
  return `## 회의 녹음 — ${recordings.length}건\n${lines.join("\n")}`;
}

const TRANSCRIPT_PREVIEW_LINES = 10;

export function formatRecordingDetailForLLM(recording: Recording): string {
  const lines: string[] = [`## 회의: ${recording.title}`];
  lines.push(`- id: ${recording.id}`);
  lines.push(`- when: ${recording.startTime} → ${recording.endTime}`);
  lines.push("");
  lines.push("### 요약");
  lines.push(recording.summary ?? "(요약 없음)");

  lines.push("");
  lines.push(`### Action Items — ${recording.actionItems.length}건`);
  if (recording.actionItems.length === 0) {
    lines.push("(없음)");
  } else {
    for (const item of recording.actionItems) {
      const due = item.dueDate ? ` (due: ${item.dueDate})` : "";
      lines.push(`- ${item.title}${due} {action_item_id: ${item.id}}`);
    }
  }

  if (recording.transcript.length > 0) {
    lines.push("");
    lines.push(`### 녹취록 미리보기 (처음 ${TRANSCRIPT_PREVIEW_LINES}건 / 전체 ${recording.transcript.length}건)`);
    for (const entry of recording.transcript.slice(0, TRANSCRIPT_PREVIEW_LINES)) {
      lines.push(`- ${entry.speakerName}: ${entry.paragraph}`);
    }
  }

  return lines.join("\n");
}

export function formatMeetingBriefsForLLM(briefs: MeetingBrief[]): string {
  if (briefs.length === 0) {
    return `## 회의 브리프\n브리프가 없습니다. ${NO_ADDON_HINT}`;
  }
  const lines = briefs.map((b, i) => `${i + 1}. event:${b.originEventId ?? "?"} {id: ${b.id}}`);
  return `## 회의 브리프 — ${briefs.length}건\n${lines.join("\n")}`;
}

export function formatMeetingBriefDetailForLLM(brief: MeetingBrief): string {
  const lines: string[] = [`## 브리프: ${brief.id}`];
  if (brief.originEventId) lines.push(`- event: ${brief.originEventId}`);
  lines.push("");
  lines.push("### 내용");
  lines.push(brief.data ? JSON.stringify(brief.data, null, 2) : "(내용 없음)");
  return lines.join("\n");
}

function errorResult(operation: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [
      {
        type: "text" as const,
        text: `${operation} 실패: ${message}. 'af auth' 명령으로 재인증 후 다시 시도하세요.`,
      },
    ],
    isError: true,
  };
}

export function registerMeetingTools(server: McpServer, components: MeetingToolsDeps): void {
  server.registerTool(
    GET_RECORDINGS_TOOL_NAME,
    { description: GET_RECORDINGS_DESCRIPTION, inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => {
      try {
        const recordings = await components.taskQuery.getRecordings();
        return { content: [{ type: "text" as const, text: formatRecordingsForLLM(recordings) }] };
      } catch (err) {
        return errorResult("회의 녹음 조회", err);
      }
    },
  );

  server.registerTool(
    GET_RECORDING_TOOL_NAME,
    {
      description: GET_RECORDING_DESCRIPTION,
      inputSchema: { id: z.string().min(1).describe("녹음 ID") },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const recording = await components.taskQuery.getRecording(args.id);
        return { content: [{ type: "text" as const, text: formatRecordingDetailForLLM(recording) }] };
      } catch (err) {
        return errorResult("회의 녹음 상세 조회", err);
      }
    },
  );

  server.registerTool(
    GET_MEETING_BRIEFS_TOOL_NAME,
    { description: GET_MEETING_BRIEFS_DESCRIPTION, inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => {
      try {
        const briefs = await components.taskQuery.getMeetingBriefs();
        return { content: [{ type: "text" as const, text: formatMeetingBriefsForLLM(briefs) }] };
      } catch (err) {
        return errorResult("회의 브리프 조회", err);
      }
    },
  );

  server.registerTool(
    GET_MEETING_BRIEF_TOOL_NAME,
    {
      description: GET_MEETING_BRIEF_DESCRIPTION,
      inputSchema: { id: z.string().min(1).describe("브리프 ID") },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const brief = await components.taskQuery.getMeetingBrief(args.id);
        return { content: [{ type: "text" as const, text: formatMeetingBriefDetailForLLM(brief) }] };
      } catch (err) {
        return errorResult("회의 브리프 상세 조회", err);
      }
    },
  );

  server.registerTool(
    CREATE_TASK_FROM_ACTION_ITEM_TOOL_NAME,
    {
      description: CREATE_TASK_FROM_ACTION_ITEM_DESCRIPTION,
      inputSchema: {
        recording_id: z.string().min(1).describe("회의 녹음 ID (get_recordings로 확인)"),
        action_item_id: z.string().min(1).describe("action item ID (get_recording으로 확인)"),
      },
    },
    async (args) => {
      try {
        const result = await components.taskCommand.createTaskFromActionItem(args.recording_id, args.action_item_id);
        const label = result.title ?? result.id ?? "(생성됨)";
        return { content: [{ type: "text" as const, text: `Created task from action item: ${label}` }] };
      } catch (err) {
        return errorResult("action item → 태스크 생성", err);
      }
    },
  );
}
