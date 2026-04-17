// ---------------------------------------------------------------------------
// TaskQueryService — CQRS Read side (ADR-0010)
// Read-only façade over AkiflowHttpAdapter with sync_token pagination and
// client-side filtering. Retries follow ADR-0014 (short policy, 429/5xx only).
// core/services/ injects adapters via constructor (ADR-0006, ADR-0011).
// ---------------------------------------------------------------------------

import type { AkiflowHttpPort } from "../ports/akiflow-http-port.ts";
import type { CachePort } from "../ports/cache-port.ts";
import type { LoggerPort } from "../ports/logger-port.ts";
import type { Calendar, CalendarEvent, Label, Tag, Task, TaskQueryOptions } from "../types.ts";
import { isRetryable } from "../utils/is-retryable.ts";
import { type RetryPolicy, withRetry } from "../utils/retry.ts";
import type { AuthService } from "./auth-service.ts";

const LIST_PAGE_SIZE = 2500;

const READ_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 2,
  baseDelayMs: 300,
  maxDelayMs: 2000,
  multiplier: 2,
  jitter: "full",
  retryable: isRetryable,
};

export interface TaskQueryServiceDeps {
  auth: AuthService;
  http: AkiflowHttpPort;
  logger: LoggerPort;
  cache?: CachePort;
  cacheTtlSeconds?: number;
}

export class TaskQueryService {
  constructor(private readonly deps: TaskQueryServiceDeps) {}

  async listTasks(options: TaskQueryOptions = {}): Promise<Task[]> {
    const cache = this.deps.cache;
    if (cache) {
      const meta = await cache.getMeta();
      if (meta && this.isCacheValid(meta)) {
        const cached = await cache.getTasks();
        return applyFilters(cached, options);
      }
      const result = await this.fetchAllTasks(options, meta?.syncToken);
      await cache.setTasks(result.items);
      await cache.setMeta({
        syncToken: result.lastSyncToken,
        lastSyncAt: new Date().toISOString(),
        itemCount: result.items.length,
      });
      return applyFilters(result.items, options);
    }

    const result = await this.fetchAllTasks(options);
    return applyFilters(result.items, options);
  }

  private isCacheValid(meta: { lastSyncAt: string }): boolean {
    const ttl = (this.deps.cacheTtlSeconds ?? 30) * 1000;
    return Date.now() - new Date(meta.lastSyncAt).getTime() < ttl;
  }

  private async fetchAllTasks(
    options: TaskQueryOptions,
    initialSyncToken?: string,
  ): Promise<{ items: Task[]; lastSyncToken?: string }> {
    const collected: Task[] = [];
    let syncToken: string | undefined = initialSyncToken;
    let lastSyncToken: string | undefined;

    do {
      const res = await withRetry(
        () =>
          this.deps.auth.withAuth((token) =>
            this.deps.http.getTasks(token, {
              limit: options.limit ?? LIST_PAGE_SIZE,
              sync_token: syncToken,
            }),
          ),
        READ_RETRY_POLICY,
      );

      collected.push(...res.data);
      lastSyncToken = res.sync_token ?? lastSyncToken;
      syncToken = res.has_next_page && res.sync_token ? res.sync_token : undefined;
    } while (syncToken);

    return { items: collected, lastSyncToken };
  }

  async getTodayTasks(): Promise<Task[]> {
    const today = new Date().toISOString().slice(0, 10);
    return this.listTasks({ filter: "today", date: today });
  }

  async searchTasks(query: string): Promise<Task[]> {
    return this.listTasks({ search: query });
  }

  async getTaskById(id: string): Promise<Task | null> {
    const tasks = await this.listTasks();
    const exact = tasks.find((t) => t.id === id);
    if (exact) return exact;
    const prefix = tasks.find((t) => t.id.startsWith(id));
    return prefix ?? null;
  }

  async getLabels(): Promise<Label[]> {
    const res = await withRetry(
      () => this.deps.auth.withAuth((token) => this.deps.http.getLabels(token)),
      READ_RETRY_POLICY,
    );
    return res.data;
  }

  async getTags(): Promise<Tag[]> {
    const res = await withRetry(
      () => this.deps.auth.withAuth((token) => this.deps.http.getTags(token)),
      READ_RETRY_POLICY,
    );
    return res.data;
  }

  async getCalendars(): Promise<Calendar[]> {
    const res = await withRetry(
      () => this.deps.auth.withAuth((token) => this.deps.http.getCalendars(token)),
      READ_RETRY_POLICY,
    );
    return res.data;
  }

  async getEvents(date: string): Promise<CalendarEvent[]> {
    const res = await withRetry(
      () => this.deps.auth.withAuth((token) => this.deps.http.getEvents(token, date)),
      READ_RETRY_POLICY,
    );
    return res.data;
  }
}

function applyFilters(tasks: Task[], options: TaskQueryOptions): Task[] {
  let out = tasks.filter((t) => t.deleted_at === null);

  if (options.filter === "today" && options.date) {
    out = out.filter((t) => t.date === options.date);
  } else if (options.filter === "inbox") {
    out = out.filter((t) => t.date === null && !t.done);
  } else if (options.filter === "done") {
    out = out.filter((t) => t.done);
  } else if (options.date) {
    out = out.filter((t) => t.date === options.date);
  }

  if (options.project) {
    out = out.filter((t) => t.listId === options.project);
  }

  if (options.search) {
    const q = options.search.toLowerCase();
    out = out.filter((t) => (t.title ?? "").toLowerCase().includes(q));
  }

  return out;
}
