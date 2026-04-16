#!/usr/bin/env bun

if (process.argv.includes("--mcp")) {
  // MCP server mode: stdout is reserved for JSON-RPC protocol
  // All logging must go to stderr
  console.error("[akiflow] MCP server mode — not yet implemented");
  process.exit(1);
} else {
  // CLI mode: normal terminal output
  console.log("[akiflow] CLI mode — not yet implemented");
}
