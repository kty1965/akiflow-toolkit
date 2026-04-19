// ---------------------------------------------------------------------------
// TaskCommandService — CQRS Write side (ADR-0010)
// All write operations funnel through PATCH /v5/tasks (H1 UPSERT pattern).
// Retries follow ADR-0014; 401 handled by AuthService.withAuth.
// ---------------------------------------------------------------------------

import { ApiSchemaError } from "../errors/index.ts";
import type { AkiflowHttpPort } from "../ports/akiflow-http-port.ts";
import type { CachePort } from "../ports/cache-port.ts";
import type { LoggerPort } from "../ports/logger-port.ts";
import type { CreateTaskPayload, Task, UpdateTaskPayload } from "../types.ts";
import { isRetryable } from "../utils/is-retryable.ts";
import { type RetryPolicy, withRetry } from "../utils/retry.ts";
import type { AuthService } from "./auth-service.ts";

const WRITE_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 5000,
  multiplier: 2,
  jitter: "full",
  retryable: isRetryable,
};

export interface CreateTaskInput {
  title: string;
  date?: string;
  datetime?: string;
  duration?: number;
  projectId?: string;
}

export interface UpdateTaskInput {
  title?: string;
  date?: string | null;
  datetime?: string | null;
  duration?: number | null;
  projectId?: string | null;
  recurrence?: string | null;
}

export interface TaskCommandServiceDeps {
  auth: AuthService;
  http: AkiflowHttpPort;
  logger: LoggerPort;
  /**
   * Optional read-side cache. When provided, write operations merge the
   * server response into the cache so subsequent `TaskQueryService.listTasks`
   * sees the write immediately (read-your-writes consistency within a process).
   */
  cache?: CachePort;
}

export class TaskCommandService {
  constructor(private readonly deps: TaskCommandServiceDeps) {}

  async createTask(input: CreateTaskInput): Promise<Task> {
    const now = new Date().toISOString();
    const payload: CreateTaskPayload = {
      id: crypto.randomUUID(),
      title: input.title,
      global_created_at: now,
      global_updated_at: now,
    };
    if (input.date !== undefined) payload.date = input.date;
    if (input.datetime !== undefined) payload.datetime = input.datetime;
    if (input.duration !== undefined) payload.duration = input.duration;
    if (input.projectId !== undefined) payload.listId = input.projectId;

    return this.patchSingle(payload, "createTask");
  }

  async updateTask(id: string, patch: UpdateTaskInput): Promise<Task> {
    const payload: UpdateTaskPayload = {
      id,
      global_updated_at: new Date().toISOString(),
    };
    if (patch.title !== undefined) payload.title = patch.title;
    if (patch.date !== undefined) payload.date = patch.date;
    if (patch.datetime !== undefined) payload.datetime = patch.datetime;
    if (patch.recurrence !== undefined) payload.recurrence = patch.recurrence;

    return this.patchSingle(payload, "updateTask");
  }

  async completeTask(id: string): Promise<Task> {
    const payload: UpdateTaskPayload = {
      id,
      global_updated_at: new Date().toISOString(),
      done: true,
      status: 1,
    };
    return this.patchSingle(payload, "completeTask");
  }

  async scheduleTask(id: string, date: string, time?: string): Promise<Task> {
    const payload: UpdateTaskPayload = {
      id,
      global_updated_at: new Date().toISOString(),
      date,
      datetime: time ? `${date}T${time}:00` : null,
    };
    return this.patchSingle(payload, "scheduleTask");
  }

  async unscheduleTask(id: string): Promise<Task> {
    const payload: UpdateTaskPayload = {
      id,
      global_updated_at: new Date().toISOString(),
      date: null,
      datetime: null,
    };
    return this.patchSingle(payload, "unscheduleTask");
  }

  async deleteTask(id: string): Promise<Task> {
    const payload: UpdateTaskPayload = {
      id,
      global_updated_at: new Date().toISOString(),
      deleted_at: new Date().toISOString(),
    };
    return this.patchSingle(payload, "deleteTask");
  }

  private async patchSingle(payload: CreateTaskPayload | UpdateTaskPayload, label: string): Promise<Task> {
    const res = await withRetry(
      () => this.deps.auth.withAuth((token) => this.deps.http.patchTasks(token, [payload])),
      WRITE_RETRY_POLICY,
    );
    const task = res.data[0];
    if (!task) {
      throw new ApiSchemaError(`${label}: empty response`);
    }
    // Merge into read cache so the next `listTasks` sees the write immediately.
    // Deletions (soft-delete via deleted_at) are written as a task update too;
    // TaskQueryService.applyFilters excludes deleted_at !== null.
    if (this.deps.cache) {
      try {
        await this.deps.cache.upsertTask(task);
      } catch (err) {
        this.deps.logger.debug(`${label}: cache upsert failed`, { err: String(err) });
      }
    }
    return task;
  }
}
