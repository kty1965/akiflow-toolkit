// ---------------------------------------------------------------------------
// StderrLogger — LoggerPort implementation (ADR-0009)
// All output goes to process.stderr to keep stdout clean for CLI results
// and MCP JSON-RPC. Masks JWT/refresh_token patterns in context.
// ---------------------------------------------------------------------------

import type { LogLevel, LoggerPort } from "../../core/ports/logger-port.ts";

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  silent: 100,
};

const MASK_KEYS = new Set([
  "accessToken",
  "refreshToken",
  "access_token",
  "refresh_token",
  "token",
  "Authorization",
  "authorization",
  "password",
]);

const MASK_PATTERNS: RegExp[] = [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, /def50200[a-f0-9]{20,}/g];

function maskString(value: string): string {
  let out = value;
  for (const p of MASK_PATTERNS) out = out.replace(p, "***");
  return out;
}

function mask(value: unknown): unknown {
  if (typeof value === "string") return maskString(value);
  if (Array.isArray(value)) return value.map(mask);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = MASK_KEYS.has(k) ? "***" : mask(v);
    }
    return out;
  }
  return value;
}

interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  context?: Record<string, unknown>;
  err?: { name: string; message: string; stack?: string };
}

function normalizeArgs(args: unknown[]): { err?: Error; context?: Record<string, unknown> } {
  let err: Error | undefined;
  const contexts: Record<string, unknown>[] = [];
  for (const arg of args) {
    if (arg === undefined || arg === null) continue;
    if (arg instanceof Error) {
      err = arg;
      continue;
    }
    if (typeof arg === "object") {
      contexts.push(arg as Record<string, unknown>);
    }
  }
  const merged = contexts.length === 0 ? undefined : Object.assign({}, ...contexts);
  return { err, context: merged };
}

export class StderrLogger implements LoggerPort {
  private readonly level: LogLevel;
  private readonly json: boolean;

  constructor(level?: LogLevel, json?: boolean) {
    this.level = level ?? (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info";
    this.json = json ?? process.env.LOG_FORMAT === "json";
  }

  trace(message: string, ...args: unknown[]): void {
    this.write("trace", message, args);
  }

  debug(message: string, ...args: unknown[]): void {
    this.write("debug", message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this.write("info", message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.write("warn", message, args);
  }

  error(message: string, ...args: unknown[]): void {
    this.write("error", message, args);
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
  }

  private write(level: LogLevel, message: string, args: unknown[]): void {
    if (!this.shouldLog(level)) return;

    const { err, context } = normalizeArgs(args);
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      msg: maskString(message),
    };
    if (context) entry.context = mask(context) as Record<string, unknown>;
    if (err) {
      entry.err = {
        name: err.name,
        message: maskString(err.message),
        stack: err.stack ? maskString(err.stack) : undefined,
      };
    }

    const line = this.json ? JSON.stringify(entry) : this.formatText(entry);
    process.stderr.write(`${line}\n`);
  }

  private formatText(entry: LogEntry): string {
    const base = `[${entry.level}] ${entry.ts} ${entry.msg}`;
    const parts: string[] = [base];
    if (entry.context) parts.push(JSON.stringify(entry.context));
    if (entry.err) {
      parts.push(`${entry.err.name}: ${entry.err.message}`);
      if (entry.err.stack) parts.push(entry.err.stack);
    }
    return parts.join(" ");
  }
}
