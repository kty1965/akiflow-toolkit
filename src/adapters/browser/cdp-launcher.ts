// ---------------------------------------------------------------------------
// CDP Browser Login — ADR-0003 Tier 3
// Launches Chrome with --remote-debugging-port, connects via CDP WebSocket,
// and captures access/refresh tokens from /oauth/refreshToken or /user/me
// responses. No Puppeteer dependency — pure node:child_process + WebSocket.
// ---------------------------------------------------------------------------

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { BrowserDataError } from "@core/errors/index.ts";
import type { LoggerPort } from "@core/ports/logger-port.ts";
import type { ExtractedToken } from "@core/types.ts";

const DEFAULT_PORT = 9222;
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_DISCOVERY_TIMEOUT_MS = 10_000;
const DISCOVERY_POLL_INTERVAL_MS = 100;
const DEFAULT_LOGIN_URL = "https://web.akiflow.com/auth/login";

const TOKEN_URL_PATTERNS = ["/oauth/refreshToken", "/user/me"] as const;

// Security (SECURITY-AUDIT-REPORT S-13): reject CDP endpoints that a local
// port squatter could masquerade as. We validate the Browser identity from
// /json/version and insist the WebSocket URL points at localhost on the
// exact port we told Chrome to use.
const BROWSER_ID_PATTERN = /^(?:HeadlessChrome|Chrome|Chromium|Brave|Arc|Edg|Edge)\/\d/;

export function isLocalDebuggerUrl(url: string, expectedPort: number): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "ws:") return false;
  if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return false;
  if (u.port !== String(expectedPort)) return false;
  return true;
}

// --- Injection-friendly minimal interfaces --------------------------------

export interface CdpChildProcess {
  kill(signal?: NodeJS.Signals | number): boolean;
}

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options?: { stdio?: "ignore" | "inherit" | "pipe" },
) => CdpChildProcess;

export interface CdpFetchResponse {
  ok: boolean;
  json(): Promise<unknown>;
}

export type FetchFn = (url: string) => Promise<CdpFetchResponse>;

export interface CdpWebSocketEvent {
  data?: unknown;
  code?: number;
  reason?: string;
  message?: string;
}

export type CdpWebSocketEventName = "open" | "message" | "close" | "error";

export interface MinimalWebSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(event: CdpWebSocketEventName, handler: (ev: CdpWebSocketEvent) => void): void;
}

export type CreateWebSocketFn = (url: string) => MinimalWebSocket;

// --- Default platform-bound implementations -------------------------------

const defaultSpawn: SpawnFn = (cmd, args, opts) =>
  spawn(cmd, args as string[], { stdio: opts?.stdio ?? "ignore", detached: false });

const defaultFetch: FetchFn = async (url) => {
  const res = await fetch(url);
  return {
    ok: res.ok,
    json: () => res.json(),
  };
};

const defaultCreateWebSocket: CreateWebSocketFn = (url) => {
  const ws = new WebSocket(url);
  return {
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    addEventListener: (event, handler) => ws.addEventListener(event, handler as EventListenerOrEventListenerObject),
  };
};

const defaultExists = (path: string): boolean => existsSync(path);

// Only accept executable-name-like tokens. Prevents any future caller from
// slipping shell metacharacters through `defaultWhich`.
const WHICH_SAFE_CMD = /^[A-Za-z0-9._/-]+$/;

