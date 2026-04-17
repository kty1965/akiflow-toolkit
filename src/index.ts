#!/usr/bin/env bun
export {};

if (process.argv.includes("--mcp")) {
  // MCP mode: stdout reserved for JSON-RPC. All logging goes to stderr (ADR-0009 / H2).
  const { composeApp } = await import("./composition.ts");
  const { startMcpServer } = await import("./mcp/server.ts");
  const components = composeApp();
  await startMcpServer(components);
} else {
  const { composeApp } = await import("./composition.ts");
  const { runCli } = await import("./cli/app.ts");
  const components = composeApp();
  await runCli(components);
}
