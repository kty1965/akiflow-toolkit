import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type CliWriter,
  type CompletionCommandComponents,
  createCompletionCommand,
  generateCompletionScript,
  USAGE_MESSAGE,
} from "../../../cli/commands/completion.ts";
import { ValidationError } from "../../../core/errors/index.ts";
import type { LoggerPort } from "../../../core/ports/logger-port.ts";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function silentLogger(): LoggerPort {
  return {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function capturingStream(): { stream: CliWriter; chunks: string[] } {
  const chunks: string[] = [];
  return {
    stream: {
      write(chunk: string) {
        chunks.push(chunk);
        return true;
      },
    },
    chunks,
  };
}

// ---------------------------------------------------------------------------
// process.exit stub — handleCliError calls process.exit on AkiflowError.
// We replace it with a function that throws a sentinel to avoid terminating
// the test runner and to allow asserting the exit code.
// ---------------------------------------------------------------------------

class ExitCalled extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
  }
}

type ExitFn = typeof process.exit;
let originalExit: ExitFn | null = null;

beforeEach(() => {
  originalExit = process.exit;
  process.exit = ((code?: number) => {
    throw new ExitCalled(typeof code === "number" ? code : 0);
  }) as ExitFn;
});

afterEach(() => {
  if (originalExit) process.exit = originalExit;
});

// ---------------------------------------------------------------------------
// generateCompletionScript — pure function contract
// ---------------------------------------------------------------------------

describe("generateCompletionScript", () => {
  test("bash output contains _af_completion function and `complete -F` registration", () => {
    // Given: the bash target
    // When: generating the script
    const script = generateCompletionScript("bash");

    // Then: it defines _af_completion and registers via `complete -F`
    expect(script).toContain("_af_completion");
    expect(script).toContain("complete -F _af_completion af");
    expect(script).toContain("COMPREPLY=");
  });

  test("zsh output declares #compdef and registers via compdef", () => {
    // Given: the zsh target
    // When: generating the script
    const script = generateCompletionScript("zsh");

    // Then: it has the #compdef header and the compdef registration
    expect(script.startsWith("#compdef af")).toBe(true);
    expect(script).toContain("compdef _af af");
    expect(script).toContain("_arguments");
  });

  test("fish output uses `complete -c af` declarations", () => {
    // Given: the fish target
    // When: generating the script
    const script = generateCompletionScript("fish");

    // Then: it contains fish-style `complete -c af` lines
    expect(script).toContain("complete -c af");
    expect(script).toContain("__fish_use_subcommand");
    expect(script).toContain("__fish_seen_subcommand_from");
  });

  test("each shell script exposes top-level subcommands (auth, add, ls, setup, completion)", () => {
    // Given: the three supported shells
    const shells = ["bash", "zsh", "fish"] as const;
    for (const shell of shells) {
      // When: generating the script
      const script = generateCompletionScript(shell);

      // Then: it includes the core command names so completion is useful
      expect(script).toContain("auth");
      expect(script).toContain("add");
      expect(script).toContain("ls");
      expect(script).toContain("setup");
      expect(script).toContain("completion");
    }
  });

  test("unknown shell throws ValidationError (exit code 4)", () => {
    // Given: an unsupported shell name
    // When / Then: generator rejects it with ValidationError
    expect(() => generateCompletionScript("powershell")).toThrow(ValidationError);
    try {
      generateCompletionScript("powershell");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const ve = err as ValidationError;
      expect(ve.code).toBe("VALIDATION");
      expect(ve.field).toBe("shell");
    }
  });
});

// ---------------------------------------------------------------------------
// createCompletionCommand — wires args, stdout, and usage/error paths
// ---------------------------------------------------------------------------

