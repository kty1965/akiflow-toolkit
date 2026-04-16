import { describe, expect, mock, test } from "bun:test";
import {
  CdpBrowserLogin,
  type CdpBrowserLoginOptions,
  type CdpChildProcess,
  type CdpFetchResponse,
  type CdpWebSocketEvent,
  type CdpWebSocketEventName,
  type MinimalWebSocket,
  parseTokenBody,
} from "../../../adapters/browser/cdp-launcher.ts";
import { BrowserDataError } from "../../../core/errors/index.ts";
import type { LoggerPort } from "../../../core/ports/logger-port.ts";

// --- Test doubles ---------------------------------------------------------

function silentLogger(): LoggerPort {
  return {
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

class FakeChildProcess implements CdpChildProcess {
  killed = false;
  killSignal: NodeJS.Signals | number | undefined;
  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    this.killSignal = signal;
    return true;
  }
}

class FakeWebSocket implements MinimalWebSocket {
  closed = false;
  closeCode: number | undefined;
  sent: string[] = [];
  private readonly listeners: Record<CdpWebSocketEventName, Array<(ev: CdpWebSocketEvent) => void>> = {
    open: [],
    message: [],
    close: [],
    error: [],
  };

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number): void {
    this.closed = true;
    this.closeCode = code;
  }

  addEventListener(event: CdpWebSocketEventName, handler: (ev: CdpWebSocketEvent) => void): void {
    this.listeners[event].push(handler);
  }

  // Test helpers
  emit(event: CdpWebSocketEventName, ev: CdpWebSocketEvent = {}): void {
    for (const h of this.listeners[event]) h(ev);
  }

  emitMessage(payload: unknown): void {
    this.emit("message", { data: JSON.stringify(payload) });
  }

  /** Returns the parsed CDP command at index `i` from the sent buffer. */
  sentCommand(i: number): { id: number; method: string; params?: unknown } {
    return JSON.parse(this.sent[i]) as { id: number; method: string; params?: unknown };
  }
}

interface MakeOptionsOverrides {
  port?: number;
  loginTimeoutMs?: number;
  discoveryTimeoutMs?: number;
  chromePath?: string;
  spawnFn?: CdpBrowserLoginOptions["spawnFn"];
  fetchFn?: CdpBrowserLoginOptions["fetchFn"];
  createWebSocketFn?: CdpBrowserLoginOptions["createWebSocketFn"];
  existsFn?: CdpBrowserLoginOptions["existsFn"];
  whichFn?: CdpBrowserLoginOptions["whichFn"];
  platform?: NodeJS.Platform;
}

function makeLogin(overrides: MakeOptionsOverrides = {}): CdpBrowserLogin {
  return new CdpBrowserLogin({
    logger: silentLogger(),
    userDataDir: "/tmp/akiflow-test-profile",
    port: overrides.port ?? 9999,
    chromePath: overrides.chromePath,
    loginTimeoutMs: overrides.loginTimeoutMs ?? 1_000,
    discoveryTimeoutMs: overrides.discoveryTimeoutMs ?? 200,
    spawnFn: overrides.spawnFn,
    fetchFn: overrides.fetchFn,
    createWebSocketFn: overrides.createWebSocketFn,
    existsFn: overrides.existsFn,
    whichFn: overrides.whichFn,
    platform: overrides.platform,
  });
}

// --- findChromePath -------------------------------------------------------

