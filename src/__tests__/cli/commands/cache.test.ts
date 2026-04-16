import { describe, expect, test } from "bun:test";
import {
  type CacheCommandComponents,
  type ClearableCache,
  type CliWriter,
  clearCommand,
  createCacheCommand,
} from "../../../cli/commands/cache.ts";
import type { LoggerPort } from "../../../core/ports/logger-port.ts";

function createFakeCache(): { cache: ClearableCache; calls: { clearAll: number } } {
  const calls = { clearAll: 0 };
  const cache: ClearableCache = {
    getCacheDir() {
      return "/tmp/cache";
    },
    async clearAll() {
      calls.clearAll += 1;
    },
  };
  return { cache, calls };
}

function silentLogger(): LoggerPort {
  return { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

function capturingStream(): { stream: CliWriter; chunks: string[] } {
  const chunks: string[] = [];
  return {
    stream: {
      write(chunk: string) {
        chunks.push(chunk);
        return true;
      },
    },
    chunks,
  };
}

// ---------------------------------------------------------------------------
// clearCommand
// ---------------------------------------------------------------------------

describe("clearCommand", () => {
  test("invokes CachePort.clearAll and writes confirmation to stdout", async () => {
    // Given: a fake cache + capturing stdout
    const { cache, calls } = createFakeCache();
    const { stream, chunks } = capturingStream();

    // When: clearCommand runs
    await clearCommand(cache, stream, silentLogger());

    // Then: clearAll invoked once and message printed
    expect(calls.clearAll).toBe(1);
    expect(chunks.join("")).toContain("Cache cleared.");
  });
});

// ---------------------------------------------------------------------------
// createCacheCommand — subcommand wiring
// ---------------------------------------------------------------------------

describe("createCacheCommand", () => {
  test("exposes a 'clear' subcommand that calls cache.clearAll", async () => {
    // Given: the cache subcommand tree
    const { cache, calls } = createFakeCache();
    const components: CacheCommandComponents = {
      cache,
      logger: silentLogger(),
    };
    const { stream, chunks } = capturingStream();
    const cmd = createCacheCommand(components, { stdout: stream });
    const clearSub = await resolveSubCommand(cmd, "clear");

    // When: running the 'clear' subcommand
    await clearSub.run?.({ rawArgs: [], args: { _: [] }, cmd: clearSub });

    // Then: cache.clearAll was called exactly once
    expect(calls.clearAll).toBe(1);
    expect(chunks.join("")).toContain("Cache cleared.");
  });
});

async function resolveSubCommand(
  parent: ReturnType<typeof createCacheCommand>,
  name: string,
): Promise<ReturnType<typeof createCacheCommand>> {
  const subTree = parent.subCommands;
  if (!subTree || !(name in subTree)) {
    throw new Error(`subcommand '${name}' not registered`);
  }
  const entry = subTree[name as keyof typeof subTree];
  return typeof entry === "function" ? await entry() : entry;
}
