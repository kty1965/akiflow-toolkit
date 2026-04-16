import type { Task } from "../types.ts";

export interface CacheMeta {
  syncToken?: string;
  lastSyncAt: string;
  itemCount: number;
}

export interface PendingEntry {
  kind: "create" | "update" | "delete";
  taskId: string;
  payload: unknown;
  enqueuedAt: string;
  attempts: number;
}

export interface CachePort {
  getTasks(): Promise<Task[]>;
  setTasks(tasks: Task[]): Promise<void>;
  upsertTask(task: Task): Promise<void>;
  removeTask(id: string): Promise<void>;

  getMeta(): Promise<CacheMeta | null>;
  setMeta(meta: CacheMeta): Promise<void>;

  saveShortIdMap(map: Record<string, string>): Promise<void>;
  resolveShortId(shortId: string): Promise<string | null>;

  enqueuePending(entry: PendingEntry): Promise<void>;
  getPending(): Promise<PendingEntry[]>;
  removePending(taskId: string): Promise<void>;

  clearAll(): Promise<void>;
  getCacheDir(): string;
}
