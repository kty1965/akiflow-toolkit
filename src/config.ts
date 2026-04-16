// ---------------------------------------------------------------------------
// Config loader — ADR-0012 (layered env + XDG defaults)
// Immutable AppConfig resolved from env vars with sensible defaults.
// ---------------------------------------------------------------------------

import { homedir } from "node:os";
import { join } from "node:path";
import type { LogLevel } from "./core/ports/logger-port.ts";

const APP_NAME = "akiflow";
const DEFAULT_API_BASE_URL = "https://api.akiflow.com";
const DEFAULT_AUTH_BASE_URL = "https://web.akiflow.com";
const DEFAULT_CDP_PORT = 9222;
const DEFAULT_CACHE_TTL = 30;
const VALID_LEVELS: readonly LogLevel[] = ["trace", "debug", "info", "warn", "error", "silent"];

export interface AppConfig {
  readonly logLevel: LogLevel;
  readonly logFormat: "text" | "json";
  readonly configDir: string;
  readonly cacheDir: string;
  readonly apiBaseUrl: string;
  readonly authBaseUrl: string;
  readonly cdpPort: number;
  readonly cacheTtlSeconds: number;
}

export interface LoadConfigOptions {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
}

function resolveConfigDir(env: NodeJS.ProcessEnv): string {
  if (env.AF_CONFIG_DIR) return env.AF_CONFIG_DIR;
  const xdg = env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdg, APP_NAME);
}

function resolveCacheDir(env: NodeJS.ProcessEnv): string {
  if (env.AF_CACHE_DIR) return env.AF_CACHE_DIR;
  const xdg = env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
  return join(xdg, APP_NAME);
}

function parseLogLevel(value: string | undefined, fallback: LogLevel): LogLevel {
  if (!value) return fallback;
  return (VALID_LEVELS as readonly string[]).includes(value) ? (value as LogLevel) : fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;
  const isMcp = argv.includes("--mcp");

  const fallbackLevel: LogLevel = env.AF_DEBUG === "1" ? "debug" : isMcp ? "warn" : "info";
  const logLevel = parseLogLevel(env.LOG_LEVEL, fallbackLevel);
  const logFormat: "text" | "json" = env.LOG_FORMAT === "json" ? "json" : "text";

  const config: AppConfig = {
    logLevel,
    logFormat,
    configDir: resolveConfigDir(env),
    cacheDir: resolveCacheDir(env),
    apiBaseUrl: env.AF_API_BASE_URL ?? DEFAULT_API_BASE_URL,
    authBaseUrl: env.AF_AUTH_BASE_URL ?? DEFAULT_AUTH_BASE_URL,
    cdpPort: parseNumber(env.AF_CDP_PORT, DEFAULT_CDP_PORT),
    cacheTtlSeconds: parseNumber(env.AF_CACHE_TTL_SECONDS, DEFAULT_CACHE_TTL),
  };

  return Object.freeze(config);
}
