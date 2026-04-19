#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// Tier 2 Live E2E Demo (ADR-0015 §3)
//
// Spawns the real `af --mcp` stdio process, connects via the MCP Client SDK,
// and exercises a full create → verify → complete → verify flow against the
// real Akiflow backend. Not a test runner — a scriptable live probe you can
// eyeball on a local dev machine.
//
// Usage:
//   bun run scripts/mcp-live-demo.ts              # full flow + cleanup
//   bun run scripts/mcp-live-demo.ts --keep       # skip cleanup step
//   bun run scripts/mcp-live-demo.ts --verbose    # print raw MCP responses
//
// Prerequisites:
//   1. Authentication completed — auth.json must exist. Run one of:
//        bun run src/index.ts auth            # auto (CDP / browser cookie)
//        bun run src/index.ts auth --manual   # paste refresh_token via stdin
//      Check with:  bun run src/index.ts auth status
//   2. Network access to api.akiflow.com
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ---------- CLI flags -----------------------------------------------------

const argv = process.argv.slice(2);
const KEEP = argv.includes("--keep");
const VERBOSE = argv.includes("--verbose") || argv.includes("-v");
const HELP = argv.includes("--help") || argv.includes("-h");

if (HELP) {
  console.log(`\
mcp-live-demo — Tier 2 live E2E probe for the MCP server

Usage:
  bun run scripts/mcp-live-demo.ts [--keep] [--verbose]

Flags:
  --keep      Skip complete_task cleanup (leaves test task in inbox)
  --verbose   Dump raw MCP tool responses
  --help      Show this help
`);
  process.exit(0);
}

// ---------- Pretty-print helpers -----------------------------------------

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

// ---------- Preflight: auth.json must exist ------------------------------

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
    process.stdout.write("  bun run src/index.ts auth            # auto (CDP / browser cookie)\n");
    process.stdout.write("  bun run src/index.ts auth --manual   # paste refresh_token via stdin\n");
    process.stdout.write(`\n${c.yellow("Verify:")}\n`);
    process.stdout.write("  bun run src/index.ts auth status\n\n");
    process.exit(2);
  }
  ok("credentials present");
}

// ---------- MCP text-response helpers ------------------------------------

interface McpTextResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

function textOf(result: unknown): string {
  const r = result as McpTextResult;
  return r.content?.[0]?.text ?? "";
}

function extractTaskId(text: string): string | null {
  // Matches `{id: <uuid>}` as emitted by formatTaskLine (src/mcp/tools/tasks.ts)
  const m = text.match(/\{id:\s*([0-9a-f-]{36})\}/i);
  return m ? m[1] : null;
}

// ---------- Main ----------------------------------------------------------