const defaultWhich = (cmd: string): string | null => {
  if (!WHICH_SAFE_CMD.test(cmd)) return null;
  try {
    const out = execFileSync("/usr/bin/env", ["which", cmd], { encoding: "utf-8" }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
};

// --- Options & class ------------------------------------------------------

export interface CdpBrowserLoginOptions {
  logger: LoggerPort;
  userDataDir: string;
  port?: number;
  chromePath?: string;
  loginTimeoutMs?: number;
  discoveryTimeoutMs?: number;
  // Injection seams (default to real platform implementations)
  spawnFn?: SpawnFn;
  fetchFn?: FetchFn;
  createWebSocketFn?: CreateWebSocketFn;
  existsFn?: (path: string) => boolean;
  whichFn?: (cmd: string) => string | null;
  platform?: NodeJS.Platform;
  /**
   * Optional additional validation of a captured token before it is accepted
   * (SECURITY-AUDIT-REPORT S-13). Typical impl: call Akiflow API with the
   * new Bearer JWT and confirm 200 OK — this detects a port-squat attacker
   * that injected a bogus token via fake CDP responses.
   *
   * Returning `false` makes `login()` reject the capture and throw.
   */
  validateTokenFn?: (token: ExtractedToken) => Promise<boolean>;
}

const MAC_CHROME_CANDIDATES: readonly string[] = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Arc.app/Contents/MacOS/Arc",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

const LINUX_CHROME_CANDIDATES: readonly string[] = ["google-chrome", "chromium-browser", "chromium"];

const MAC_CHROME_LABEL: Record<string, string> = {
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome": "Chrome",
  "/Applications/Arc.app/Contents/MacOS/Arc": "Arc",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser": "Brave",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge": "Edge",
};

export class CdpBrowserLogin {
  private readonly logger: LoggerPort;
  private readonly userDataDir: string;
  private readonly port: number;
  private readonly chromePath: string | undefined;
  private readonly loginTimeoutMs: number;
  private readonly discoveryTimeoutMs: number;
  private readonly spawnFn: SpawnFn;
  private readonly fetchFn: FetchFn;
  private readonly createWebSocketFn: CreateWebSocketFn;
  private readonly existsFn: (path: string) => boolean;
  private readonly whichFn: (cmd: string) => string | null;
  private readonly platform: NodeJS.Platform;
  private readonly validateTokenFn?: (token: ExtractedToken) => Promise<boolean>;

  constructor(options: CdpBrowserLoginOptions) {
    this.logger = options.logger;
    this.userDataDir = options.userDataDir;
    this.port = options.port ?? DEFAULT_PORT;
    this.chromePath = options.chromePath;
    this.loginTimeoutMs = options.loginTimeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
    this.discoveryTimeoutMs = options.discoveryTimeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
    this.spawnFn = options.spawnFn ?? defaultSpawn;
    this.fetchFn = options.fetchFn ?? defaultFetch;
    this.createWebSocketFn = options.createWebSocketFn ?? defaultCreateWebSocket;
    this.existsFn = options.existsFn ?? defaultExists;
    this.whichFn = options.whichFn ?? defaultWhich;
    this.platform = options.platform ?? process.platform;
    this.validateTokenFn = options.validateTokenFn;
  }

  /**
   * Run the full CDP login flow: launch Chrome, wait for token capture, return token.
   * Returns null if Chrome cannot be located. Throws on connection / timeout failures
   * — caller (TASK-19 AuthService integration) decides whether to fall back.
   */
  async login(loginUrl?: string): Promise<ExtractedToken | null> {
    const chromePath = this.chromePath ?? this.findChromePath();
    if (!chromePath) {
      this.logger.error("[cdp] Chrome/Arc/Brave/Edge not found. Install Chrome or pass --chrome-path.");
      return null;
    }

    const url = loginUrl ?? DEFAULT_LOGIN_URL;
    this.logger.info(`[cdp] launching ${chromePath} on port ${this.port}`);
    const child = this.launchChrome(chromePath, url);
    let ws: MinimalWebSocket | null = null;
    try {
      const wsUrl = await this.getWebSocketUrl();
      ws = this.createWebSocketFn(wsUrl);
      const captured = await this.waitForLogin(ws);
      const token: ExtractedToken = { ...captured, browser: this.labelFor(chromePath) };

      // Security (SECURITY-AUDIT-REPORT S-13): if a validator is configured,
      // round-trip the captured token through it before accepting. Rejects
      // attacker-injected tokens that Akiflow's real API would refuse.
      if (this.validateTokenFn) {
        const ok = await this.validateTokenFn(token);
        if (!ok) {
          throw new BrowserDataError("captured CDP token failed validation — possible port squat, discarding");
        }
      }

      return token;
    } finally {
      if (ws) {
        try {
          ws.close();
        } catch {
          // best-effort cleanup
        }
      }
      try {
        child.kill("SIGTERM");
      } catch {
        // best-effort cleanup
      }
    }
  }

  /** Locate a Chromium-family browser executable. Returns null if none found. */
  findChromePath(): string | null {
    if (this.platform === "darwin") {
      for (const path of MAC_CHROME_CANDIDATES) {
        if (this.existsFn(path)) return path;
      }
      return null;
    }
    if (this.platform === "linux") {
      for (const cmd of LINUX_CHROME_CANDIDATES) {
        const found = this.whichFn(cmd);
        if (found) return found;
      }
      return null;
    }
    return null;
  }

  /** Spawn Chrome with CDP enabled. Caller must kill the returned process. */
  launchChrome(chromePath: string, loginUrl: string): CdpChildProcess {
    const args = [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.userDataDir}`,
      "--remote-allow-origins=*",
      "--no-first-run",
      "--no-default-browser-check",
      loginUrl,
    ];
    return this.spawnFn(chromePath, args, { stdio: "ignore" });
  }

  /**
   * Poll `/json/version` until Chrome exposes a webSocketDebuggerUrl.
   *
   * Security (SECURITY-AUDIT-REPORT S-13): reject responses whose `Browser`
   * identity is not a known Chromium family, or whose `webSocketDebuggerUrl`
   * is not `ws://127.0.0.1:<this.port>/…`. Both defend against a local
   * process that squatted our port before Chrome started and is serving a
   * malicious CDP endpoint.
   */
  async getWebSocketUrl(): Promise<string> {
    const endpoint = `http://127.0.0.1:${this.port}/json/version`;
    const start = Date.now();
    let lastError: unknown;

    while (Date.now() - start < this.discoveryTimeoutMs) {
      try {
        const res = await this.fetchFn(endpoint);
        if (res.ok) {
          const json = await res.json();

          const browserId = readString(json, "Browser");
          if (browserId && !BROWSER_ID_PATTERN.test(browserId)) {
            throw new BrowserDataError(
              `CDP endpoint on port ${this.port} has unexpected Browser identity '${browserId}' — aborting (possible port squat)`,
            );
          }

          const wsUrl = readString(json, "webSocketDebuggerUrl");
          if (wsUrl && !isLocalDebuggerUrl(wsUrl, this.port)) {
            throw new BrowserDataError(
              `CDP webSocketDebuggerUrl '${wsUrl}' is not ws://127.0.0.1:${this.port}/… — aborting (possible port squat)`,
            );
          }
          if (wsUrl) return wsUrl;
        }
      } catch (err) {
        lastError = err;
      }
      await sleep(DISCOVERY_POLL_INTERVAL_MS);
    }
    const errSuffix = lastError ? ` (last error: ${(lastError as Error).message})` : "";
    throw new BrowserDataError(
      `CDP discovery timed out after ${this.discoveryTimeoutMs}ms on port ${this.port}${errSuffix}`,
    );
  }

  /**
   * Subscribe to CDP Network domain, wait until a token-bearing response is captured,
   * and resolve with the parsed token. Rejects on timeout, ws close, or ws error.
   */
  waitForLogin(ws: MinimalWebSocket): Promise<ExtractedToken> {
    return new Promise<ExtractedToken>((resolve, reject) => {
      let nextCmdId = 0;
      // requestId -> response url for endpoints we care about
      const trackedRequests = new Map<string, string>();
      // command id -> requestId, for matching getResponseBody replies
      const pendingBodyCmds = new Map<number, string>();
      let settled = false;

      const send = (method: string, params?: Record<string, unknown>): number => {
        nextCmdId += 1;
        const id = nextCmdId;
        ws.send(JSON.stringify({ id, method, params: params ?? {} }));
        return id;
      };

      const settle = (action: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        action();
      };

      const timer = setTimeout(() => {
        settle(() => reject(new BrowserDataError(`CDP login timed out after ${this.loginTimeoutMs}ms`)));
      }, this.loginTimeoutMs);

      ws.addEventListener("open", () => {
        send("Network.enable");
        send("Page.enable");
      });

      ws.addEventListener("close", (ev) => {
        settle(() =>
          reject(new BrowserDataError(`CDP WebSocket closed before token captured (code=${ev.code ?? "n/a"})`)),
        );
      });

      ws.addEventListener("error", (ev) => {
        settle(() => reject(new BrowserDataError(`CDP WebSocket error: ${ev.message ?? "unknown"}`)));
      });

      ws.addEventListener("message", (ev) => {
        if (settled) return;
        if (typeof ev.data !== "string" || ev.data.length === 0) return;

        let msg: unknown;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (!isObject(msg)) return;

        const method = readString(msg, "method");
        if (method === "Network.responseReceived") {
          const params = readObject(msg, "params");
          const requestId = readString(params, "requestId");
          const response = readObject(params, "response");
          const url = readString(response, "url") ?? "";
          if (requestId && TOKEN_URL_PATTERNS.some((p) => url.includes(p))) {
            trackedRequests.set(requestId, url);
          }
          return;
        }

        if (method === "Network.loadingFinished") {
          const params = readObject(msg, "params");
          const requestId = readString(params, "requestId");
          if (requestId && trackedRequests.has(requestId)) {
            const cmdId = send("Network.getResponseBody", { requestId });
            pendingBodyCmds.set(cmdId, requestId);
          }
          return;
        }

        // Reply to a sent command — match by id
        const replyId = readNumber(msg, "id");
        if (replyId !== null && pendingBodyCmds.has(replyId)) {
          const requestId = pendingBodyCmds.get(replyId);
          pendingBodyCmds.delete(replyId);
          if (!requestId) return;
          const url = trackedRequests.get(requestId) ?? "";
          trackedRequests.delete(requestId);

          const result = readObject(msg, "result");
          const body = readString(result, "body") ?? "";
          const base64Encoded = readBoolean(result, "base64Encoded") ?? false;
          if (!body) return;

          const token = parseTokenBody(body, base64Encoded);
          if (token) {
            this.logger.info(`[cdp] captured token from ${url}`);
            settle(() => resolve(token));
          }
        }
      });
    });
  }

  private labelFor(chromePath: string): string {
    if (MAC_CHROME_LABEL[chromePath]) return MAC_CHROME_LABEL[chromePath];
    if (chromePath.includes("chromium")) return "Chromium";
    return "Chrome";
  }
}

// --- Pure helpers ---------------------------------------------------------

/**
 * Parse a CDP response body into an ExtractedToken. Supports base64-encoded payloads,
 * snake_case (access_token / refresh_token / expires_in) and camelCase keys, and
 * derives expiresAt from a JWT `exp` claim when expires_in is absent.
 */
export function parseTokenBody(body: string, base64Encoded: boolean): ExtractedToken | null {
  let text = body;
  if (base64Encoded) {
    try {
      text = Buffer.from(body, "base64").toString("utf-8");
    } catch {
      return null;
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;

  const accessToken = readString(parsed, "access_token") ?? readString(parsed, "accessToken");
  if (!accessToken) return null;

  const refreshToken = readString(parsed, "refresh_token") ?? readString(parsed, "refreshToken");
  let expiresAt: number | undefined;

  const expiresIn = readNumber(parsed, "expires_in") ?? readNumber(parsed, "expiresIn");
  if (expiresIn !== null) {
    expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  } else {
    const jwtExp = extractJwtExp(accessToken);
    if (jwtExp !== null) expiresAt = jwtExp;
  }

  return {
    accessToken,
    refreshToken: refreshToken ?? undefined,
    expiresAt,
    browser: "Chrome",
  };
}

function extractJwtExp(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
    if (isObject(payload)) {
      const exp = readNumber(payload, "exp");
      if (exp !== null) return exp;
    }
    return null;
  } catch {
    return null;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readString(obj: unknown, key: string): string | null {
  if (!isObject(obj)) return null;
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

function readNumber(obj: unknown, key: string): number | null {
  if (!isObject(obj)) return null;
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function readBoolean(obj: unknown, key: string): boolean | null {
  if (!isObject(obj)) return null;
  const v = obj[key];
  return typeof v === "boolean" ? v : null;
}

function readObject(obj: unknown, key: string): Record<string, unknown> | null {
  if (!isObject(obj)) return null;
  const v = obj[key];
  return isObject(v) ? v : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
