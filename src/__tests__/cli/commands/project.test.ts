import { describe, expect, test } from "bun:test";
import {
  type CliWriter,
  type ProjectCommandComponents,
  type ProjectQueryApi,
  createProjectCommand,
  formatLabelsText,
  runAdd,
  runDelete,
  runLs,
} from "../../../cli/commands/project.ts";
import type { LoggerPort } from "../../../core/ports/logger-port.ts";
import type { Label } from "../../../core/types.ts";

function makeLabel(overrides: Partial<Label> = {}): Label {
  return {
    id: "lbl-1",
    name: "Work",
    color: null,
    ...overrides,
  };
}

function createFakeTaskQuery(overrides?: {
  getLabels?: () => Promise<Label[]>;
}): { service: ProjectQueryApi; calls: { getLabels: number } } {
  const calls = { getLabels: 0 };
  const service: ProjectQueryApi = {
    async getLabels() {
      calls.getLabels++;
      return overrides?.getLabels ? overrides.getLabels() : [];
    },
  };
  return { service, calls };
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
// formatLabelsText
// ---------------------------------------------------------------------------

describe("formatLabelsText", () => {
  test("renders '(no projects)' for empty list", () => {
    // Given: empty label list. When: formatted. Then: placeholder text.
    expect(formatLabelsText([])).toContain("(no projects)");
  });

  test("includes name and id for each row", () => {
    // Given: two labels. When: formatted. Then: text contains each name & id.
    const text = formatLabelsText([makeLabel({ id: "a", name: "Work" }), makeLabel({ id: "b", name: "Personal" })]);
    expect(text).toContain("Work");
    expect(text).toContain("Personal");
    expect(text).toContain("[a]");
    expect(text).toContain("[b]");
  });
});

// ---------------------------------------------------------------------------
// runLs
// ---------------------------------------------------------------------------

describe("runLs", () => {
  test("prints formatted text when not --json", async () => {
    // Given: a fake query with two labels
    const { service } = createFakeTaskQuery({
      getLabels: async () => [makeLabel({ id: "a", name: "Work" })],
    });
    const components: ProjectCommandComponents = { taskQuery: service, logger: silentLogger() };
    const { stream, chunks } = capturingStream();

    // When: runLs invoked without json
    await runLs(components, stream, false);

    // Then: rendered text contains label name
    const out = chunks.join("");
    expect(out).toContain("Work");
  });

  test("prints JSON when --json", async () => {
    // Given: a single label
    const { service } = createFakeTaskQuery({
      getLabels: async () => [makeLabel({ id: "a", name: "Work" })],
    });
    const components: ProjectCommandComponents = { taskQuery: service, logger: silentLogger() };
    const { stream, chunks } = capturingStream();

    // When: runLs with json=true
    await runLs(components, stream, true);

    // Then: output is valid JSON array
    const parsed = JSON.parse(chunks.join(""));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// runAdd / runDelete — stub behavior
// ---------------------------------------------------------------------------

describe("runAdd", () => {
  test("prints a 'not yet implemented' message with the project name", async () => {
    // Given: project components
    const { service } = createFakeTaskQuery();
    const components: ProjectCommandComponents = { taskQuery: service, logger: silentLogger() };
    const { stream, chunks } = capturingStream();

    // When: runAdd called with a name
    await runAdd(components, stream, "NewOne");

    // Then: stdout explains pending implementation and includes the name
    const out = chunks.join("");
    expect(out).toContain("not yet implemented");
    expect(out).toContain("NewOne");
  });
});

describe("runDelete", () => {
  test("prints a 'not yet implemented' message with the project name", async () => {
    // Given: project components
    const { service } = createFakeTaskQuery();
    const components: ProjectCommandComponents = { taskQuery: service, logger: silentLogger() };
    const { stream, chunks } = capturingStream();

    // When: runDelete called with a name
    await runDelete(components, stream, "OldOne");

    // Then: stdout explains pending implementation and includes the name
    const out = chunks.join("");
    expect(out).toContain("not yet implemented");
    expect(out).toContain("OldOne");
  });
});

// ---------------------------------------------------------------------------
// createProjectCommand (integration)
// ---------------------------------------------------------------------------

describe("createProjectCommand", () => {
  test("exposes ls/add/delete subcommands", () => {
    // Given: fake components
    const { service } = createFakeTaskQuery();
    const components: ProjectCommandComponents = { taskQuery: service, logger: silentLogger() };
    const { stream } = capturingStream();

    // When: the command is built
    const cmd = createProjectCommand(components, { stdout: stream });

    // Then: each subcommand is defined
    const sub = cmd.subCommands as Record<string, unknown>;
    expect(sub.ls).toBeDefined();
    expect(sub.add).toBeDefined();
    expect(sub.delete).toBeDefined();
  });
});