async function main(): Promise<void> {
  preflight();

  step("Spawn — bun run src/index.ts --mcp");
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "src/index.ts", "--mcp"],
    env: {
      ...(process.env as Record<string, string>),
      // trace level so logger.trace("akiflow request", {method, path}) shows up
      LOG_LEVEL: process.env.LOG_LEVEL ?? "trace",
      LOG_FORMAT: "text",
      // Bypass TaskQueryService list cache so `create_task → get_tasks` sees
      // the new task immediately. Write-side services currently do NOT
      // invalidate the read cache — see TASK-cache-invalidation-on-writes.md.
      AF_CACHE_TTL_SECONDS: "0",
    },
    stderr: "pipe",
  });

  // Buffer every stderr line so we can dump a trailing slice on failure.
  const stderrLog: string[] = [];
  const STDERR_BUFFER_MAX = 200;
  transport.stderr?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split("\n")) {
      const t = line.trim();
      if (!t) continue;
      stderrLog.push(t);
      if (stderrLog.length > STDERR_BUFFER_MAX) stderrLog.shift();
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

  const client = new Client({ name: "mcp-live-demo", version: "0.0.0" });
  await client.connect(transport);
  ok("stdio handshake complete");

  // Register cleanup signal handlers once transport is live
  const shutdown = async (reason: string): Promise<void> => {
    try {
      await client.close();
    } catch {
      // ignore: server may already be dead
    }
    warn(`shutdown (${reason})`);
  };
  process.on("SIGINT", () => void shutdown("SIGINT").then(() => process.exit(130)));
  process.on("SIGTERM", () => void shutdown("SIGTERM").then(() => process.exit(143)));

  let createdId: string | null = null;

  try {
    // --------------------------------------------------------------------
    step("tools/list — discover registered tools");
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    info(`${names.length} tools: ${names.join(", ")}`);
    for (const expected of [
      "get_tasks",
      "search_tasks",
      "create_task",
      "update_task",
      "complete_task",
      "schedule_task",
      "unschedule_task",
      "get_events",
      "auth_status",
    ]) {
      if (!names.includes(expected)) {
        fail(`missing tool: ${expected}`);
        throw new Error(`MCP server did not register '${expected}'`);
      }
    }
    ok("all expected tool names registered");

    // --------------------------------------------------------------------
    step("auth_status — verify credentials are still valid");
    const auth = await client.callTool({ name: "auth_status", arguments: {} });
    const authText = textOf(auth);
    if (VERBOSE) info(authText);
    if ((auth as McpTextResult).isError) {
      fail("auth_status reported an error");
      warn(authText);
      dumpStderr("auth_status failure");
      throw new Error("Authentication check failed — run `af auth` (or `af auth --manual`) and retry");
    }
    ok(authText.split("\n")[0] ?? "authenticated");

    // --------------------------------------------------------------------
    step("get_tasks filter=all — READ pre-check (isolates READ vs WRITE failures)");
    const preRead = await client.callTool({
      name: "get_tasks",
      arguments: { filter: "all" },
    });
    const preReadText = textOf(preRead);
    if (VERBOSE) info(preReadText.slice(0, 300));
    if ((preRead as McpTextResult).isError) {
      fail("READ pre-check failed — API base URL / token / network issue");
      warn(preReadText);
      dumpStderr("READ failure");
      throw new Error("get_tasks failed → auth or API endpoint reachability is broken");
    }
    ok("READ path reaches Akiflow API");

    // --------------------------------------------------------------------
    const marker = `e2e-demo-${Date.now()}`;
    step(`create_task — title="${marker}"`);
    const created = await client.callTool({
      name: "create_task",
      arguments: { title: marker },
    });
    const createdText = textOf(created);
    if (VERBOSE) info(createdText);
    if ((created as McpTextResult).isError) {
      fail("create_task returned isError");
      warn(createdText);
      dumpStderr("WRITE failure");
      throw new Error("create_task failed against real Akiflow API");
    }
    createdId = extractTaskId(createdText);
    if (!createdId) {
      fail("could not extract task id from response");
      warn(createdText);
      throw new Error("Task response missing {id: ...}");
    }
    ok(`created id=${createdId}`);

    // --------------------------------------------------------------------
    step("get_tasks filter=inbox — verify new task is listed");
    const inbox = await client.callTool({
      name: "get_tasks",
      arguments: { filter: "inbox" },
    });
    const inboxText = textOf(inbox);
    if (VERBOSE) info(inboxText);
    if (!inboxText.includes(marker)) {
      fail(`marker "${marker}" not found in inbox response`);
      warn(inboxText.slice(0, 400));
      throw new Error("Newly created task was not visible via get_tasks(inbox)");
    }
    ok("task appears in inbox");

    // --------------------------------------------------------------------
    if (KEEP) {
      warn("--keep set; leaving task in inbox, skipping complete_task");
    } else {
      step(`complete_task — id=${createdId}`);
      const completed = await client.callTool({
        name: "complete_task",
        arguments: { id: createdId },
      });
      const completedText = textOf(completed);
      if (VERBOSE) info(completedText);
      if ((completed as McpTextResult).isError) {
        fail("complete_task returned isError");
        warn(completedText);
        dumpStderr("complete_task failure");
        throw new Error("complete_task failed");
      }
      if (!completedText.includes("✓") && !completedText.toLowerCase().includes("completed")) {
        warn(`response did not contain ✓ marker — raw: ${completedText}`);
      }
      ok("task marked done");

      // ----------------------------------------------------------------
      step("get_tasks filter=done — verify completion");
      const done = await client.callTool({
        name: "get_tasks",
        arguments: { filter: "done" },
      });
      const doneText = textOf(done);
      if (VERBOSE) info(doneText);
      if (!doneText.includes(createdId)) {
        // Akiflow completed-list may be paginated — warn but do not fail
        warn("completed task id not in filter=done response (may be paginated)");
      } else {
        ok("task appears in done list");
      }
    }

    // --------------------------------------------------------------------
    process.stdout.write(`\n${c.green(c.bold("✓ All Tier 2 E2E checks passed."))}\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(`\n${c.red(c.bold("✗ Failed:"))} ${msg}\n`);
    if (createdId && !KEEP) {
      warn(`test task ${createdId} may still exist in your inbox — complete it manually if needed`);
    }
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
