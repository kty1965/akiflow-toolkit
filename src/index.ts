#!/usr/bin/env bun
export {};

if (process.argv.includes("--mcp")) {
  // MCP mode: stdout reserved for JSON-RPC. All logging goes to stderr (ADR-0009 / H2).
  const { composeApp } = await import("./composition.ts");
  const components = composeApp();
  if (process.argv.includes("--http")) {
    const { startMcpHttpServer } = await import("./mcp/http-server.ts");
    await startMcpHttpServer(components);
  } else {
    const { startMcpServer } = await import("./mcp/server.ts");
    await startMcpServer(components);
  }
} else {
  const { composeApp } = await import("./composition.ts");
  const { runCli } = await import("./cli/app.ts");
  const components = composeApp();
  await runCli(components);
}
