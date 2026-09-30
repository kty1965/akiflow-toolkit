// ---------------------------------------------------------------------------
// af setup — register the akiflow MCP server in AI editor configs (TASK-17)
// Subcommands: `af setup claude-code|cursor|claude-desktop`
// `af setup claude-code --http` points Claude Code at the shared HTTP server.
// Read, merge, atomic-write to preserve existing user config.
// ---------------------------------------------------------------------------

import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { ValidationError } from "@core/errors/index.ts";
import type { LoggerPort } from "@core/ports/logger-port.ts";
import type { AuthStatus } from "@core/types.ts";
import { MCP_HTTP_DEFAULT_HOST, MCP_HTTP_PATH, resolveMcpHttpPort } from "@mcp/http-server.ts";
import { readOrCreateHttpToken } from "@mcp/http-token.ts";
import { defineCommand } from "citty";
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
  config: { configDir: string };
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

export interface AkiflowStdioEntry {
  readonly command: string;
  readonly args: readonly string[];
}

export interface AkiflowHttpEntry {
  readonly type: "http";
  readonly url: string;
  readonly headers: Readonly<{ Authorization: string }>;
}

export type AkiflowMcpEntry = AkiflowStdioEntry | AkiflowHttpEntry;

export const AKIFLOW_MCP_ENTRY: AkiflowStdioEntry = Object.freeze({
  command: "af",
  args: Object.freeze(["--mcp"]),
});

export function buildHttpEntry(token: string, port: number = resolveMcpHttpPort()): AkiflowHttpEntry {
  return {
    type: "http",
    url: `http://${MCP_HTTP_DEFAULT_HOST}:${port}${MCP_HTTP_PATH}`,
    headers: { Authorization: `Bearer ${token}` },
  };
}

function isHttpEntry(entry: AkiflowMcpEntry): entry is AkiflowHttpEntry {
  return "type" in entry && entry.type === "http";
}

function toConfigEntry(entry: AkiflowMcpEntry): Record<string, unknown> {
  if (isHttpEntry(entry)) return { type: entry.type, url: entry.url, headers: { ...entry.headers } };
  return { command: entry.command, args: [...entry.args] };
}

export function describeEntry(entry: AkiflowMcpEntry): string {
  return isHttpEntry(entry) ? `http ${entry.url}` : `${entry.command} ${entry.args.join(" ")}`;
}

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
      `Existing akiflow entry differs:\n${JSON.stringify(existingAkiflow, null, 2)}\nOverwrite with ${describeEntry(entry)}?`,
    );
    if (!ok) return { state: "cancelled", existing: existingAkiflow };
  }

  parsed.mcpServers = { ...existingServers, akiflow: toConfigEntry(entry) };

  // The http entry embeds the bearer token, so never leave it group/world readable.
  const mode = await existingMode(configPath);
  await atomicWriteJson(configPath, parsed, isHttpEntry(entry) ? mode & 0o700 : mode);
  return {
    state: existingAkiflow === undefined ? "added" : "updated",
    existing: existingAkiflow,
  };
}

function isSameEntry(a: unknown, b: AkiflowMcpEntry): boolean {
  if (typeof a !== "object" || a === null || Array.isArray(a)) return false;
  const obj = a as Record<string, unknown>;
  if (isHttpEntry(b)) {
    const headers = obj.headers as Record<string, unknown> | undefined;
    return obj.type === b.type && obj.url === b.url && headers?.Authorization === b.headers.Authorization;
  }
  if (obj.command !== b.command) return false;
  const args = obj.args;
  if (!Array.isArray(args)) return false;
  if (args.length !== b.args.length) return false;
  return args.every((v, i) => v === b.args[i]);
}

async function existingMode(path: string): Promise<number> {
  try {
    return (await stat(path)).mode & 0o777;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return 0o600;
  }
}

async function atomicWriteJson(path: string, data: unknown, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  const json = `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(tmp, json, { encoding: "utf-8", mode });
  // writeFile's mode is filtered by the umask; chmod applies it exactly.
  await chmod(tmp, mode);
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
  entry: AkiflowMcpEntry = AKIFLOW_MCP_ENTRY,
): Promise<void> {
  const result = await registerMcpServer(target.configPath, entry, confirm);

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
  stdout.write(`  ${isHttpEntry(entry) ? "Server" : "Command"}: ${describeEntry(entry)}\n`);
  await printAuthStatus(components, stdout);
  if (isHttpEntry(entry)) {
    stdout.write("\nThe HTTP server must be running: 'af --mcp --http' (see README for the systemd unit).\n");
  }
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

  const run = async (name: SetupTargetName, http = false) => {
    try {
      const target = resolveSetupTarget(name, { home, platform });
      const entry = http ? buildHttpEntry(await readOrCreateHttpToken(components.config.configDir)) : undefined;
      await runSetupTarget(target, components, stdout, confirm, entry);
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
        args: {
          http: {
            type: "boolean",
            description: "Use the shared HTTP server (af --mcp --http) instead of stdio",
            default: false,
          },
        },
        async run({ args }) {
          await run("claude-code", args.http);
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
