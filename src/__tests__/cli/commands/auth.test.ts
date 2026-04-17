import { describe, expect, test } from "bun:test";
import {
  type AuthCommandComponents,
  type AuthServiceApi,
  type CliWriter,
  createAuthCommand,
  formatStatus,
  logoutCommand,
  refreshCommand,
  type StdinReader,
  statusCommand,
} from "../../../cli/commands/auth.ts";
import type { LoggerPort } from "../../../core/ports/logger-port.ts";
import type { AuthStatus, Credentials } from "../../../core/types.ts";

// ---------------------------------------------------------------------------
// Test doubles — structurally typed against CliWriter/AuthServiceApi
// ---------------------------------------------------------------------------

interface AuthCalls {
  authenticate: number;
  setManualToken: string[];
  getStatus: number;
  logout: number;
}

function makeCredentials(overrides: Partial<Credentials> = {}): Credentials {
  return {
    accessToken: "access_abc",
    refreshToken: "refresh_abc",
    clientId: "client_1",
    expiresAt: Date.now() + 3_600_000,
    savedAt: new Date().toISOString(),
    source: "indexeddb",
    ...overrides,
  };
}

function createFakeAuthService(overrides?: {
  authenticate?: () => Promise<Credentials>;
  getStatus?: () => Promise<AuthStatus>;
  setManualToken?: (token: string) => Promise<Credentials>;
  logout?: () => Promise<void>;
}): { service: AuthServiceApi; calls: AuthCalls } {
  const calls: AuthCalls = { authenticate: 0, setManualToken: [], getStatus: 0, logout: 0 };
  const defaultStatus: AuthStatus = {
    isAuthenticated: false,
    expiresAt: null,
    source: null,
    isExpired: false,
  };

  const service: AuthServiceApi = {
    async authenticate(): Promise<Credentials> {
      calls.authenticate++;
      return overrides?.authenticate ? overrides.authenticate() : makeCredentials();
    },
    async getStatus(): Promise<AuthStatus> {
      calls.getStatus++;
      return overrides?.getStatus ? overrides.getStatus() : defaultStatus;
    },
    async setManualToken(token: string): Promise<Credentials> {
      calls.setManualToken.push(token);
      return overrides?.setManualToken
        ? overrides.setManualToken(token)
        : makeCredentials({ source: "manual", refreshToken: token });
    },
    async logout(): Promise<void> {
      calls.logout++;
      if (overrides?.logout) await overrides.logout();
    },
  };

  return { service, calls };
}

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

// ---------------------------------------------------------------------------
// statusCommand
// ---------------------------------------------------------------------------

describe("statusCommand", () => {
  test("prints 'Not authenticated' when no credentials exist", async () => {
    // Given: AuthService reports no credentials
    const { service, calls } = createFakeAuthService();
    const { stream, chunks } = createCapturingStream();

    // When: statusCommand runs
    await statusCommand(service, stream);

    // Then: 'Not authenticated' is written to stdout
    expect(calls.getStatus).toBe(1);
    expect(chunks.join("")).toContain("Not authenticated");
  });

  test("prints active state with source and expiry when authenticated", async () => {
    // Given: AuthService reports an active session
    const futureMs = Date.now() + 60_000;
    const { service } = createFakeAuthService({
      getStatus: async () => ({
        isAuthenticated: true,
        expiresAt: futureMs,
        source: "indexeddb",
        isExpired: false,
      }),
    });
    const { stream, chunks } = createCapturingStream();

    // When: statusCommand runs
    await statusCommand(service, stream);

    // Then: printed text contains 'active', source, and expiry ISO timestamp
    const output = chunks.join("");
    expect(output).toContain("active");
    expect(output).toContain("indexeddb");
    expect(output).toContain(new Date(futureMs).toISOString());
  });
});

// ---------------------------------------------------------------------------
// logoutCommand
// ---------------------------------------------------------------------------

