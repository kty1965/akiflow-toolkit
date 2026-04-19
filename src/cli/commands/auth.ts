// ---------------------------------------------------------------------------
// af auth — subcommands for authentication (ADR-0003, ADR-0008)
// Commands: `af auth` (auto), `af auth status`, `af auth logout`,
//           `af auth refresh`, `af auth --manual`
// ---------------------------------------------------------------------------

import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { ValidationError } from "@core/errors/index.ts";
import type { LoggerPort } from "@core/ports/logger-port.ts";
import type { AuthStatus, Credentials } from "@core/types.ts";
import { defineCommand } from "citty";
import { handleCliError } from "../app.ts";

export interface AuthServiceApi {
  authenticate(): Promise<Credentials>;
  setManualToken(refreshToken: string): Promise<Credentials>;
  getStatus(): Promise<AuthStatus>;
  logout(): Promise<void>;
}

export interface AuthCommandComponents {
  authService: AuthServiceApi;
  logger: LoggerPort;
}

export interface CliWriter {
  write(chunk: string): boolean;
}

export type StdinReader = () => Promise<string>;

const AUTH_SUBCOMMAND_NAMES = new Set(["status", "logout", "refresh"]);

const defaultStdinReader: StdinReader = async () => {
  const rl: ReadlineInterface = createInterface({ input: process.stdin, output: process.stderr });
  try {
    process.stderr.write("Paste refresh_token and press Enter:\n");
    return await new Promise<string>((resolve) => {
      rl.question("> ", (answer) => resolve(answer));
    });
  } finally {
    rl.close();
  }
};

export interface AuthCommandOptions {
  readStdin?: StdinReader;
  stdout?: CliWriter;
}

export function createAuthCommand(components: AuthCommandComponents, options: AuthCommandOptions = {}) {
  const readStdin = options.readStdin ?? defaultStdinReader;
  const stdout = options.stdout ?? process.stdout;

  const autoCmd = async () => {
    try {
      const creds = await components.authService.authenticate();
      printAuthSuccess(stdout, creds);
    } catch (err) {
      handleCliError(err, components.logger);
    }
  };

  const manualCmd = async () => {
    try {
      const raw = (await readStdin()).trim();
      if (!raw) throw new ValidationError("refresh_token input was empty", "refresh_token");
      const creds = await components.authService.setManualToken(raw);
      printAuthSuccess(stdout, creds);
    } catch (err) {
      handleCliError(err, components.logger);
    }
  };

  return defineCommand({
    meta: { name: "auth", description: "Manage Akiflow authentication" },
    args: {
      manual: {
        type: "boolean",
        description: "Enter refresh_token manually via stdin",
        default: false,
      },
    },
    subCommands: {
      status: defineCommand({
        meta: { name: "status", description: "Show current authentication status" },
        async run() {
          await statusCommand(components.authService, stdout);
        },
      }),
      logout: defineCommand({
        meta: { name: "logout", description: "Remove stored credentials" },
        async run() {
          await logoutCommand(components.authService, stdout);
        },
      }),
      refresh: defineCommand({
        meta: { name: "refresh", description: "Force re-authentication (logout + authenticate)" },
        async run() {
          await refreshCommand(components.authService, stdout, components.logger);
        },
      }),
    },
    async run({ args, rawArgs }) {
      if (rawArgs.some((a) => AUTH_SUBCOMMAND_NAMES.has(a))) return;
      if (args.manual) {
        await manualCmd();
      } else {
        await autoCmd();
      }
    },
  });
}

export async function statusCommand(authService: AuthServiceApi, stdout: CliWriter): Promise<void> {
  const status = await authService.getStatus();
  stdout.write(`${formatStatus(status)}\n`);
}

export async function logoutCommand(authService: AuthServiceApi, stdout: CliWriter): Promise<void> {
  await authService.logout();
  stdout.write("Logged out.\n");
}

export async function refreshCommand(
  authService: AuthServiceApi,
  stdout: CliWriter,
  logger: LoggerPort,
): Promise<void> {
  try {
    await authService.logout();
    const creds = await authService.authenticate();
    printAuthSuccess(stdout, creds);
  } catch (err) {
    handleCliError(err, logger);
  }
}

function printAuthSuccess(stdout: CliWriter, creds: Credentials): void {
  const expiresAt = new Date(creds.expiresAt).toISOString();
  stdout.write(`Authenticated (source=${creds.source}, expiresAt=${expiresAt}).\n`);
}

export function formatStatus(status: AuthStatus): string {
  if (!status.isAuthenticated && !status.expiresAt) {
    return "Not authenticated.";
  }
  const expiresAt = status.expiresAt ? new Date(status.expiresAt).toISOString() : "unknown";
  const state = status.isExpired ? "expired" : "active";
  return `Authenticated: ${state}\n  source: ${status.source ?? "unknown"}\n  expiresAt: ${expiresAt}`;
}
