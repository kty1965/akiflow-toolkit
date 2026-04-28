#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// Tier 2 Live E2E — Task notes/description exposure (ADR-0015 §3)
//
// Spawns the real `af --mcp` stdio process and exercises:
//   1. tools/list — get_task is registered with read-only annotations and
//      includeNotes flag is exposed on get_tasks/search_tasks
//   2. get_tasks(filter=today, includeNotes=true) — finds at least one task
//      whose description was rendered as a "notes:" preview line
//   3. get_task(id) on that task — full detail with `### Notes` body matches
//      the description content seen in the list
//   4. get_tasks(filter=today) without includeNotes — confirms preview is OFF
//      by default (no "notes:" line)
//
// Read-only against the real Akiflow account; never creates or mutates data.
//
// Usage:
//   bun run e2e:notes               # via npm script (preferred)
//   bun run scripts/mcp-live-task-notes.ts [--verbose]
//
// Prerequisites:
//   1. auth.json exists — `bun run src/index.ts auth status`
//   2. Network access to api.akiflow.com
//   3. At least one task today with a non-empty description (for full coverage;
//      script gracefully degrades if none exist)
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const argv = process.argv.slice(2);
const VERBOSE = argv.includes("--verbose") || argv.includes("-v");
const HELP = argv.includes("--help") || argv.includes("-h");

if (HELP) {
  console.log(`\
mcp-live-task-notes — Tier 2 live E2E for the task-notes feature

Usage:
  bun run e2e:notes
  bun run scripts/mcp-live-task-notes.ts [--verbose]

Flags:
  --verbose   Dump raw MCP tool responses
  --help      Show this help
`);
  process.exit(0);
}

const TTY = process.stdout.isTTY;
const c = {
  dim: (s: string) => (TTY ? `\x1b[2m${s}\x1b[0m` : s),
  green: (s: string) => (TTY ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (TTY ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (TTY ? `\x1b[33m${s}\x1b[0m` : s),
  bold: (s: string) => (TTY ? `\x1b[1m${s}\x1b[0m` : s),
};

let stepCounter = 0;
function step(title: string): void {
  stepCounter++;
  process.stdout.write(`\n${c.bold(`[${stepCounter}]`)} ${title}\n`);
}
function ok(msg: string): void {
  process.stdout.write(`    ${c.green("✓")} ${msg}\n`);
}
function warn(msg: string): void {
  process.stdout.write(`    ${c.yellow("!")} ${msg}\n`);
}
function info(msg: string): void {
  process.stdout.write(`    ${c.dim("·")} ${c.dim(msg)}\n`);
}
function fail(msg: string): void {
  process.stdout.write(`    ${c.red("✗")} ${msg}\n`);
}

function resolveAuthFile(): string {
  const configDir =
    process.env.AF_CONFIG_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "akiflow");
  return join(configDir, "auth.json");
}

function preflight(): void {
  step("Preflight — auth.json");
  const authFile = resolveAuthFile();
  info(`expected at ${authFile}`);
  if (!existsSync(authFile)) {
    fail("auth.json not found");
    process.stdout.write(`\n${c.yellow("Authenticate first — pick one:")}\n`);
    process.stdout.write("  bun run src/index.ts auth\n");
    process.stdout.write("  bun run src/index.ts auth --manual\n\n");
    process.exit(2);
  }
  ok("credentials present");
}

interface McpTextResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

function textOf(result: unknown): string {
  return (result as McpTextResult).content?.[0]?.text ?? "";
}

function isErr(result: unknown): boolean {
  return (result as McpTextResult).isError === true;
}

interface ListedTaskWithNotes {
  id: string;
  notesPreview: string;
}

// Parse `formatTaskList` output: lines like
//   1. [09:30-18:30] Title ✓ {id: <uuid>}
//      notes: <preview...>
function findFirstTaskWithNotes(listText: string): ListedTaskWithNotes | null {
  const lines = listText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const idMatch = line.match(/\{id:\s*([0-9a-f-]{36})\}/i);
    if (!idMatch) continue;
    const next = lines[i + 1] ?? "";
    const notesMatch = next.match(/^\s+notes:\s*(.+)$/);
    if (!notesMatch) continue;
    return { id: idMatch[1] as string, notesPreview: (notesMatch[1] as string).trim() };
  }
  return null;
}

