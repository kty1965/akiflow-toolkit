import { describe, expect, test } from "bun:test";
import type {
  AuthPort,
  BrowserDataPort,
  CachePort,
  ConfigPort,
  LoggerPort,
  LogLevel,
  TaskPort,
} from "@core/ports/index.ts";

describe("core/ports barrel export", () => {
  test("AuthPort interface is importable", () => {
    // Given: AuthPort type import
    // Then: type-checking passes (runtime check: undefined won't throw)
    const port: AuthPort | undefined = undefined;
    expect(port).toBeUndefined();
  });

  test("TaskPort interface is importable", () => {
    const port: TaskPort | undefined = undefined;
    expect(port).toBeUndefined();
  });

  test("CachePort interface is importable", () => {
    const port: CachePort | undefined = undefined;
    expect(port).toBeUndefined();
  });

  test("BrowserDataPort interface is importable", () => {
    const port: BrowserDataPort | undefined = undefined;
    expect(port).toBeUndefined();
  });

  test("LoggerPort interface is importable", () => {
    const port: LoggerPort | undefined = undefined;
    expect(port).toBeUndefined();
  });

  test("ConfigPort interface is importable", () => {
    const port: ConfigPort | undefined = undefined;
    expect(port).toBeUndefined();
  });

  test("LogLevel type accepts valid values", () => {
    // Given: all valid LogLevel values
    const levels: LogLevel[] = ["trace", "debug", "info", "warn", "error", "silent"];

    // Then: each value is in the expected set
    for (const level of levels) {
      expect(["trace", "debug", "info", "warn", "error", "silent"]).toContain(level);
    }
  });
});
