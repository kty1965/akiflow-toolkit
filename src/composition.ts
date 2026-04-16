// ---------------------------------------------------------------------------
// Composition Root — ADR-0011
// Single place where all concrete adapters are wired into core Services.
// Both CLI and MCP entry points call composeApp() exactly once.
// ---------------------------------------------------------------------------

import { createBrowserReaders } from "./adapters/browser/index.ts";
import { XdgStorage } from "./adapters/fs/xdg-storage.ts";
import { refreshAccessToken } from "./adapters/http/token-refresh.ts";
import { StderrLogger } from "./adapters/observability/stderr-logger.ts";
import { type AppConfig, loadConfig } from "./config.ts";
import type { LoggerPort } from "./core/ports/logger-port.ts";
import type { StoragePort } from "./core/ports/storage-port.ts";
import { AuthService } from "./core/services/auth-service.ts";

export interface AppComponents {
  logger: LoggerPort;
  config: AppConfig;
  authService: AuthService;
  storage: StoragePort;
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
  return { logger, config, authService, storage };
}
