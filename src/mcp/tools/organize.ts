// ---------------------------------------------------------------------------
// MCP Organize Tools — ADR-0007 (Outcome-first), ADR-0008 (isError boundary)
// Read-only tools that expose Akiflow taxonomy (projects/labels/tags).
// Akiflow's internal API uses "labels" to represent user-facing "projects";
// `get_projects` and `get_labels` both map to the same endpoint but exist
// separately so LLMs can match either user vocabulary.
// ---------------------------------------------------------------------------

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TaskQueryService } from "../../core/services/task-query-service.ts";
import type { Label, Tag } from "../../core/types.ts";

export interface OrganizeToolsDeps {
  taskQuery: Pick<TaskQueryService, "getLabels" | "getTags">;
}

export const GET_PROJECTS_TOOL_NAME = "get_projects";
export const GET_LABELS_TOOL_NAME = "get_labels";
export const GET_TAGS_TOOL_NAME = "get_tags";

export const GET_PROJECTS_DESCRIPTION =
  "Akiflow 프로젝트(라벨) 목록을 조회합니다. " +
  "태스크를 특정 프로젝트에 분류하거나, 사용자가 언급한 프로젝트명을 ID로 변환할 때 사용합니다. " +
  "결과는 프로젝트 목록 (id, name, color). " +
  "예: '프로젝트 목록 보여줘', '어떤 프로젝트가 있어?', 'Marketing 프로젝트 ID 찾아줘'";

export const GET_LABELS_DESCRIPTION =
  "Akiflow 라벨 목록을 조회합니다 (Akiflow 내부 API에서 프로젝트와 동일 개념). " +
  "라벨명으로 태스크를 필터링하거나 라벨 ID를 확인할 때 사용합니다. " +
  "결과는 라벨 목록 (id, name, color). " +
  "예: '라벨 목록 보여줘', '사용 중인 라벨이 뭐야?'";

export const GET_TAGS_DESCRIPTION =
  "Akiflow 태그 목록을 조회합니다. " +
  "태그로 태스크를 분류하거나 자연어로 언급된 태그명을 ID로 변환할 때 사용합니다. " +
  "결과는 태그 목록 (id, name). " +
  "예: '태그 목록 보여줘', '#urgent 태그 있어?'";

export function formatLabelsForLLM(labels: Label[], heading: string): string {
  if (labels.length === 0) {
    return `## ${heading}\n등록된 항목이 없습니다.`;
  }
  const lines = labels.map((l, i) => {
    const color = l.color ? ` (color:${l.color})` : "";
    return `${i + 1}. ${l.name} [${l.id}]${color}`;
  });
  return `## ${heading} — ${labels.length}건\n${lines.join("\n")}`;
}

export function formatTagsForLLM(tags: Tag[]): string {
  if (tags.length === 0) {
    return "## 태그\n등록된 태그가 없습니다.";
  }
  const lines = tags.map((t, i) => `${i + 1}. #${t.name} [${t.id}]`);
  return `## 태그 — ${tags.length}건\n${lines.join("\n")}`;
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

export function registerOrganizeTools(server: McpServer, components: OrganizeToolsDeps): void {
  server.registerTool(
    GET_PROJECTS_TOOL_NAME,
    {
      description: GET_PROJECTS_DESCRIPTION,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const labels = await components.taskQuery.getLabels();
        return {
          content: [{ type: "text" as const, text: formatLabelsForLLM(labels, "프로젝트") }],
        };
      } catch (err) {
        return errorResult("프로젝트 조회", err);
      }
    },
  );

  server.registerTool(
    GET_LABELS_TOOL_NAME,
    {
      description: GET_LABELS_DESCRIPTION,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const labels = await components.taskQuery.getLabels();
        return {
          content: [{ type: "text" as const, text: formatLabelsForLLM(labels, "라벨") }],
        };
      } catch (err) {
        return errorResult("라벨 조회", err);
      }
    },
  );

  server.registerTool(
    GET_TAGS_TOOL_NAME,
    {
      description: GET_TAGS_DESCRIPTION,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const tags = await components.taskQuery.getTags();
        return {
          content: [{ type: "text" as const, text: formatTagsForLLM(tags) }],
        };
      } catch (err) {
        return errorResult("태그 조회", err);
      }
    },
  );
}
