// ---------------------------------------------------------------------------
// Composition Root — ADR-0011
// Single place where all concrete adapters are wired into core Services.
// Both CLI and MCP entry points call composeApp() exactly once.
// ---------------------------------------------------------------------------

import { createBrowserReaders } from "./adapters/browser/index.ts";
import { SyncCache } from "./adapters/fs/sync-cache.ts";
import { XdgStorage } from "./adapters/fs/xdg-storage.ts";
import { AkiflowHttpAdapter } from "./adapters/http/akiflow-api.ts";
import { refreshAccessToken } from "./adapters/http/token-refresh.ts";
import { StderrLogger } from "./adapters/observability/stderr-logger.ts";
import { type AppConfig, loadConfig } from "./config.ts";
import type { CachePort } from "./core/ports/cache-port.ts";
import type { LoggerPort } from "./core/ports/logger-port.ts";
import type { StoragePort } from "./core/ports/storage-port.ts";
import { AuthService } from "./core/services/auth-service.ts";
import { TaskCommandService } from "./core/services/task-command-service.ts";
import { TaskQueryService } from "./core/services/task-query-service.ts";

export interface AppComponents {
  logger: LoggerPort;
  config: AppConfig;
  authService: AuthService;
  storage: StoragePort;
  cache: CachePort;
  taskQuery: TaskQueryService;
  taskCommand: TaskCommandService;
}

export function composeApp(): AppComponents {
  const config = loadConfig();
  const logger = new StderrLogger(config.logLevel, config.logFormat === "json");
  const storage = new XdgStorage(config.configDir);
  const browserReaders = createBrowserReaders(logger);
  const authService = new AuthService({
    storage,
    browserReaders,
    refreshAccessToken,
    logger,
  });
  const cache = new SyncCache(config.cacheDir, config.cacheTtlSeconds);
  const http = new AkiflowHttpAdapter(crypto.randomUUID(), logger, config.apiBaseUrl);
  const taskQuery = new TaskQueryService({ auth: authService, http, logger });
  const taskCommand = new TaskCommandService({ auth: authService, http, logger });
  return { logger, config, authService, storage, cache, taskQuery, taskCommand };
}
