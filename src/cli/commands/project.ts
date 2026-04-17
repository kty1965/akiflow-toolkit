// ---------------------------------------------------------------------------
// af project — list / add / delete projects (Akiflow labels)
// ls uses TaskQueryService.getLabels (ADR-0010 query side).
// add/delete are stubbed pending Label CRUD in TaskCommandService.
// ---------------------------------------------------------------------------

import { defineCommand } from "citty";
import { ValidationError } from "../../core/errors/index.ts";
import type { LoggerPort } from "../../core/ports/logger-port.ts";
import type { Label } from "../../core/types.ts";
import { handleCliError } from "../app.ts";

export interface ProjectQueryApi {
  getLabels(): Promise<Label[]>;
}

export interface ProjectCommandComponents {
  taskQuery: ProjectQueryApi;
  logger: LoggerPort;
}

export interface CliWriter {
  write(chunk: string): boolean;
}

export interface ProjectCommandOptions {
  stdout?: CliWriter;
}

export function createProjectCommand(components: ProjectCommandComponents, options: ProjectCommandOptions = {}) {
  const stdout = options.stdout ?? process.stdout;

  return defineCommand({
    meta: { name: "project", description: "Manage Akiflow projects (labels)" },
    subCommands: {
      ls: defineCommand({
        meta: { name: "ls", description: "List all projects" },
        args: {
          json: { type: "boolean", description: "Emit JSON instead of text", default: false },
        },
        async run({ args }) {
          await runLs(components, stdout, Boolean(args.json));
        },
      }),
      add: defineCommand({
        meta: { name: "add", description: "Create a new project" },
        args: {
          name: { type: "positional", description: "Project name", required: true },
        },
        async run({ args }) {
          await runAdd(components, stdout, String(args.name));
        },
      }),
      delete: defineCommand({
        meta: { name: "delete", description: "Delete a project" },
        args: {
          name: { type: "positional", description: "Project name", required: true },
        },
        async run({ args }) {
          await runDelete(components, stdout, String(args.name));
        },
      }),
    },
  });
}

export async function runLs(components: ProjectCommandComponents, stdout: CliWriter, json: boolean): Promise<void> {
  try {
    const labels = await components.taskQuery.getLabels();
    if (json) {
      stdout.write(`${JSON.stringify(labels, null, 2)}\n`);
      return;
    }
    stdout.write(formatLabelsText(labels));
  } catch (err) {
    handleCliError(err, components.logger);
  }
}

export async function runAdd(components: ProjectCommandComponents, stdout: CliWriter, name: string): Promise<void> {
  try {
    if (!name.trim()) throw new ValidationError("name is required", "name");
    stdout.write(
      `'af project add' is not yet implemented.\nReason: Label CRUD is not exposed in TaskCommandService.\nCreate the project '${name}' manually in the Akiflow app for now.\n`,
    );
  } catch (err) {
    handleCliError(err, components.logger);
  }
}

export async function runDelete(components: ProjectCommandComponents, stdout: CliWriter, name: string): Promise<void> {
  try {
    if (!name.trim()) throw new ValidationError("name is required", "name");
    stdout.write(
      `'af project delete' is not yet implemented.\nReason: Label CRUD is not exposed in TaskCommandService.\nDelete the project '${name}' manually in the Akiflow app for now.\n`,
    );
  } catch (err) {
    handleCliError(err, components.logger);
  }
}

export function formatLabelsText(labels: Label[]): string {
  if (labels.length === 0) return "(no projects)\n";
  const lines = labels.map((label, idx) => {
    const n = String(idx + 1).padStart(3, " ");
    const color = label.color ? ` (${label.color})` : "";
    return `${n} ${label.name}${color} [${label.id}]`;
  });
  return `${lines.join("\n")}\n`;
}
