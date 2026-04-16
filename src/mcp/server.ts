// ---------------------------------------------------------------------------
// MCP Server — ADR-0002 / ADR-0009
// stdio transport: stdout is reserved for JSON-RPC; all logs go to stderr.
// Tool registration is delegated to register* functions under src/mcp/tools/
// so each bounded context (calendar, organize, auth) stays cohesive (ADR-0007).
// ---------------------------------------------------------------------------

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { AppComponents } from "../composition.ts";
import { registerAuthStatusTool } from "./tools/auth-status.ts";
import { registerCalendarTools } from "./tools/calendar.ts";
import { registerOrganizeTools } from "./tools/organize.ts";

export const MCP_SERVER_NAME = "akiflow";
export const MCP_SERVER_VERSION = "0.0.0-development";

export const PING_TOOL_NAME = "ping";
export const PING_TOOL_DESCRIPTION =
  "Health check — returns 'pong'. Temporary stub until TASK-15 registers real tools.";

export async function pingHandler(): Promise<{
  content: Array<{ type: "text"; text: string }>;
}> {
  return { content: [{ type: "text", text: "pong" }] };
}

export function buildMcpServer(components: AppComponents): McpServer {
  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
  });

  server.tool(PING_TOOL_NAME, PING_TOOL_DESCRIPTION, {}, pingHandler);
  registerCalendarTools(server, components);
  registerOrganizeTools(server, components);
  registerAuthStatusTool(server, components);

  return server;
}

export async function startMcpServer(components: AppComponents): Promise<void> {
  const server = buildMcpServer(components);
  const transport = new StdioServerTransport();

  components.logger.info("MCP server starting (stdio transport)");

  await server.connect(transport);

  const shutdown = async (signal: string): Promise<void> => {
    components.logger.info("MCP server shutdown", { signal });
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
