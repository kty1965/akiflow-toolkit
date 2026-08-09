// ---------------------------------------------------------------------------
// duplicateTask — crosses the CQRS read/write boundary at the caller level
// (ADR-0010 forbids query→write coupling inside TaskCommandService itself).
// ---------------------------------------------------------------------------

import { NotFoundError, ValidationError } from "../errors/index.ts";
import type { Task } from "../types.ts";
import type { CreateTaskInput } from "./task-command-service.ts";

export interface DuplicateTaskDeps {
  getTaskById(id: string): Promise<Task | null>;
  createTask(input: CreateTaskInput): Promise<Task>;
}

export async function duplicateTask(deps: DuplicateTaskDeps, id: string): Promise<Task> {
  const source = await deps.getTaskById(id);
  if (!source) throw new NotFoundError(`task not found for id: '${id}'`);
  if (!source.title) throw new ValidationError("cannot duplicate a task with no title", "title");

  const input: CreateTaskInput = { title: source.title };
  if (source.date) input.date = source.date;
  if (source.datetime) input.datetime = source.datetime;
  if (source.duration) input.duration = source.duration;
  if (source.listId) input.projectId = source.listId;

  return deps.createTask(input);
}
