import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AKIFLOW_MCP_ENTRY,
  type CliWriter,
  type ConfirmPrompt,
  createSetupCommand,
  formatAuthStatus,
  registerMcpServer,
  resolveSetupTarget,
  runSetupTarget,
  type SetupAuthService,
  type SetupCommandComponents,
} from "@cli/commands/setup.ts";
import { ValidationError } from "@core/errors/index.ts";
import type { LoggerPort } from "@core/ports/logger-port.ts";
import type { AuthStatus } from "@core/types.ts";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function createSilentLogger(): LoggerPort {
  return {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function createCapturingStream(): { stream: CliWriter; chunks: string[] } {
  const chunks: string[] = [];
  const stream: CliWriter = {
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
  };
  return { stream, chunks };
}

function yesConfirm(): ConfirmPrompt {
  return async () => true;
}

function noConfirm(): ConfirmPrompt {
  return async () => false;
}

function rejectingConfirm(): ConfirmPrompt {
  return async () => {
    throw new Error("confirm should not be called");
  };
}

function createComponents(status?: Partial<AuthStatus>): SetupCommandComponents {
  const service: SetupAuthService = {
    async getStatus(): Promise<AuthStatus> {
      return {
        isAuthenticated: false,
        expiresAt: null,
        source: null,
        isExpired: false,
        ...status,
      };
    },
  };
  return {
    authService: service,
    logger: createSilentLogger(),
  };
}

// ---------------------------------------------------------------------------
// Scratch directory — each test gets a fresh HOME
// ---------------------------------------------------------------------------

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "af-setup-test-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// resolveSetupTarget
// ---------------------------------------------------------------------------

describe("resolveSetupTarget", () => {
  test("maps 'claude-code' to ~/.claude.json", () => {
    // Given: a home path
    // When: resolving claude-code
    const target = resolveSetupTarget("claude-code", { home: "/tmp/home", platform: "linux" });
    // Then: configPath is ~/.claude.json
    expect(target.configPath).toBe("/tmp/home/.claude.json");
    expect(target.name).toBe("claude-code");
  });

  test("maps 'cursor' to ~/.cursor/mcp.json", () => {
    // Given/When
    const target = resolveSetupTarget("cursor", { home: "/tmp/home", platform: "linux" });
    // Then
    expect(target.configPath).toBe("/tmp/home/.cursor/mcp.json");
  });

  test("maps 'claude-desktop' on darwin to Claude Desktop config", () => {
    // Given: macOS platform
    // When: resolving claude-desktop
    const target = resolveSetupTarget("claude-desktop", { home: "/tmp/home", platform: "darwin" });
    // Then: configPath is under Library/Application Support/Claude
    expect(target.configPath).toBe("/tmp/home/Library/Application Support/Claude/claude_desktop_config.json");
  });

  test("rejects 'claude-desktop' on non-darwin platforms", () => {
    // Given: Linux platform
    // When/Then: resolution throws ValidationError
    expect(() => resolveSetupTarget("claude-desktop", { home: "/tmp/home", platform: "linux" })).toThrow(
      ValidationError,
    );
  });

  test("rejects unknown target names", () => {
    // Given/When/Then
    expect(() => resolveSetupTarget("vscode", { home: "/tmp/home" })).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// registerMcpServer
// ---------------------------------------------------------------------------

describe("registerMcpServer", () => {
  test("creates config file with mcpServers.akiflow when file is absent", async () => {
    // Given: no config file exists
    const configPath = join(home, "nested", "mcp.json");

    // When: registering the MCP server
    const result = await registerMcpServer(configPath, AKIFLOW_MCP_ENTRY, rejectingConfirm());

    // Then: file is created with akiflow entry and parent dir is auto-created
    expect(result.state).toBe("added");
    const written = JSON.parse(await readFile(configPath, "utf-8"));
    expect(written).toEqual({
      mcpServers: { akiflow: { command: "af", args: ["--mcp"] } },
    });
  });

  test("preserves existing keys when config lacks mcpServers", async () => {
    // Given: a config with unrelated fields but no mcpServers
    const configPath = join(home, ".claude.json");
    await writeFile(configPath, JSON.stringify({ theme: "dark", telemetry: { enabled: false } }, null, 2), "utf-8");

    // When: registering
    const result = await registerMcpServer(configPath, AKIFLOW_MCP_ENTRY, rejectingConfirm());

    // Then: unrelated fields are kept and mcpServers.akiflow is added
    expect(result.state).toBe("added");
    const written = JSON.parse(await readFile(configPath, "utf-8"));
    expect(written).toEqual({
      theme: "dark",
      telemetry: { enabled: false },
      mcpServers: { akiflow: { command: "af", args: ["--mcp"] } },
    });
  });

  test("returns 'already' when identical akiflow entry exists", async () => {
    // Given: file already contains the exact akiflow entry
    const configPath = join(home, ".claude.json");
    const original = { mcpServers: { akiflow: { command: "af", args: ["--mcp"] } } };
    await writeFile(configPath, JSON.stringify(original), "utf-8");

    // When: registering again
    const result = await registerMcpServer(configPath, AKIFLOW_MCP_ENTRY, rejectingConfirm());

    // Then: state is 'already' and file is unchanged
    expect(result.state).toBe("already");
    const written = await readFile(configPath, "utf-8");
    expect(JSON.parse(written)).toEqual(original);
  });

  test("asks for confirmation and overwrites when akiflow entry differs (accept)", async () => {
    // Given: a conflicting akiflow entry
    const configPath = join(home, ".claude.json");
    const existing = { mcpServers: { akiflow: { command: "node", args: ["/old/path"] } } };
    await writeFile(configPath, JSON.stringify(existing), "utf-8");

    // When: registering with confirm=yes
    const result = await registerMcpServer(configPath, AKIFLOW_MCP_ENTRY, yesConfirm());

    // Then: state is 'updated' and file contains the new entry
    expect(result.state).toBe("updated");
    expect(result.existing).toEqual({ command: "node", args: ["/old/path"] });
    const written = JSON.parse(await readFile(configPath, "utf-8"));
    expect(written.mcpServers.akiflow).toEqual({ command: "af", args: ["--mcp"] });
  });

  test("preserves original config when user rejects overwrite", async () => {
    // Given: a conflicting akiflow entry
    const configPath = join(home, ".claude.json");
    const existing = { mcpServers: { akiflow: { command: "node", args: ["/old"] }, other: { command: "x" } } };
    await writeFile(configPath, JSON.stringify(existing), "utf-8");

    // When: registering with confirm=no
    const result = await registerMcpServer(configPath, AKIFLOW_MCP_ENTRY, noConfirm());

    // Then: state is 'cancelled' and file is untouched
    expect(result.state).toBe("cancelled");
    const written = JSON.parse(await readFile(configPath, "utf-8"));
    expect(written).toEqual(existing);
  });

  test("returns 'invalid-json' without clobbering file on parse failure", async () => {
    // Given: corrupted JSON content
    const configPath = join(home, ".claude.json");
    const corrupted = "{ not json ";
    await writeFile(configPath, corrupted, "utf-8");

    // When: attempting to register
    const result = await registerMcpServer(configPath, AKIFLOW_MCP_ENTRY, rejectingConfirm());

    // Then: state is 'invalid-json' and original bytes remain
    expect(result.state).toBe("invalid-json");
    expect(await readFile(configPath, "utf-8")).toBe(corrupted);
  });

  test("treats empty file as empty object and adds mcpServers.akiflow", async () => {
    // Given: an empty config file
    const configPath = join(home, ".claude.json");
    await writeFile(configPath, "", "utf-8");

    // When: registering
    const result = await registerMcpServer(configPath, AKIFLOW_MCP_ENTRY, rejectingConfirm());

    // Then: akiflow entry is added
    expect(result.state).toBe("added");
    const written = JSON.parse(await readFile(configPath, "utf-8"));
    expect(written.mcpServers.akiflow).toEqual({ command: "af", args: ["--mcp"] });
  });
});

// ---------------------------------------------------------------------------
// runSetupTarget — user-visible output
// ---------------------------------------------------------------------------

describe("runSetupTarget", () => {
  test("prints success message including target + auth status on first add", async () => {
    // Given: a fresh home with no config and an authenticated service
    const target = resolveSetupTarget("claude-code", { home, platform: "linux" });
    const components: SetupCommandComponents = {
      authService: {
        async getStatus(): Promise<AuthStatus> {
          return {
            isAuthenticated: true,
            expiresAt: Date.now() + 60_000,
            source: "indexeddb",
            isExpired: false,
          };
        },
      },
      logger: createSilentLogger(),
    };
    const { stream, chunks } = createCapturingStream();

    // When: running the setup target
    await runSetupTarget(target, components, stream, rejectingConfirm());

    // Then: output contains ✓ Registered, the config path, and an active auth line
    const output = chunks.join("");
    expect(output).toContain("Registered akiflow MCP server");
    expect(output).toContain(target.configPath);
    expect(output).toContain("Auth status: active");
    expect(output).toContain("Next: restart Claude Code");
  });

  test("throws ValidationError when config file has invalid JSON", async () => {
    // Given: a corrupted file at the target path
    const target = resolveSetupTarget("claude-code", { home, platform: "linux" });
    await writeFile(target.configPath, "{oops", "utf-8");
    const components = createComponents();
    const { stream } = createCapturingStream();

    // When/Then: running rejects with ValidationError
    await expect(runSetupTarget(target, components, stream, rejectingConfirm())).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("reports 'Already registered' and does not rewrite file on identical entry", async () => {
    // Given: the target already contains the canonical akiflow entry
    const target = resolveSetupTarget("cursor", { home, platform: "linux" });
    const original = { mcpServers: { akiflow: { command: "af", args: ["--mcp"] } } };
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(home, ".cursor"), { recursive: true });
    await writeFile(target.configPath, JSON.stringify(original, null, 2), "utf-8");
    const components = createComponents();
    const { stream, chunks } = createCapturingStream();

    // When: running
    await runSetupTarget(target, components, stream, rejectingConfirm());

    // Then: stdout says "Already registered" and file content is unchanged
    expect(chunks.join("")).toContain("Already registered");
    const written = await readFile(target.configPath, "utf-8");
    expect(JSON.parse(written)).toEqual(original);
  });

  test("prints 'Cancelled' message when user declines overwrite", async () => {
    // Given: a differing akiflow entry
    const target = resolveSetupTarget("claude-code", { home, platform: "linux" });
    const existing = { mcpServers: { akiflow: { command: "other", args: [] } } };
    await writeFile(target.configPath, JSON.stringify(existing), "utf-8");
    const components = createComponents();
    const { stream, chunks } = createCapturingStream();

    // When: running with confirm=no
    await runSetupTarget(target, components, stream, noConfirm());

    // Then: stdout says "Cancelled" and file stays the same
    expect(chunks.join("")).toContain("Cancelled");
    expect(JSON.parse(await readFile(target.configPath, "utf-8"))).toEqual(existing);
  });
});

// ---------------------------------------------------------------------------
// createSetupCommand — routing through citty subCommands
// ---------------------------------------------------------------------------

describe("createSetupCommand", () => {
  test("exposes the three target subcommands", () => {
    // Given: a setup command with a stubbed home
    const cmd = createSetupCommand(createComponents(), {
      home,
      platform: "darwin",
      stdout: createCapturingStream().stream,
      confirm: yesConfirm(),
    });

    // When: inspecting command metadata (citty returns { subCommands })
    const subCommands = (cmd as { subCommands?: Record<string, unknown> }).subCommands ?? {};

    // Then: subCommands object contains claude-code, cursor, claude-desktop
    expect(Object.keys(subCommands).sort()).toEqual(["claude-code", "claude-desktop", "cursor"]);
  });
});

// ---------------------------------------------------------------------------
// formatAuthStatus
// ---------------------------------------------------------------------------

describe("formatAuthStatus", () => {
  test("reports 'not authenticated' for an empty status", () => {
    // Given/When/Then
    expect(
      formatAuthStatus({
        isAuthenticated: false,
        expiresAt: null,
        source: null,
        isExpired: false,
      }),
    ).toContain("not authenticated");
  });

  test("reports 'expired' when the stored credentials are past expiry", () => {
    // Given/When/Then
    expect(
      formatAuthStatus({
        isAuthenticated: false,
        expiresAt: 1000,
        source: "manual",
        isExpired: true,
      }),
    ).toContain("expired");
  });

  test("reports 'active' on a valid session", () => {
    // Given/When/Then
    expect(
      formatAuthStatus({
        isAuthenticated: true,
        expiresAt: Date.now() + 60_000,
        source: "indexeddb",
        isExpired: false,
      }),
    ).toBe("active");
  });
});
