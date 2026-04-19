import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CacheMeta, CachePort, PendingEntry } from "@core/ports/cache-port.ts";
import type { Task } from "@core/types.ts";

const TASKS_FILE = "tasks.json";
const TASKS_META_FILE = "tasks-meta.json";
const LAST_LIST_FILE = "last-list.json";
const PENDING_DIR = "pending";
const PENDING_TASKS_FILE = "tasks-pending.jsonl";

type TaskMap = Record<string, Task>;

function isEnoent(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT";
}

export class SyncCache implements CachePort {
  private readonly tasksFile: string;
  private readonly metaFile: string;
  private readonly lastListFile: string;
  private readonly pendingDir: string;
  private readonly pendingFile: string;

  constructor(
    private readonly cacheDir: string,
    private readonly ttlSeconds: number = 30,
  ) {
    this.tasksFile = join(cacheDir, TASKS_FILE);
    this.metaFile = join(cacheDir, TASKS_META_FILE);
    this.lastListFile = join(cacheDir, LAST_LIST_FILE);
    this.pendingDir = join(cacheDir, PENDING_DIR);
    this.pendingFile = join(this.pendingDir, PENDING_TASKS_FILE);
  }

  getCacheDir(): string {
    return this.cacheDir;
  }

  getTtlSeconds(): number {
    return this.ttlSeconds;
  }

  async getTasks(): Promise<Task[]> {
    const map = await this.readTaskMap();
    return Object.values(map);
  }

  async setTasks(tasks: Task[]): Promise<void> {
    const map: TaskMap = {};
    for (const task of tasks) {
      if (task.id) {
        map[task.id] = task;
      }
    }
    await this.writeTaskMap(map);
  }

  async upsertTask(task: Task): Promise<void> {
    if (!task.id) return;
    const map = await this.readTaskMap();
    map[task.id] = task;
    await this.writeTaskMap(map);
  }

  async removeTask(id: string): Promise<void> {
    const map = await this.readTaskMap();
    if (!(id in map)) return;
    delete map[id];
    await this.writeTaskMap(map);
  }

  async getMeta(): Promise<CacheMeta | null> {
    return await this.readJsonFile<CacheMeta>(this.metaFile);
  }

  async setMeta(meta: CacheMeta): Promise<void> {
    await this.ensureCacheDir();
    await this.atomicWriteJson(this.metaFile, meta);
  }

  async saveShortIdMap(map: Record<string, string>): Promise<void> {
    await this.ensureCacheDir();
    await this.atomicWriteJson(this.lastListFile, map);
  }

  async resolveShortId(shortId: string): Promise<string | null> {
    const map = await this.readJsonFile<Record<string, string>>(this.lastListFile);
    if (!map) return null;
    return map[shortId] ?? null;
  }

  async enqueuePending(entry: PendingEntry): Promise<void> {
    await this.ensurePendingDir();
    await appendFile(this.pendingFile, `${JSON.stringify(entry)}\n`, { encoding: "utf-8", mode: 0o600 });
  }

  async getPending(): Promise<PendingEntry[]> {
    let data: string;
    try {
      data = await readFile(this.pendingFile, "utf-8");
    } catch (err: unknown) {
      if (isEnoent(err)) return [];
      throw err;
    }
    const result: PendingEntry[] = [];
    for (const line of data.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        result.push(JSON.parse(trimmed) as PendingEntry);
      } catch (err: unknown) {
        console.warn(`[akiflow] warning: malformed pending entry skipped: ${(err as Error).message}`);
      }
    }
    return result;
  }

  async removePending(taskId: string): Promise<void> {
    const entries = await this.getPending();
    const remaining = entries.filter((e) => e.taskId !== taskId);
    if (remaining.length === entries.length) return;
    await this.ensurePendingDir();
    const content = remaining.map((e) => `${JSON.stringify(e)}\n`).join("");
    await this.atomicWriteText(this.pendingFile, content);
  }

  async clearAll(): Promise<void> {
    await rm(this.cacheDir, { recursive: true, force: true });
  }

  private async ensureCacheDir(): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true, mode: 0o700 });
  }

  private async ensurePendingDir(): Promise<void> {
    await mkdir(this.pendingDir, { recursive: true, mode: 0o700 });
  }

  private async readTaskMap(): Promise<TaskMap> {
    const map = await this.readJsonFile<TaskMap>(this.tasksFile);
    return map ?? {};
  }

  private async writeTaskMap(map: TaskMap): Promise<void> {
    await this.ensureCacheDir();
    await this.atomicWriteJson(this.tasksFile, map);
  }

  private async readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
      const data = await readFile(filePath, "utf-8");
      return JSON.parse(data) as T;
    } catch (err: unknown) {
      if (isEnoent(err)) return null;
      console.warn(`[akiflow] warning: failed to read ${filePath}: ${(err as Error).message}`);
      return null;
    }
  }

  private async atomicWriteJson(filePath: string, value: unknown): Promise<void> {
    await this.atomicWriteText(filePath, JSON.stringify(value, null, 2));
  }

  private async atomicWriteText(filePath: string, content: string): Promise<void> {
    const tmp = `${filePath}.tmp`;
    await writeFile(tmp, content, { encoding: "utf-8", mode: 0o600 });
    await rename(tmp, filePath);
  }
}
