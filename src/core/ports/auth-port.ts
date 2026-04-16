import type { AuthStatus, Credentials } from "../types.ts";

export interface AuthPort {
  authenticate(): Promise<Credentials>;
  refresh(credentials: Credentials): Promise<Credentials>;
  getStatus(): Promise<AuthStatus>;
  logout(): Promise<void>;
}
