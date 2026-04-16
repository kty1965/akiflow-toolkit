// ---------------------------------------------------------------------------
// af setup — register the akiflow MCP server in AI editor configs (TASK-17)
// Subcommands: `af setup claude-code|cursor|claude-desktop`
// Read, merge, atomic-write to preserve existing user config.
// ---------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type Interface as ReadlineInterface, createInterface } from "node:readline";
import { defineCommand } from "citty";
import { ValidationError } from "../../core/errors/index.ts";
import type { LoggerPort } from "../../core/ports/logger-port.ts";
import type { AuthStatus } from "../../core/types.ts";
import { handleCliError } from "../app.ts";

export type SetupTargetName = "claude-code" | "cursor" | "claude-desktop";

export interface SetupTarget {
  readonly name: SetupTargetName;
  readonly displayName: string;
  readonly configPath: string;
}

export interface SetupAuthService {
  getStatus(): Promise<AuthStatus>;
}

export interface SetupCommandComponents {
  authService: SetupAuthService;
  logger: LoggerPort;
}

export interface CliWriter {
  write(chunk: string): boolean;
}

export type ConfirmPrompt = (message: string) => Promise<boolean>;

export interface SetupCommandOptions {
  stdout?: CliWriter;
  confirm?: ConfirmPrompt;
  home?: string;
  platform?: NodeJS.Platform;
}

export interface AkiflowMcpEntry {
  readonly command: string;
  readonly args: readonly string[];
}

export const AKIFLOW_MCP_ENTRY: AkiflowMcpEntry = Object.freeze({
  command: "af",
  args: Object.freeze(["--mcp"]),
});

export interface ResolveTargetContext {
  home?: string;
  platform?: NodeJS.Platform;
}

export function resolveSetupTarget(name: string, ctx: ResolveTargetContext = {}): SetupTarget {
  const home = ctx.home ?? homedir();
  const platform = ctx.platform ?? process.platform;

  switch (name) {
    case "claude-code":
      return {
        name: "claude-code",
        displayName: "Claude Code",
        configPath: join(home, ".claude.json"),
      };
    case "cursor":
      return {
        name: "cursor",
        displayName: "Cursor",
        configPath: join(home, ".cursor", "mcp.json"),
      };
    case "claude-desktop":
      if (platform !== "darwin") {
        throw new ValidationError(
          `claude-desktop setup is only supported on macOS (current platform: ${platform})`,
          "target",
        );
      }
      return {
        name: "claude-desktop",
        displayName: "Claude Desktop",
        configPath: join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
      };
    default:
      throw new ValidationError(`Unknown setup target: ${name}`, "target");
  }
}

export type RegisterState = "added" | "already" | "updated" | "cancelled" | "invalid-json";

export interface RegisterResult {
  state: RegisterState;
  existing?: unknown;
}

export async function registerMcpServer(
  configPath: string,
  entry: AkiflowMcpEntry,
  confirm: ConfirmPrompt,
): Promise<RegisterResult> {
  let raw: string | null = null;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  let parsed: Record<string, unknown> = {};
  if (raw !== null && raw.trim() !== "") {
    try {
      const candidate: unknown = JSON.parse(raw);
      if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
        return { state: "invalid-json" };
      }
      parsed = candidate as Record<string, unknown>;
    } catch {
      return { state: "invalid-json" };
    }
  }

  const mcpServersRaw = parsed.mcpServers;
  const existingServers: Record<string, unknown> =
    typeof mcpServersRaw === "object" && mcpServersRaw !== null && !Array.isArray(mcpServersRaw)
      ? (mcpServersRaw as Record<string, unknown>)
      : {};

  const existingAkiflow = existingServers.akiflow;

  if (existingAkiflow !== undefined && isSameEntry(existingAkiflow, entry)) {
    return { state: "already", existing: existingAkiflow };
  }

  if (existingAkiflow !== undefined) {
    const ok = await confirm(
      `Existing akiflow entry differs:\n${JSON.stringify(existingAkiflow, null, 2)}\nOverwrite with { command: "${entry.command}", args: ${JSON.stringify(entry.args)} }?`,
    );
    if (!ok) return { state: "cancelled", existing: existingAkiflow };
  }

  const nextEntry = { command: entry.command, args: [...entry.args] };
  parsed.mcpServers = { ...existingServers, akiflow: nextEntry };

  await atomicWriteJson(configPath, parsed);
  return {
    state: existingAkiflow === undefined ? "added" : "updated",
    existing: existingAkiflow,
  };
}

