// ---------------------------------------------------------------------------
// MCP Server — ADR-0002 / ADR-0009
// stdio transport: stdout is reserved for JSON-RPC; all logs go to stderr.
// Tool registration is delegated to register* functions under src/mcp/tools/
// so each bounded context (tasks, schedule, calendar, organize, auth) stays
// cohesive (ADR-0007).
// ---------------------------------------------------------------------------

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { AppComponents } from "../composition.ts";
import { registerAuthStatusTool } from "./tools/auth-status.ts";
import { registerCalendarTools } from "./tools/calendar.ts";
import { registerOrganizeTools } from "./tools/organize.ts";
import { registerScheduleTools } from "./tools/schedule.ts";
import { registerTaskTools } from "./tools/tasks.ts";

export const MCP_SERVER_NAME = "akiflow";
export const MCP_SERVER_VERSION = "0.0.0-development";

export function buildMcpServer(components: AppComponents): McpServer {
  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
  });

  registerTaskTools(server, components);
  registerScheduleTools(server, components);
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
