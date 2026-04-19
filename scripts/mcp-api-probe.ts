#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// API Probe — isolate whether the MCP "fetch failed" is an auth token issue,
// a header combination issue, or a Bun fetch quirk.
//
// Reads the locally stored auth.json, then performs the SAME GET /v5/tasks
// request that TaskQueryService.listTasks fires — with identical headers —
// and prints a structured report. No MCP server, no tool handlers: just one
// direct fetch so we can see the real server response or the real fetch cause.
//
// Usage:
//   bun run scripts/mcp-api-probe.ts
//   bun run scripts/mcp-api-probe.ts --show-token   # reveal full token (danger)
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SHOW_TOKEN = process.argv.includes("--show-token");

const TTY = process.stdout.isTTY;
const c = {
  dim: (s: string) => (TTY ? `\x1b[2m${s}\x1b[0m` : s),
  green: (s: string) => (TTY ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (TTY ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (TTY ? `\x1b[33m${s}\x1b[0m` : s),
  bold: (s: string) => (TTY ? `\x1b[1m${s}\x1b[0m` : s),
};

function section(title: string): void {
  process.stdout.write(`\n${c.bold(`── ${title} ──`)}\n`);
}
function kv(k: string, v: unknown): void {
  process.stdout.write(`  ${c.dim(`${k.padEnd(18)}`)} ${String(v)}\n`);
}

// --- 1) Load auth.json ----------------------------------------------------

const authFile = process.env.AF_CONFIG_DIR
  ? join(process.env.AF_CONFIG_DIR, "auth.json")
  : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "akiflow", "auth.json");

section("auth.json");
kv("path", authFile);
if (!existsSync(authFile)) {
  process.stdout.write(`${c.red("✗ not found — run `bun run src/index.ts auth` first")}\n`);
  process.exit(2);
}

type AuthFile = Record<string, unknown>;
let auth: AuthFile;
try {
  auth = JSON.parse(readFileSync(authFile, "utf-8")) as AuthFile;
} catch (err) {
  process.stdout.write(`${c.red("✗ invalid JSON:")} ${(err as Error).message}\n`);
  process.exit(2);
}

kv("keys", Object.keys(auth).join(", "));
kv("source", (auth.source as string) ?? "(missing)");

// Try several conventional key names
const tokenCandidates = ["accessToken", "access_token", "bearer", "token"] as const;
let accessToken: string | undefined;
let accessTokenKey = "";
for (const k of tokenCandidates) {
  const v = auth[k];
  if (typeof v === "string" && v.length > 0) {
    accessToken = v;
    accessTokenKey = k;
    break;
  }
}

const refreshCandidates = ["refreshToken", "refresh_token"] as const;
let refreshToken: string | undefined;
for (const k of refreshCandidates) {
  const v = auth[k];
  if (typeof v === "string" && v.length > 0) {
    refreshToken = v;
    break;
  }
}

kv("accessToken key", accessTokenKey || "(none)");
kv("accessToken len", accessToken?.length ?? 0);
kv("accessToken head", accessToken ? (SHOW_TOKEN ? accessToken : `${accessToken.slice(0, 16)}…`) : "(empty)");
kv("has refreshToken", Boolean(refreshToken));

const isJwt = accessToken ? accessToken.split(".").length === 3 : false;
kv("looks like JWT", isJwt);

if (!accessToken) {
  process.stdout.write(
    `\n${c.red("No usable access token in auth.json.")}\n` + `${c.yellow("Fix:")} bun run src/index.ts auth refresh\n`,
  );
  process.exit(3);
}

// --- 2) Fire the same GET /v5/tasks call as TaskQueryService --------------

const API_BASE = process.env.AF_API_BASE_URL ?? "https://api.akiflow.com";
const PATH = "/v5/tasks?limit=2500";
const url = `${API_BASE}${PATH}`;

section("request");
kv("URL", url);
kv("method", "GET");

const headers: Record<string, string> = {
  "Akiflow-Platform": "mac",
  "Akiflow-Version": "3",
  "Akiflow-Client-Id": crypto.randomUUID(),
  Accept: "application/json",
  "Content-Type": "application/json",
  Authorization: `Bearer ${accessToken}`,
};
for (const [k, v] of Object.entries(headers)) {
  const display = k.toLowerCase() === "authorization" && !SHOW_TOKEN ? "Bearer ***" : v;
  kv(`  ${k}`, display);
}

section("response");
const t0 = performance.now();
try {
  const res = await fetch(url, { method: "GET", headers });
  const dt = (performance.now() - t0).toFixed(1);
  kv("status", `${res.status} ${res.statusText}`);
  kv("elapsed ms", dt);

  const body = await res.text();
  kv("body length", body.length);
  kv("body preview", body.length > 240 ? `${body.slice(0, 240).replace(/\s+/g, " ")}…` : body);

  process.stdout.write("\n");
  if (res.ok) {
    process.stdout.write(`${c.green("✓ Akiflow API reachable AND token accepted.")}\n`);
    process.stdout.write(
      `${c.yellow("→")} If mcp-live-demo.ts still fails, the bug is in the MCP code path, not network/auth.\n`,
    );
  } else if (res.status === 401 || res.status === 403) {
    process.stdout.write(`${c.red("✗ Server rejected the token.")}\n`);
    process.stdout.write(
      `${c.yellow("Fix:")} bun run src/index.ts auth refresh   ` +
        `${c.dim("# re-derive access_token from refresh_token")}\n`,
    );
  } else if (res.status >= 500) {
    process.stdout.write(`${c.red("✗ Akiflow server error — retry later.")}\n`);
  } else {
    process.stdout.write(`${c.yellow("? Unexpected status — see body preview above.")}\n`);
  }
} catch (err) {
  const dt = (performance.now() - t0).toFixed(1);
  kv("elapsed ms", dt);
  const e = err as Error & { cause?: { code?: string; message?: string } };
  kv("throw", `${e.name}: ${e.message}`);
  kv("cause.code", e.cause?.code ?? "(none)");
  kv("cause.message", e.cause?.message ?? "(none)");

  process.stdout.write(`\n${c.red("✗ fetch threw before receiving a response.")}\n`);

  const causeCode = e.cause?.code;
  if (causeCode === "ENOTFOUND" || causeCode === "EAI_AGAIN") {
    process.stdout.write(`${c.yellow("Hint:")} DNS resolution failed. Check network / VPN / /etc/hosts\n`);
  } else if (causeCode === "ECONNREFUSED" || causeCode === "ETIMEDOUT") {
    process.stdout.write(`${c.yellow("Hint:")} Firewall / proxy / VPN blocking the connection\n`);
  } else if (e.message.includes("certificate") || e.message.includes("SSL")) {
    process.stdout.write(`${c.yellow("Hint:")} TLS/CA chain issue — try NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem\n`);
  } else if (!accessToken || accessToken.includes("\n") || accessToken.includes("\0")) {
    process.stdout.write(`${c.yellow("Hint:")} Bearer value contains invalid chars — auth refresh required\n`);
  } else {
    process.stdout.write(`${c.yellow("Hint:")} Unknown — share the output with the maintainer\n`);
  }
  process.exit(1);
}