function isSameEntry(a: unknown, b: AkiflowMcpEntry): boolean {
  if (typeof a !== "object" || a === null || Array.isArray(a)) return false;
  const obj = a as Record<string, unknown>;
  if (obj.command !== b.command) return false;
  const args = obj.args;
  if (!Array.isArray(args)) return false;
  if (args.length !== b.args.length) return false;
  return args.every((v, i) => v === b.args[i]);
}

async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  const json = `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(tmp, json, "utf-8");
  await rename(tmp, path);
}

const defaultConfirm: ConfirmPrompt = async (message: string) => {
  const rl: ReadlineInterface = createInterface({ input: process.stdin, output: process.stderr });
  try {
    process.stderr.write(`${message} [y/N] `);
    return await new Promise<boolean>((resolve) => {
      rl.question("", (ans) => resolve(/^y(es)?$/i.test(ans.trim())));
    });
  } finally {
    rl.close();
  }
};

export async function runSetupTarget(
  target: SetupTarget,
  components: SetupCommandComponents,
  stdout: CliWriter,
  confirm: ConfirmPrompt,
): Promise<void> {
  const result = await registerMcpServer(target.configPath, AKIFLOW_MCP_ENTRY, confirm);

  if (result.state === "invalid-json") {
    throw new ValidationError(
      `Config file at ${target.configPath} contains invalid JSON. Fix or remove it manually and retry.`,
      "configPath",
    );
  }

  if (result.state === "cancelled") {
    stdout.write("Cancelled. No changes were made.\n");
    return;
  }

  if (result.state === "already") {
    stdout.write(`Already registered: ${target.displayName} (${target.configPath})\n`);
    await printAuthStatus(components, stdout);
    return;
  }

  const verb = result.state === "updated" ? "Updated" : "Registered";
  stdout.write(`✓ ${verb} akiflow MCP server in ${target.configPath}\n`);
  stdout.write(`  Target: ${target.displayName}\n`);
  stdout.write(`  Command: ${AKIFLOW_MCP_ENTRY.command} ${AKIFLOW_MCP_ENTRY.args.join(" ")}\n`);
  await printAuthStatus(components, stdout);
  stdout.write(`\nNext: restart ${target.displayName} to pick up the new server.\n`);
}

async function printAuthStatus(components: SetupCommandComponents, stdout: CliWriter): Promise<void> {
  try {
    const status = await components.authService.getStatus();
    stdout.write(`  Auth status: ${formatAuthStatus(status)}\n`);
  } catch (err) {
    components.logger.warn("Could not determine auth status", err);
    stdout.write("  Auth status: unavailable\n");
  }
}

export function formatAuthStatus(status: AuthStatus): string {
  if (!status.isAuthenticated && !status.expiresAt) {
    return "not authenticated — run 'af auth'";
  }
  if (status.isExpired) {
    return "expired — run 'af auth refresh'";
  }
  return "active";
}

export function createSetupCommand(components: SetupCommandComponents, options: SetupCommandOptions = {}) {
  const stdout = options.stdout ?? process.stdout;
  const confirm = options.confirm ?? defaultConfirm;
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;

  const run = async (name: SetupTargetName) => {
    try {
      const target = resolveSetupTarget(name, { home, platform });
      await runSetupTarget(target, components, stdout, confirm);
    } catch (err) {
      handleCliError(err, components.logger);
    }
  };

  return defineCommand({
    meta: {
      name: "setup",
      description: "Register Akiflow MCP server in AI editor configs",
    },
    subCommands: {
      "claude-code": defineCommand({
        meta: { name: "claude-code", description: "Register in Claude Code (~/.claude.json)" },
        async run() {
          await run("claude-code");
        },
      }),
      cursor: defineCommand({
        meta: { name: "cursor", description: "Register in Cursor (~/.cursor/mcp.json)" },
        async run() {
          await run("cursor");
        },
      }),
      "claude-desktop": defineCommand({
        meta: { name: "claude-desktop", description: "Register in Claude Desktop (macOS only)" },
        async run() {
          await run("claude-desktop");
        },
      }),
    },
  });
}