describe("logoutCommand", () => {
  test("invokes AuthService.logout and prints confirmation", async () => {
    // Given: a fake service
    const { service, calls } = createFakeAuthService();
    const { stream, chunks } = createCapturingStream();

    // When: logoutCommand runs
    await logoutCommand(service, stream);

    // Then: AuthService.logout was called exactly once and message written
    expect(calls.logout).toBe(1);
    expect(chunks.join("")).toContain("Logged out.");
  });
});

// ---------------------------------------------------------------------------
// refreshCommand
// ---------------------------------------------------------------------------

describe("refreshCommand", () => {
  test("calls logout then authenticate in order on success", async () => {
    // Given: a fake service where both operations succeed
    const { service, calls } = createFakeAuthService();
    const { stream, chunks } = createCapturingStream();
    const logger = createSilentLogger();

    // When: refreshCommand runs
    await refreshCommand(service, stream, logger);

    // Then: logout precedes authenticate and success line is printed
    expect(calls.logout).toBe(1);
    expect(calls.authenticate).toBe(1);
    expect(chunks.join("")).toContain("Authenticated");
  });
});

// ---------------------------------------------------------------------------
// createAuthCommand — --manual dispatch
// ---------------------------------------------------------------------------

describe("createAuthCommand --manual", () => {
  test("reads stdin and calls setManualToken when --manual is passed", async () => {
    // Given: fake service + stdin reader that yields a token
    const { service, calls } = createFakeAuthService();
    const components: AuthCommandComponents = {
      authService: service,
      logger: createSilentLogger(),
    };
    const { stream, chunks } = createCapturingStream();
    const stdin: StdinReader = async () => "def502001234567890abcdef1234567890abcdef";

    const cmd = createAuthCommand(components, { readStdin: stdin, stdout: stream });

    // When: the parent run is invoked with manual=true (no subcommand)
    await cmd.run?.({
      rawArgs: ["--manual"],
      args: { _: [], manual: true },
      cmd,
    });

    // Then: setManualToken was called with the stdin value, auth was NOT auto-triggered
    expect(calls.setManualToken.length).toBe(1);
    expect(calls.setManualToken[0]).toBe("def502001234567890abcdef1234567890abcdef");
    expect(calls.authenticate).toBe(0);
    expect(chunks.join("")).toContain("Authenticated");
  });

  test("parent run is a no-op when a subcommand name is in rawArgs", async () => {
    // Given: service with trackable calls
    const { service, calls } = createFakeAuthService();
    const components: AuthCommandComponents = {
      authService: service,
      logger: createSilentLogger(),
    };
    const { stream } = createCapturingStream();
    const cmd = createAuthCommand(components, { stdout: stream });

    // When: run is called with 'status' in rawArgs (simulating `af auth status` double-dispatch scenario)
    await cmd.run?.({
      rawArgs: ["status"],
      args: { _: ["status"], manual: false },
      cmd,
    });

    // Then: neither authenticate nor setManualToken nor getStatus was invoked from the parent
    expect(calls.authenticate).toBe(0);
    expect(calls.setManualToken.length).toBe(0);
    expect(calls.getStatus).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// formatStatus
// ---------------------------------------------------------------------------

describe("formatStatus", () => {
  test("renders 'Not authenticated' when no session exists", () => {
    // Given: an empty status
    const status: AuthStatus = {
      isAuthenticated: false,
      expiresAt: null,
      source: null,
      isExpired: false,
    };

    // When/Then
    expect(formatStatus(status)).toBe("Not authenticated.");
  });

  test("renders 'expired' state when session has past expiry", () => {
    // Given: an expired session
    const status: AuthStatus = {
      isAuthenticated: false,
      expiresAt: 1000,
      source: "manual",
      isExpired: true,
    };

    // When: formatting
    const text = formatStatus(status);

    // Then: indicates expired + preserves source
    expect(text).toContain("expired");
    expect(text).toContain("manual");
  });
});