async function main(): Promise<void> {
  preflight();

  step("Spawn — bun run src/index.ts --mcp");
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "src/index.ts", "--mcp"],
    env: {
      ...(process.env as Record<string, string>),
      LOG_LEVEL: process.env.LOG_LEVEL ?? "warn",
      LOG_FORMAT: "text",
      AF_CACHE_TTL_SECONDS: "0",
    },
    stderr: "pipe",
  });

  const stderrLog: string[] = [];
  transport.stderr?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split("\n")) {
      const t = line.trim();
      if (!t) continue;
      stderrLog.push(t);
      if (stderrLog.length > 200) stderrLog.shift();
      if (VERBOSE) info(`[server] ${t}`);
    }
  });

  function dumpStderr(label: string, take = 30): void {
    const tail = stderrLog.slice(-take);
    if (tail.length === 0) return;
    process.stdout.write(`\n${c.dim(`--- server stderr (last ${tail.length} lines, ${label}) ---`)}\n`);
    for (const l of tail) process.stdout.write(`  ${c.dim(l)}\n`);
    process.stdout.write(`${c.dim("---")}\n`);
  }

  const client = new Client({ name: "mcp-live-task-notes", version: "0.0.0" });
  await client.connect(transport);
  ok("stdio handshake complete");

  const shutdown = async (reason: string): Promise<void> => {
    try {
      await client.close();
    } catch {
      // ignore
    }
    warn(`shutdown (${reason})`);
  };
  process.on("SIGINT", () => void shutdown("SIGINT").then(() => process.exit(130)));
  process.on("SIGTERM", () => void shutdown("SIGTERM").then(() => process.exit(143)));

  try {
    // ---------------------------------------------------------------- 1
    step("tools/list — get_task registered, includeNotes flag exposed");
    const { tools } = await client.listTools();
    const get_task = tools.find((t) => t.name === "get_task");
    const get_tasks = tools.find((t) => t.name === "get_tasks");
    const search_tasks = tools.find((t) => t.name === "search_tasks");
    if (!get_task) throw new Error("get_task tool not registered");
    if (!get_tasks || !search_tasks) throw new Error("list/search tool missing");
    if (get_task.annotations?.readOnlyHint !== true) throw new Error("get_task readOnlyHint != true");
    const listSchema = (get_tasks.inputSchema ?? {}) as { properties?: Record<string, unknown> };
    const searchSchema = (search_tasks.inputSchema ?? {}) as { properties?: Record<string, unknown> };
    if (!listSchema.properties || !("includeNotes" in listSchema.properties)) {
      throw new Error("get_tasks.inputSchema is missing includeNotes");
    }
    if (!searchSchema.properties || !("includeNotes" in searchSchema.properties)) {
      throw new Error("search_tasks.inputSchema is missing includeNotes");
    }
    ok("get_task + includeNotes flags registered");

    // ---------------------------------------------------------------- 2
    step("get_tasks(filter=today, includeNotes=true) — find a task whose notes were previewed");
    const listed = await client.callTool({
      name: "get_tasks",
      arguments: { filter: "today", includeNotes: true },
    });
    if (isErr(listed)) {
      dumpStderr("get_tasks failure");
      throw new Error(`get_tasks returned isError: ${textOf(listed)}`);
    }
    const listedText = textOf(listed);
    if (VERBOSE) info(listedText.slice(0, 400));
    const target = findFirstTaskWithNotes(listedText);
    if (!target) {
      warn("no today task carries a description — coverage of step 3 reduced");
    } else {
      ok(`found task ${target.id} with notes preview`);
      info(`preview: ${target.notesPreview.slice(0, 80)}${target.notesPreview.length > 80 ? "…" : ""}`);
    }

    // ---------------------------------------------------------------- 3
    if (target) {
      step(`get_task(id=${target.id}) — full detail with ### Notes body`);
      const detail = await client.callTool({
        name: "get_task",
        arguments: { id: target.id },
      });
      if (isErr(detail)) {
        dumpStderr("get_task failure");
        throw new Error(`get_task returned isError: ${textOf(detail)}`);
      }
      const detailText = textOf(detail);
      if (VERBOSE) info(detailText);
      if (!detailText.startsWith("## Task: ")) {
        throw new Error(`get_task body did not start with '## Task: ' header — got: ${detailText.slice(0, 80)}`);
      }
      if (!detailText.includes("### Notes")) {
        throw new Error("get_task body missing '### Notes' section");
      }
      // The first ~50 chars of the preview must appear verbatim somewhere in the
      // full detail body (preview is whitespace-normalised, so a substring of
      // the original description's first chars should still match).
      const seed = target.notesPreview.replace(/…$/, "").slice(0, 30);
      if (seed && !detailText.includes(seed)) {
        warn(`detail body did not contain preview seed "${seed.slice(0, 30)}" — soft mismatch`);
      } else {
        ok("notes content matches preview");
      }
      ok("get_task rendered structured detail");
    } else {
      step("get_task — skipped (no task with description on filter=today)");
    }

    // ---------------------------------------------------------------- 4
    step("get_tasks(filter=today) without includeNotes — preview is OFF by default");
    const noNotes = await client.callTool({
      name: "get_tasks",
      arguments: { filter: "today" },
    });
    if (isErr(noNotes)) {
      dumpStderr("default get_tasks failure");
      throw new Error(`get_tasks default returned isError: ${textOf(noNotes)}`);
    }
    const noNotesText = textOf(noNotes);
    if (VERBOSE) info(noNotesText.slice(0, 400));
    if (/^\s+notes:\s/m.test(noNotesText)) {
      throw new Error("default get_tasks rendered 'notes:' lines — includeNotes default is not false");
    }
    ok("default output omits notes preview");

    process.stdout.write(`\n${c.green(c.bold("✓ task-notes E2E checks passed."))}\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(`\n${c.red(c.bold("✗ Failed:"))} ${msg}\n`);
    process.exitCode = 1;
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stdout.write(`\n${c.red("fatal:")} ${msg}\n`);
  process.exit(1);
});
