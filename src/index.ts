#!/usr/bin/env bun

if (process.argv.includes("--mcp")) {
  process.stderr.write("[akiflow] MCP server mode — not yet implemented\n");
  process.exit(1);
} else {
  const { composeApp } = await import("./composition.ts");
  const { runCli } = await import("./cli/app.ts");
  const components = composeApp();
  await runCli(components);
}
