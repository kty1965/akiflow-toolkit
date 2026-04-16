import type { Credentials } from "../types.ts";

export interface BrowserDataPort {
  extract(): Promise<Credentials | null>;
}