describe("createCompletionCommand", () => {
  test("writes bash script to stdout when invoked with 'bash'", async () => {
    // Given: the completion command with capturing stdout/stderr
    const components: CompletionCommandComponents = { logger: silentLogger() };
    const { stream: stdout, chunks: stdoutChunks } = capturingStream();
    const { stream: stderr, chunks: stderrChunks } = capturingStream();
    const cmd = createCompletionCommand(components, { stdout, stderr });

    // When: running with shell=bash
    await cmd.run?.({ rawArgs: ["bash"], args: { _: ["bash"], shell: "bash" }, cmd });

    // Then: bash script goes to stdout, nothing to stderr
    const out = stdoutChunks.join("");
    expect(out).toContain("_af_completion");
    expect(out).toContain("complete -F _af_completion af");
    expect(stderrChunks.join("")).toBe("");
  });

  test("writes zsh script to stdout when invoked with 'zsh'", async () => {
    // Given: the completion command
    const components: CompletionCommandComponents = { logger: silentLogger() };
    const { stream: stdout, chunks: stdoutChunks } = capturingStream();
    const { stream: stderr } = capturingStream();
    const cmd = createCompletionCommand(components, { stdout, stderr });

    // When: running with shell=zsh
    await cmd.run?.({ rawArgs: ["zsh"], args: { _: ["zsh"], shell: "zsh" }, cmd });

    // Then: zsh script goes to stdout
    const out = stdoutChunks.join("");
    expect(out).toContain("#compdef af");
    expect(out).toContain("compdef _af af");
  });

  test("writes fish script to stdout when invoked with 'fish'", async () => {
    // Given: the completion command
    const components: CompletionCommandComponents = { logger: silentLogger() };
    const { stream: stdout, chunks: stdoutChunks } = capturingStream();
    const { stream: stderr } = capturingStream();
    const cmd = createCompletionCommand(components, { stdout, stderr });

    // When: running with shell=fish
    await cmd.run?.({ rawArgs: ["fish"], args: { _: ["fish"], shell: "fish" }, cmd });

    // Then: fish script goes to stdout
    const out = stdoutChunks.join("");
    expect(out).toContain("complete -c af");
  });

  test("no shell argument writes usage to stderr and exits with code 4", async () => {
    // Given: the completion command invoked without a shell argument
    const components: CompletionCommandComponents = { logger: silentLogger() };
    const { stream: stdout, chunks: stdoutChunks } = capturingStream();
    const { stream: stderr, chunks: stderrChunks } = capturingStream();
    const cmd = createCompletionCommand(components, { stdout, stderr });

    // When: running with no positional arg — handleCliError throws via stubbed process.exit
    let caught: unknown;
    try {
      await cmd.run?.({ rawArgs: [], args: { _: [] }, cmd });
    } catch (err) {
      caught = err;
    }

    // Then: usage message was written to stderr, stdout untouched, exit code 4
    expect(stderrChunks.join("")).toBe(USAGE_MESSAGE);
    expect(stdoutChunks.join("")).toBe("");
    expect(caught).toBeInstanceOf(ExitCalled);
    expect((caught as ExitCalled).code).toBe(4);
  });

  test("unknown shell argument exits with code 4 and leaves stdout clean", async () => {
    // Given: the completion command
    const components: CompletionCommandComponents = { logger: silentLogger() };
    const { stream: stdout, chunks: stdoutChunks } = capturingStream();
    const { stream: stderr } = capturingStream();
    const cmd = createCompletionCommand(components, { stdout, stderr });

    // When: running with an unsupported shell name
    let caught: unknown;
    try {
      await cmd.run?.({
        rawArgs: ["powershell"],
        args: { _: ["powershell"], shell: "powershell" },
        cmd,
      });
    } catch (err) {
      caught = err;
    }

    // Then: nothing is written to stdout and exit code is 4 (VALIDATION)
    expect(stdoutChunks.join("")).toBe("");
    expect(caught).toBeInstanceOf(ExitCalled);
    expect((caught as ExitCalled).code).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// USAGE_MESSAGE — reminds users to prefer `>>` over `>` (L2 fix)
// ---------------------------------------------------------------------------

describe("USAGE_MESSAGE", () => {
  test("recommends `>>` append redirection for bash and zsh (guards against L2 bug)", () => {
    // Given / When: the exported usage banner
    // Then: it names all three shells and uses `>>` for bash/zsh install lines
    expect(USAGE_MESSAGE).toContain("af completion bash >> ~/.bashrc");
    expect(USAGE_MESSAGE).toContain("af completion zsh >> ~/.zshrc");
    expect(USAGE_MESSAGE).toContain("af completion fish");
  });
});
