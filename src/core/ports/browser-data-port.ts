import type { ExtractedToken } from "../types.ts";

export interface BrowserDataPort {
  extract(): Promise<ExtractedToken | null>;
}
