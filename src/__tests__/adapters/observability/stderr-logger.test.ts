import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Mock } from "bun:test";
import { StderrLogger } from "../../../adapters/observability/stderr-logger.ts";

// ---------------------------------------------------------------------------
// Test helpers — capture process.stderr.write via spyOn (no type casts).
// ---------------------------------------------------------------------------

interface Captured {
  lines: string[];
  restore: () => void;
}

function captureStderr(): Captured {
  const lines: string[] = [];
  const spy: Mock<typeof process.stderr.write> = spyOn(process.stderr, "write");
  spy.mockImplementation((chunk: string | Uint8Array): boolean => {
    lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
    return true;
  });
  return {
    lines,
    restore: () => {
      spy.mockRestore();
    },
  };
}

describe("StderrLogger", () => {
  let captured: Captured;

  beforeEach(() => {
    captured = captureStderr();
  });

  afterEach(() => {
    captured.restore();
  });

  test("writes to process.stderr in text format by default", () => {
    // Given: a logger at info level, text format
    const logger = new StderrLogger("info", false);

    // When: logging an info message
    logger.info("hello world");

    // Then: output went to stderr with bracketed level prefix
    expect(captured.lines.length).toBe(1);
    expect(captured.lines[0]).toContain("[info]");
    expect(captured.lines[0]).toContain("hello world");
    expect(captured.lines[0].endsWith("\n")).toBe(true);
  });

  test("filters messages below configured level", () => {
    // Given: a logger at warn level
    const logger = new StderrLogger("warn", false);

    // When: info/debug are emitted
    logger.debug("debug-msg");
    logger.info("info-msg");
    logger.warn("warn-msg");
    logger.error("error-msg");

    // Then: only warn and error appear
    const text = captured.lines.join("");
    expect(text).not.toContain("debug-msg");
    expect(text).not.toContain("info-msg");
    expect(text).toContain("warn-msg");
    expect(text).toContain("error-msg");
  });

  test("silent level suppresses all output", () => {
    // Given: a silent logger
    const logger = new StderrLogger("silent", false);

    // When: any level is logged
    logger.error("should-not-appear");

    // Then: stderr is untouched
    expect(captured.lines.length).toBe(0);
  });

  test("writes JSON entries when json=true", () => {
    // Given: a JSON-format logger
    const logger = new StderrLogger("info", true);

    // When: logging with context
    logger.info("hello", { user: "alice" });

    // Then: single line of valid JSON with expected fields
    expect(captured.lines.length).toBe(1);
    const parsed = JSON.parse(captured.lines[0].trim());
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("hello");
    expect(parsed.context).toEqual({ user: "alice" });
    expect(parsed.ts).toBeDefined();
  });

  test("masks JWT patterns in message string", () => {
    // Given: a JSON logger
    const logger = new StderrLogger("info", true);
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyIn0.signature123abc";

    // When: a JWT is included in the message
    logger.info(`token=${jwt}`);

    // Then: the JWT is replaced with ***
    const parsed = JSON.parse(captured.lines[0].trim());
    expect(parsed.msg).toBe("token=***");
  });

  test("masks refresh_token def50200 patterns", () => {
    // Given: a text logger
    const logger = new StderrLogger("debug", false);
    const refresh = "def50200abcdef0123456789abcdef0123456789abcd";

    // When: a refresh token value appears in the message
    logger.debug(`refresh=${refresh}`);

    // Then: the value is masked
    expect(captured.lines[0]).toContain("refresh=***");
    expect(captured.lines[0]).not.toContain(refresh);
  });

  test("masks sensitive keys in context payload", () => {
    // Given: a JSON logger
    const logger = new StderrLogger("info", true);

    // When: context includes sensitive keys
    logger.info("auth", {
      accessToken: "raw-secret-1",
      refreshToken: "raw-secret-2",
      password: "hunter2",
      nested: { token: "raw-secret-3", keep: "visible" },
    });

    // Then: sensitive keys are masked; non-sensitive keys remain
    const parsed = JSON.parse(captured.lines[0].trim());
    expect(parsed.context.accessToken).toBe("***");
    expect(parsed.context.refreshToken).toBe("***");
    expect(parsed.context.password).toBe("***");
    expect(parsed.context.nested.token).toBe("***");
    expect(parsed.context.nested.keep).toBe("visible");
  });

  test("captures Error argument with name/message on error()", () => {
    // Given: a JSON logger
    const logger = new StderrLogger("info", true);

    // When: an Error is passed as extra arg
    logger.error("boom", new Error("kaboom"));

    // Then: entry.err has the error details
    const parsed = JSON.parse(captured.lines[0].trim());
    expect(parsed.err).toBeDefined();
    expect(parsed.err.message).toBe("kaboom");
    expect(parsed.level).toBe("error");
  });
});
