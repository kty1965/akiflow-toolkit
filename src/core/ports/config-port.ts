import type { LogLevel } from "./logger-port.ts";

export interface ConfigPort {
  logLevel(): LogLevel;
  logFormat(): "text" | "json";
  cacheTtlSeconds(): number;
  apiBaseUrl(): string;
  authBaseUrl(): string;
  cdpPort(): number;
  configDir(): string;
  cacheDir(): string;
}