describe("findChromePath", () => {
  test("returns Chrome path on darwin when Chrome binary exists", () => {
    // Given: macOS with Google Chrome installed
    const existsFn = mock((p: string) => p === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    const login = makeLogin({ platform: "darwin", existsFn });

    // When: detecting the Chrome path
    const result = login.findChromePath();

    // Then: returns the canonical Chrome binary path
    expect(result).toBe("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  });

  test("falls through to Arc when Chrome is missing on darwin", () => {
    // Given: only Arc installed on macOS
    const existsFn = mock((p: string) => p === "/Applications/Arc.app/Contents/MacOS/Arc");
    const login = makeLogin({ platform: "darwin", existsFn });

    // When: detecting
    const result = login.findChromePath();

    // Then: Arc is returned
    expect(result).toBe("/Applications/Arc.app/Contents/MacOS/Arc");
  });

  test("returns null on darwin when no candidate exists", () => {
    // Given: no Chromium-family browser installed
    const existsFn = mock(() => false);
    const login = makeLogin({ platform: "darwin", existsFn });

    // When/Then
    expect(login.findChromePath()).toBeNull();
  });

  test("returns google-chrome path on linux when which resolves it", () => {
    // Given: linux with google-chrome on PATH
    const whichFn = mock((cmd: string) => (cmd === "google-chrome" ? "/usr/bin/google-chrome" : null));
    const login = makeLogin({ platform: "linux", whichFn });

    // When/Then
    expect(login.findChromePath()).toBe("/usr/bin/google-chrome");
  });

  test("returns null on linux when no chromium-family binary is on PATH", () => {
    // Given: nothing resolves
    const whichFn = mock(() => null);
    const login = makeLogin({ platform: "linux", whichFn });

    // When/Then
    expect(login.findChromePath()).toBeNull();
  });

  test("returns null on unsupported platforms (e.g. win32)", () => {
    // Given: win32 platform — not yet supported
    const login = makeLogin({ platform: "win32" });

    // When/Then
    expect(login.findChromePath()).toBeNull();
  });
});

// --- launchChrome ---------------------------------------------------------

describe("launchChrome", () => {
  test("spawns Chrome with remote debugging port and required CDP flags", () => {
    // Given: a custom port and user data dir
    const calls: Array<{ cmd: string; args: readonly string[] }> = [];
    const spawnFn = mock((cmd: string, args: readonly string[]) => {
      calls.push({ cmd, args });
      return new FakeChildProcess();
    });
    const login = new CdpBrowserLogin({
      logger: silentLogger(),
      userDataDir: "/tmp/profile-x",
      port: 9333,
      loginTimeoutMs: 1000,
      discoveryTimeoutMs: 200,
      spawnFn,
    });

    // When: launching Chrome
    login.launchChrome("/path/to/chrome", "https://web.akiflow.com/auth/login");

    // Then: spawn was called with the expected command and CDP-required flags
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe("/path/to/chrome");
    expect(calls[0].args).toEqual([
      "--remote-debugging-port=9333",
      "--user-data-dir=/tmp/profile-x",
      "--remote-allow-origins=*",
      "--no-first-run",
      "--no-default-browser-check",
      "https://web.akiflow.com/auth/login",
    ]);
  });
});

// --- getWebSocketUrl ------------------------------------------------------

describe("getWebSocketUrl", () => {
  test("returns webSocketDebuggerUrl from /json/version once Chrome responds", async () => {
    // Given: fetch that succeeds on first call
    const fetchFn = mock(
      async (_url: string): Promise<CdpFetchResponse> => ({
        ok: true,
        json: async () => ({ webSocketDebuggerUrl: "ws://127.0.0.1:9999/devtools/browser/abc" }),
      }),
    );
    const login = makeLogin({ fetchFn });

    // When
    const ws = await login.getWebSocketUrl();

    // Then
    expect(ws).toBe("ws://127.0.0.1:9999/devtools/browser/abc");
  });

  test("throws BrowserDataError when discovery exceeds the configured timeout", async () => {
    // Given: fetch always fails (Chrome never up)
    const fetchFn = mock(async (): Promise<CdpFetchResponse> => {
      throw new Error("ECONNREFUSED");
    });
    const login = makeLogin({ fetchFn, discoveryTimeoutMs: 150 });

    // When/Then
    await expect(login.getWebSocketUrl()).rejects.toBeInstanceOf(BrowserDataError);
  });
});

// --- waitForLogin ---------------------------------------------------------

describe("waitForLogin", () => {
  test("captures token after Network.responseReceived → loadingFinished → getResponseBody", async () => {
    // Given: a fake WebSocket and the wait promise
    const ws = new FakeWebSocket();
    const login = makeLogin();
    const promise = login.waitForLogin(ws);

    // When: simulate full CDP handshake
    ws.emit("open");
    // Two enable commands should be queued on open
    expect(ws.sentCommand(0).method).toBe("Network.enable");
    expect(ws.sentCommand(1).method).toBe("Page.enable");

    ws.emitMessage({
      method: "Network.responseReceived",
      params: {
        requestId: "req-42",
        response: { url: "https://api.akiflow.com/oauth/refreshToken" },
      },
    });
    ws.emitMessage({
      method: "Network.loadingFinished",
      params: { requestId: "req-42" },
    });

    // The implementation should now have sent Network.getResponseBody
    const lastSent = ws.sentCommand(ws.sent.length - 1);
    expect(lastSent.method).toBe("Network.getResponseBody");

    // Reply to that command with a token body
    ws.emitMessage({
      id: lastSent.id,
      result: {
        body: JSON.stringify({
          access_token: "ACCESS_TOKEN_VALUE",
          refresh_token: "REFRESH_TOKEN_VALUE",
          expires_in: 3600,
        }),
        base64Encoded: false,
      },
    });

    // Then
    const token = await promise;
    expect(token.accessToken).toBe("ACCESS_TOKEN_VALUE");
    expect(token.refreshToken).toBe("REFRESH_TOKEN_VALUE");
    expect(token.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test("rejects with BrowserDataError when WebSocket closes before token captured", async () => {
    // Given
    const ws = new FakeWebSocket();
    const login = makeLogin();
    const promise = login.waitForLogin(ws);

    // When
    ws.emit("close", { code: 1006 });

    // Then
    await expect(promise).rejects.toBeInstanceOf(BrowserDataError);
  });

  test("rejects with BrowserDataError when WebSocket emits error", async () => {
    // Given
    const ws = new FakeWebSocket();
    const login = makeLogin();
    const promise = login.waitForLogin(ws);

    // When
    ws.emit("error", { message: "boom" });

    // Then
    await expect(promise).rejects.toBeInstanceOf(BrowserDataError);
  });

  test("rejects with BrowserDataError after loginTimeoutMs elapses with no token", async () => {
    // Given: a very short login timeout
    const ws = new FakeWebSocket();
    const login = makeLogin({ loginTimeoutMs: 50 });

    // When
    const promise = login.waitForLogin(ws);

    // Then
    await expect(promise).rejects.toBeInstanceOf(BrowserDataError);
  });
});

// --- login (top-level orchestrator) --------------------------------------

describe("login", () => {
  test("returns null when Chrome cannot be located", async () => {
    // Given: linux platform with nothing on PATH
    const login = makeLogin({ platform: "linux", whichFn: () => null });

    // When
    const result = await login.login();

    // Then
    expect(result).toBeNull();
  });

  test("orchestrates spawn → ws discovery → token capture and cleans up", async () => {
    // Given: a controlled spawn, fetch, and websocket trio
    const child = new FakeChildProcess();
    const ws = new FakeWebSocket();
    const spawnFn = mock(() => child);
    const fetchFn = mock(
      async (): Promise<CdpFetchResponse> => ({
        ok: true,
        json: async () => ({ webSocketDebuggerUrl: "ws://127.0.0.1:9999/devtools/browser/x" }),
      }),
    );
    const createWebSocketFn = mock(() => ws);

    const login = new CdpBrowserLogin({
      logger: silentLogger(),
      userDataDir: "/tmp/profile",
      port: 9999,
      loginTimeoutMs: 1_000,
      discoveryTimeoutMs: 200,
      chromePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      platform: "darwin",
      spawnFn,
      fetchFn,
      createWebSocketFn,
    });

    // When: kick off the login and feed the handshake after the discovery
    // promise chain has drained (fetch → json → createWebSocketFn → addEventListener)
    const promise = login.login();
    await new Promise((r) => setTimeout(r, 20));
    ws.emit("open");
    ws.emitMessage({
      method: "Network.responseReceived",
      params: { requestId: "r1", response: { url: "https://api.akiflow.com/user/me" } },
    });
    ws.emitMessage({ method: "Network.loadingFinished", params: { requestId: "r1" } });
    const cmd = ws.sentCommand(ws.sent.length - 1);
    ws.emitMessage({
      id: cmd.id,
      result: { body: JSON.stringify({ access_token: "AT" }), base64Encoded: false },
    });

    // Then: token is returned and resources are cleaned up
    const token = await promise;
    expect(token).not.toBeNull();
    expect(token?.accessToken).toBe("AT");
    expect(token?.browser).toBe("Chrome");
    expect(ws.closed).toBe(true);
    expect(child.killed).toBe(true);
    expect(child.killSignal).toBe("SIGTERM");
  });
});

// --- parseTokenBody (pure) ------------------------------------------------

describe("parseTokenBody", () => {
  test("parses snake_case JSON with access_token, refresh_token, expires_in", () => {
    // Given
    const body = JSON.stringify({
      access_token: "AT",
      refresh_token: "RT",
      expires_in: 7200,
    });

    // When
    const token = parseTokenBody(body, false);

    // Then
    expect(token).not.toBeNull();
    expect(token?.accessToken).toBe("AT");
    expect(token?.refreshToken).toBe("RT");
    expect(token?.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test("decodes base64-encoded payloads before parsing", () => {
    // Given: a base64-encoded JSON payload (CDP returns binary bodies this way)
    const json = JSON.stringify({ accessToken: "AT2" });
    const encoded = Buffer.from(json, "utf-8").toString("base64");

    // When
    const token = parseTokenBody(encoded, true);

    // Then
    expect(token?.accessToken).toBe("AT2");
  });

  test("returns null when body is not valid JSON", () => {
    // Given
    const body = "this is not json";

    // When/Then
    expect(parseTokenBody(body, false)).toBeNull();
  });

  test("derives expiresAt from JWT exp claim when expires_in is absent", () => {
    // Given: a synthetic JWT whose payload exposes exp
    const exp = Math.floor(Date.now() / 1000) + 1800;
    const header = Buffer.from(JSON.stringify({ alg: "none" }), "utf-8").toString("base64url");
    const payload = Buffer.from(JSON.stringify({ exp }), "utf-8").toString("base64url");
    const jwt = `${header}.${payload}.sig`;
    const body = JSON.stringify({ access_token: jwt });

    // When
    const token = parseTokenBody(body, false);

    // Then
    expect(token?.expiresAt).toBe(exp);
  });
});
