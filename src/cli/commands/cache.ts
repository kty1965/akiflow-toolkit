// ---------------------------------------------------------------------------
// af cache — manage the local sync cache (ADR-0013)
// Subcommand: `af cache clear` removes all on-disk cache entries.
// ---------------------------------------------------------------------------

import type { CachePort } from "@core/ports/cache-port.ts";
import type { LoggerPort } from "@core/ports/logger-port.ts";
import { defineCommand } from "citty";
import { handleCliError } from "../app.ts";

export type ClearableCache = Pick<CachePort, "clearAll" | "getCacheDir">;

export interface CacheCommandComponents {
  cache: ClearableCache;
  logger: LoggerPort;
}

export interface CliWriter {
  write(chunk: string): boolean;
}

export interface CacheCommandOptions {
  stdout?: CliWriter;
}

export function createCacheCommand(components: CacheCommandComponents, options: CacheCommandOptions = {}) {
  const stdout = options.stdout ?? process.stdout;

  return defineCommand({
    meta: { name: "cache", description: "Manage the local sync cache" },
    subCommands: {
      clear: defineCommand({
        meta: { name: "clear", description: "Remove all cache entries" },
        async run() {
          await clearCommand(components.cache, stdout, components.logger);
        },
      }),
    },
  });
}

export async function clearCommand(cache: ClearableCache, stdout: CliWriter, logger: LoggerPort): Promise<void> {
  try {
    await cache.clearAll();
    stdout.write("Cache cleared.\n");
  } catch (err) {
    handleCliError(err, logger);
  }
}
