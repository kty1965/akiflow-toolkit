// ---------------------------------------------------------------------------
// AuthKeepAlive — keeps the long-running MCP server authenticated
// while idle by waking just inside the proactive refresh window.
// ---------------------------------------------------------------------------

import type { LoggerPort } from "@core/ports/logger-port.ts";
import { PROACTIVE_REFRESH_SKEW_MS } from "@core/services/auth-service.ts";
import type { Credentials } from "@core/types.ts";

export const KEEP_ALIVE_MAX_INTERVAL_MS = 25 * 60 * 1000;
export const KEEP_ALIVE_MIN_INTERVAL_MS = 60 * 1000;
export const KEEP_ALIVE_RETRY_INTERVAL_MS = 5 * 60 * 1000;

type TimerHandle = ReturnType<typeof setTimeout>;

export interface AuthKeepAliveDeps {
  auth: { authenticate(): Promise<Credentials> };
  logger: LoggerPort;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

export class AuthKeepAlive {
  private timer: TimerHandle | null = null;
  private running = false;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;

  constructor(private readonly deps: AuthKeepAliveDeps) {
    this.now = deps.now ?? Date.now;
    this.setTimer =
      deps.setTimer ??
      ((fn, ms) => {
        const handle = setTimeout(fn, ms);
        handle.unref?.();
        return handle;
      });
    this.clearTimer = deps.clearTimer ?? clearTimeout;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
  }

  async tick(): Promise<number> {
    try {
      const creds = await this.deps.auth.authenticate();
      return this.delayUntilRefreshWindow(creds);
    } catch (err) {
      this.deps.logger.debug("[auth] keep-alive refresh failed", { err: String(err) });
      return KEEP_ALIVE_RETRY_INTERVAL_MS;
    }
  }

  private schedule(ms: number): void {
    if (!this.running) return;
    this.timer = this.setTimer(() => {
      void this.tick().then((next) => this.schedule(next));
    }, ms);
  }

  private delayUntilRefreshWindow(creds: Credentials): number {
    const untilWindow = creds.expiresAt - PROACTIVE_REFRESH_SKEW_MS - this.now() + 1000;
    return Math.min(KEEP_ALIVE_MAX_INTERVAL_MS, Math.max(KEEP_ALIVE_MIN_INTERVAL_MS, untilWindow));
  }
}
