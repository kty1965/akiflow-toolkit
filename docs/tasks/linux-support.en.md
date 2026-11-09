---
title: "Task — Linux platform support"
createdAt: 2026-11-10T07:41:50+09:00
updatedAt: 2026-11-10T07:41:50+09:00
version: "1.0.0"
type: spec
tags:
  - platform
  - linux
  - bun
  - cross-platform
  - auto-auth
---

# Task: Linux Platform Support

[한국어](./linux-support.md) | **English**

## Status

🟡 **Partial** — Bun officially supports Linux x64/arm64, so the CLI and MCP server work. Chrome-cookie automatic authentication does not, because libsecret/kwallet are not integrated. Standalone binaries are already included in GitHub Releases.

## Goal

Let Linux users (Ubuntu/Debian/Fedora/Arch, etc.) use every feature of `akiflow-toolkit`. In particular, restore Chrome-cookie automatic authentication backed by GNOME Keyring / KDE KWallet.

## Current State

| Area | Current | Notes |
|------|---------|-------|
| Bun runtime | ✅ Native on Linux x64/arm64 | Mature |
| CLI core (`add`, `ls`, `do`, `task`, `cache`) | ✅ Works | Plain HTTP + node:fs |
| MCP server (`af --mcp`) | ✅ Works | stdio JSON-RPC |
| Standalone binary (`af-linux-x64`, `af-linux-arm64`) | ✅ Already in the GHA matrix | Published as Release assets |
| `af setup claude-code` / `cursor` | ✅ Works with `~/.config` / `~/.claude.json` | XDG conventions |
| `af setup claude-desktop` | ❌ Not supported | Claude Desktop itself has no Linux build |
| `af auth` (manual) | ✅ Works | Bearer JWT entered directly |
| `af auth` (auto — IndexedDB) | ⚠️ Unverified | No path code; implementation needs checking |
| `af auth` (auto — Chrome/Brave/Edge cookie) | ❌ Not supported | libsecret (Secret Service) not integrated |
| `af auth` (auto — Safari) | ❌ N/A | Apple only |
| Completion script | ✅ bash/zsh/fish | Covers all standard Linux shells |

## Required Work

### A. Chrome/Chromium cookie auto-auth (High effort)

Chrome/Chromium-family browsers on Linux encrypt cookies using the `Secret Service API` (libsecret) or kwallet. `chrome-cookie.ts` currently supports only the macOS Keychain.

Encryption scheme in brief:
- Chrome generates a random master password
- The master password is stored in libsecret (GNOME) or kwallet (KDE)
- If storing fails, the fallback password `"peanuts"` is used
- Cookie values: PBKDF2(password, "saltysalt", 1 iteration, 16 bytes) → AES-128-CBC
- The prefix `v10` (peanuts) or `v11` (libsecret) tells the schemes apart

Implementation items:
- [ ] Add Linux paths to `src/core/browser-paths.ts`:
  - Chrome: `~/.config/google-chrome/Default/Cookies`
  - Chromium: `~/.config/chromium/Default/Cookies`
  - Brave: `~/.config/BraveSoftware/Brave-Browser/Default/Cookies`
  - Edge: `~/.config/microsoft-edge/Default/Cookies`
- [ ] Refactor `src/adapters/browser/chrome-cookie.ts` to branch by OS:
  - `getDecryptionPassword(browser, platform)` abstraction
  - macOS: existing `getKeychainPassword` (Keychain)
  - Linux: new `getSecretServicePassword` (libsecret over DBus)
- [ ] Options for reaching libsecret:
  - **Option 1**: spawn `secret-tool lookup application chromium` (needs the libsecret-tools package)
  - **Option 2**: call DBus directly with `gdbus call --session --dest org.freedesktop.secrets ...` (no dependency)
  - **Option 3**: try libsecret first → fall back to `"peanuts"` on failure
- [ ] Pick the password by the `v10` (peanuts) / `v11` (libsecret) prefix
- [ ] Unit tests: verify the fallback path when the Linux CI runner has no `gnome-keyring-daemon`

### B. IndexedDB-based auth (Medium effort)

`src/adapters/browser/indexeddb-reader.ts` is plain `node:fs`. With the right paths it may be able to extract plaintext tokens from Linux Chrome/Chromium too (same principle as macOS).

- [ ] Linux IndexedDB paths in `src/core/browser-paths.ts`:
  - Chrome: `~/.config/google-chrome/Default/IndexedDB/`
  - Chromium: `~/.config/chromium/Default/IndexedDB/`
  - Brave and Edge under their own `~/.config` subpaths
- [ ] Verify on real machines:
  - Log in to Akiflow on Ubuntu 22.04 or Fedora and inspect the IndexedDB directory
  - Check whether the `LOCK` file contention seen on macOS also happens on Linux
- [ ] Add the discovered paths to `BrowserProfile` and add regression tests

### C. CDP fallback (Low effort)

`src/adapters/browser/cdp-launcher.ts` finds browser binaries with `/usr/bin/env which`. Linux compatibility needs checking.

- [ ] Chrome/Chromium executable names on Linux:
  - `google-chrome`, `google-chrome-stable`
  - `chromium`, `chromium-browser`
  - `brave-browser`
  - `microsoft-edge`
- [ ] Regression-test that the current `BROWSER_ID_PATTERN` check (Chromium-family filter) accepts the Linux variants

### D. Packaging (Optional)

- [ ] **AUR** (Arch User Repository) package: `akiflow-toolkit-bin` (installs the prebuilt binary)
- [ ] **Homebrew on Linux**: check whether the macOS formula can be reused
- [ ] **snap / flatpak**: low priority given the complexity of bundling the Bun runtime

## Dependencies & Blockers

- `bun:sqlite` confirmed working on Linux
- The libsecret DBus API ships by default on Ubuntu/Debian/Fedora (`libsecret-1-0`). On Arch it depends on user setup
- kwallet (KDE) can be split out of this task
- `~/.config` XDG conventions are already handled correctly by node:path

## Acceptance Criteria

- [ ] `af --help` works on Linux after `bun install -g akiflow-toolkit`
- [ ] Manual `af auth` + every CLI/MCP command works
- [ ] (stretch) Chrome/Chromium cookie auto-auth succeeds (libsecret path)
- [ ] `ubuntu-latest` added to the CI matrix, unit tests pass
- [ ] The Linux row of the README `Platform Support` section is updated to ✅

## Priority & Sequencing

- **Priority 1**: B (verify IndexedDB) — if the paths are right it reuses the macOS path; likely done within a day
- **Priority 2**: C (CDP fallback regression check) — 0.5 day
- **Priority 3**: A (Chrome cookie via libsecret) — 2–3 days, DBus calls
- **Priority 4**: D (AUR/Homebrew packaging) — when there is community demand

## References

- Chromium Linux cookie encryption: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/os_crypt/sync/os_crypt_linux.cc
- libsecret Secret Service DBus spec: https://specifications.freedesktop.org/secret-service/latest/
- `secret-tool` CLI: https://gitlab.gnome.org/GNOME/libsecret
- Bun on Linux: https://bun.sh/docs/installation
