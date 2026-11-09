---
title: "Task — Windows platform support"
createdAt: 2026-04-20T00:00:00+09:00
updatedAt: 2026-04-20T00:00:00+09:00
version: "1.0.0"
type: spec
tags:
  - platform
  - windows
  - bun
  - cross-platform
  - auto-auth
---

# Task: Windows Platform Support

[한국어](./windows-support.md) | **English**

## Status

🟡 **Partial** — Bun supports Windows x64, so the CLI and MCP server work after `bun install -g akiflow-toolkit`. Several features that assume macOS, and the distribution path, are still incomplete.

## Goal

Support every feature so Windows x64 users can run `akiflow-toolkit` on Bun without workarounds.

## Current State

| Area | Current | Notes |
|------|---------|-------|
| Bun runtime | ✅ Native on Windows x64 (1.1+) | arm64 is experimental and needs its own build |
| CLI core (`add`, `ls`, `do`, `task`, `cache`) | ✅ Works | Plain HTTP + node:fs |
| MCP server (`af --mcp`) | ✅ Works | stdio JSON-RPC |
| `af setup claude-code` / `cursor` | ⚠️ Path assumptions needed | Editor config paths differ on Windows |
| `af setup claude-desktop` | ❌ Not supported | Path code is macOS-only |
| `af auth` (manual) | ✅ Works | User enters the token directly |
| `af auth` (auto — Chrome/Edge) | ❌ Not supported | DPAPI decryption not implemented |
| `af auth` (auto — IndexedDB) | ⚠️ Unverified | No Windows Chrome user-data path code |
| Completion script | ❌ No PowerShell profile support | bash/zsh/fish only |
| Standalone binary (`af-windows-x64.exe`) | ❌ No build target | Not among `.releaserc.yaml` assets |

## Required Work

### A. Build & distribution (Low effort)

- [ ] `package.json` `scripts`:
  ```json
  "build:windows-x64": "bun build --compile --minify --target=bun-windows-x64 src/index.ts --outfile dist/af-windows-x64.exe"
  ```
- [ ] Add the windows target to `scripts.build:binary`
- [ ] Add Windows to `matrix.target` in `.github/workflows/release.yaml`:
  ```yaml
  - { platform: bun-windows-x64, name: af-windows-x64.exe }
  ```
- [ ] Add `dist/af-windows-x64.exe` to the `@semantic-release/github` assets in `.releaserc.yaml`

### B. Chrome/Edge cookie auto-auth (High effort)

Chrome/Edge on Windows encrypt cookies with **DPAPI (Data Protection API)**, which needs a different approach from the macOS Keychain.

- [ ] Add Windows paths to `src/core/browser-paths.ts`:
  - Chrome: `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Network\Cookies`
  - Edge: `%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Network\Cookies`
  - Local State: `%LOCALAPPDATA%\Google\Chrome\User Data\Local State` (where the master key lives)
- [ ] Branch in `src/adapters/browser/chrome-cookie.ts`:
  - macOS: Keychain + AES-128-CBC + PBKDF2 (keep the existing logic)
  - Windows: base64-decode `os_crypt.encrypted_key` from `Local State` → strip the first 5 bytes (`DPAPI`) → call `CryptUnprotectData` → AES-GCM-256 (12-byte nonce, 16-byte tag)
- [ ] Options for calling DPAPI:
  - **Option 1**: call `Crypt32.dll::CryptUnprotectData` directly via Node `ffi-napi` / Bun `bun:ffi`
  - **Option 2**: spawn `powershell -Command "[System.Security.Cryptography.ProtectedData]::Unprotect(...)"`
  - **Option 3**: disable the feature on Windows and only document manual auth (keep the current state)
- [ ] Unit tests: skip Windows-only tests elsewhere, add `windows-latest` to the GHA matrix

### C. IndexedDB-based auth (Medium effort)

Chrome/Arc/Brave/Edge are Chromium-based, so with the right IndexedDB paths they may yield plaintext tokens (same principle as macOS).

- [ ] Windows IndexedDB paths in `src/core/browser-paths.ts`:
  - Chrome: `%LOCALAPPDATA%\Google\Chrome\User Data\Default\IndexedDB\`
  - Edge, Brave and Arc under their own `%LOCALAPPDATA%` subpaths
- [ ] `src/adapters/browser/indexeddb-reader.ts`: already `node:fs`-based, so it will likely work once the paths are right. Needs verification on a real machine
- [ ] Confirm the IndexedDB recovery path on Windows with Playwright or a manual test

### D. MCP setup paths (Low effort)

- [ ] Claude Code / Cursor / Claude Desktop config paths in `src/cli/commands/setup.ts`:
  - Claude Code: `%USERPROFILE%\.claude.json` (same logic as the existing `~/.claude.json`)
  - Cursor: `%USERPROFILE%\.cursor\mcp.json`
  - Claude Desktop: `%APPDATA%\Claude\claude_desktop_config.json`
- [ ] Write a `.cmd` shim instead of a symlink on Windows (Bun handles this automatically, but verify)

### E. Completion script (Low effort)

- [ ] Add a PowerShell target to `src/cli/commands/completion.ts`:
  ```bash
  af completion powershell > $PROFILE
  ```
- [ ] Logic to generate a PowerShell `Register-ArgumentCompleter` block

### F. Documentation (Low effort)

- [ ] State the actual Windows coverage in the README Platform Support section (update when done)
- [ ] Add the Windows DPAPI path to `docs/akiflow-token-acquisition.md` (after that section is implemented)

## Dependencies & Blockers

- Bun on Windows arm64 is experimental — target x64 only for now
- `bun:sqlite` works on Windows (confirmed in the Bun docs)
- `node:fs`, `node:crypto`, `node:path` are all Windows-compatible
- FFI access for DPAPI calls is supported in Bun 1.1+ (`bun:ffi`)

## Acceptance Criteria

- [ ] `af --help` works in Windows PowerShell/CMD after `bun install -g akiflow-toolkit`
- [ ] The Windows x64 standalone binary (`af-windows-x64.exe`) is published to GitHub Releases
- [ ] `af setup claude-code` does an atomic merge into the Windows path (`%USERPROFILE%\.claude.json`)
- [ ] The manual `af auth` flow works (fine even if B is deferred)
- [ ] (stretch) Chrome/Edge auto-auth succeeds via DPAPI decryption
- [ ] Unit tests pass in at least one CI job (`windows-latest`)

## Priority & Sequencing

- **Priority 1**: A (build/distribution) — 1 day, immediate value
- **Priority 2**: D (setup paths), E (completion) — 0.5 day each
- **Priority 3**: C (IndexedDB) — 1–2 days, including real-machine verification
- **Priority 4**: B (DPAPI Chrome cookie) — 3–5 days, needs a Windows environment

## References

- Bun on Windows: https://bun.sh/docs/installation
- Chromium DPAPI cookie encryption: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/os_crypt/sync/os_crypt_win.cc
- Bun FFI: https://bun.sh/docs/api/ffi
- PowerShell completion: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/register-argumentcompleter
