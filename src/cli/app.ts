// ---------------------------------------------------------------------------
// CLI entry — citty-based (ADR-0002)
// runCli wires up subcommands with AppComponents and normalizes error exits
// per ADR-0008 (exit code mapping).
// ---------------------------------------------------------------------------

import { defineCommand, runMain } from "citty";
import type { AppComponents } from "../composition.ts";
import { AkiflowError } from "../core/errors/index.ts";
import type { LoggerPort } from "../core/ports/logger-port.ts";

export function buildCli(components: AppComponents) {
  return defineCommand({
    meta: {
      name: "af",
      version: "0.0.0-development",
      description: "Akiflow CLI + MCP",
    },
    subCommands: {
      auth: () => import("./commands/auth.ts").then((m) => m.createAuthCommand(components)),
      add: () => import("./commands/add.ts").then((m) => m.createAddCommand(components)),
      ls: () => import("./commands/ls.ts").then((m) => m.createLsCommand(components)),
      do: () => import("./commands/do.ts").then((m) => m.createDoCommand(components)),
      cache: () => import("./commands/cache.ts").then((m) => m.createCacheCommand(components)),
      setup: () => import("./commands/setup.ts").then((m) => m.createSetupCommand(components)),
      project: () => import("./commands/project.ts").then((m) => m.createProjectCommand(components)),
      cal: () => import("./commands/cal.ts").then((m) => m.createCalCommand(components)),
      block: () => import("./commands/block.ts").then((m) => m.createBlockCommand(components)),
    },
  });
}

export async function runCli(components: AppComponents): Promise<void> {
  try {
    await runMain(buildCli(components));
  } catch (err) {
    handleCliError(err, components.logger);
  }
}

export function handleCliError(err: unknown, logger: LoggerPort): never {
  if (err instanceof AkiflowError) {
    logger.error(err.userMessage);
    if (err.hint) logger.info(err.hint);
    process.exit(exitCodeFor(err.code));
  }
  if (err instanceof Error) {
    logger.error("Unexpected error", err);
  } else {
    logger.error("Unexpected error", { value: String(err) });
  }
  process.exit(1);
}

export function exitCodeFor(code: string): number {
  if (code.startsWith("AUTH")) return 2;
  if (code.startsWith("NETWORK") || code === "API_SCHEMA_MISMATCH") return 3;
  if (code === "VALIDATION") return 4;
  if (code === "NOT_FOUND") return 5;
  if (code === "BROWSER_DATA") return 6;
  return 1;
}
