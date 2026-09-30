// ---------------------------------------------------------------------------
// HTTP MCP server — one long-running process shared by every MCP client
// (Streamable HTTP, stateless). Each POST gets a fresh McpServer + transport
// so no session state survives a restart; AppComponents (auth, cache) and the
// auth keep-alive are shared across requests.
// ---------------------------------------------------------------------------

import type { AppComponents } from "@composition";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isAuthorizedRequest, readOrCreateHttpToken } from "./http-token.ts";
import { buildMcpServer, runUntilSignal } from "./server.ts";

export const MCP_HTTP_DEFAULT_HOST = "127.0.0.1";
export const MCP_HTTP_DEFAULT_PORT = 7823;
export const MCP_HTTP_PATH = "/mcp";

export interface McpHttpServerOptions {
  hostname?: string;
  port?: number;
}

export function createMcpHttpHandler(components: AppComponents, token: string): (req: Request) => Promise<Response> {
  return async (req) => {
    if (new URL(req.url).pathname !== MCP_HTTP_PATH) {
      return new Response("Not Found", { status: 404 });
    }
    if (!isAuthorizedRequest(req, token)) {
      return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
    }
    // Stateless mode has no standalone SSE stream or session to delete; the
    // spec lets servers answer both with 405.
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
    }

    const server = buildMcpServer(components);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(req);
    } finally {
      await server.close();
    }
  };
}

export async function startMcpHttpServer(components: AppComponents, options: McpHttpServerOptions = {}): Promise<void> {
  const hostname = options.hostname ?? MCP_HTTP_DEFAULT_HOST;
  const port = options.port ?? MCP_HTTP_DEFAULT_PORT;
  const token = await readOrCreateHttpToken(components.config.configDir);
  const handler = createMcpHttpHandler(components, token);

  let httpServer: ReturnType<typeof Bun.serve>;
  try {
    httpServer = Bun.serve({
      hostname,
      port,
      // Bun's 10s default would cut off slow tool calls that retry the API.
      idleTimeout: 255,
      fetch: handler,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      components.logger.error(
        `MCP HTTP port ${hostname}:${port} is already in use — is another af --mcp --http running?`,
      );
      process.exit(1);
    }
    throw err;
  }

  components.logger.info("MCP server listening (streamable http)", {
    url: `http://${hostname}:${port}${MCP_HTTP_PATH}`,
  });

  runUntilSignal(components, async () => {
    await httpServer.stop(true);
  });
}
