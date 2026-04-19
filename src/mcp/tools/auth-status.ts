// ---------------------------------------------------------------------------
// MCP auth_status Tool — ADR-0007 (Outcome-first), ADR-0008 (isError boundary)
// Lets an LLM agent self-diagnose auth issues (expired token, missing source).
// ---------------------------------------------------------------------------

import type { AuthService } from "@core/services/auth-service.ts";
import type { AuthStatus } from "@core/types.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface AuthStatusToolDeps {
  authService: Pick<AuthService, "getStatus">;
}

export const AUTH_STATUS_TOOL_NAME = "auth_status";

export const AUTH_STATUS_DESCRIPTION =
  "Akiflow 인증 상태를 확인합니다. " +
  "다른 Tool 호출 실패 시 인증 문제인지 먼저 진단하거나, 토큰 만료 시각을 확인할 때 사용합니다. " +
  "결과는 인증 여부, 만료 시각(ISO8601), 토큰 소스(indexeddb/cookie/cdp/manual). " +
  "예: '인증 상태 확인', '토큰이 언제 만료돼?', '로그인 되어 있어?'";

export function formatAuthStatus(status: AuthStatus): string {
  if (!status.isAuthenticated && status.source === null) {
    return "## 인증 상태\n미인증 상태입니다. 'af auth' 명령으로 로그인하세요.";
  }
  const expiresIso = status.expiresAt !== null ? new Date(status.expiresAt).toISOString() : "unknown";
  const source = status.source ?? "unknown";
  if (status.isExpired) {
    return `## 인증 상태\n만료됨. 만료: ${expiresIso}. 소스: ${source}. 'af auth' 명령으로 재인증하세요.`;
  }
  return `## 인증 상태\n인증됨. 만료: ${expiresIso}. 소스: ${source}.`;
}

export function registerAuthStatusTool(server: McpServer, components: AuthStatusToolDeps): void {
  server.registerTool(
    AUTH_STATUS_TOOL_NAME,
    {
      description: AUTH_STATUS_DESCRIPTION,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const status = await components.authService.getStatus();
        return {
          content: [{ type: "text" as const, text: formatAuthStatus(status) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `인증 상태 조회 실패: ${message}.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
