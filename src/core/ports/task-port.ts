import type { ApiResponse, Task, UpdateTaskPayload } from "../types.ts";

export interface TaskPort {
  fetch(url: string, token: string): Promise<ApiResponse<Task[]>>;
  patch(url: string, token: string, payload: UpdateTaskPayload): Promise<ApiResponse<Task>>;
}
