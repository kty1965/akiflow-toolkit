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

## Status

🟡 **Partial** — Bun runtime이 Windows x64를 지원하므로 `bun install -g akiflow-toolkit`으로 CLI/MCP는 동작한다. 단 몇 가지 macOS 전제 기능과 배포 경로가 미완성이다.

## Goal

Windows x64 사용자가 Bun runtime으로 `akiflow-toolkit`을 별다른 workaround 없이 사용할 수 있도록 전 기능을 지원한다.

## Current State

| 영역 | 현재 | 비고 |
|------|------|------|
| Bun runtime | ✅ Windows x64 네이티브 지원 (1.1+) | arm64는 실험적, 별도 빌드 필요 |
| CLI core (`add`, `ls`, `do`, `task`, `cache`) | ✅ 동작 | 순수 HTTP + node:fs |
| MCP 서버 (`af --mcp`) | ✅ 동작 | stdio JSON-RPC |
| `af setup claude-code` / `cursor` | ⚠️ 경로 가정 필요 | editor config 경로가 Windows와 다름 |
| `af setup claude-desktop` | ❌ 미지원 | macOS 전용 경로 코드 |
| `af auth` (수동) | ✅ 동작 | 사용자가 토큰 직접 입력 |
| `af auth` (자동 — Chrome/Edge) | ❌ 미지원 | DPAPI 복호화 미구현 |
| `af auth` (자동 — IndexedDB) | ⚠️ 미검증 | Windows Chrome user data 경로 코드 없음 |
| Completion script | ❌ PowerShell profile 미지원 | bash/zsh/fish만 제공 |
| Standalone binary (`af-windows-x64.exe`) | ❌ 빌드 target 없음 | `.releaserc.yaml` 자산 미포함 |

## Required Work

### A. 빌드 & 배포 (Low effort)

- [ ] `package.json` `scripts`:
  ```json
  "build:windows-x64": "bun build --compile --minify --target=bun-windows-x64 src/index.ts --outfile dist/af-windows-x64.exe"
  ```
- [ ] `scripts.build:binary`에 windows target 추가
- [ ] `.github/workflows/release.yaml` `matrix.target`에 Windows 추가:
  ```yaml
  - { platform: bun-windows-x64, name: af-windows-x64.exe }
  ```
- [ ] `.releaserc.yaml`의 `@semantic-release/github` assets에 `dist/af-windows-x64.exe` 추가

### B. Chrome/Edge cookie 자동 인증 (High effort)

Windows Chrome/Edge의 cookie 암호화는 **DPAPI (Data Protection API)** 기반이며 macOS Keychain과 다른 방식을 요구한다.

- [ ] `src/core/browser-paths.ts`에 Windows 경로 추가:
  - Chrome: `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Network\Cookies`
  - Edge: `%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Network\Cookies`
  - Local State: `%LOCALAPPDATA%\Google\Chrome\User Data\Local State` (master key 저장 위치)
- [ ] `src/adapters/browser/chrome-cookie.ts` 분기:
  - macOS: Keychain + AES-128-CBC + PBKDF2 (기존 로직 유지)
  - Windows: `Local State`의 `os_crypt.encrypted_key` base64 디코딩 → 첫 5바이트(`DPAPI`) 제거 → `CryptUnprotectData` 호출 → AES-GCM-256 (nonce 12바이트, tag 16바이트)
- [ ] DPAPI 호출 구현 옵션:
  - **Option 1**: Node `ffi-napi` / Bun `bun:ffi`로 `Crypt32.dll::CryptUnprotectData` 직접 호출
  - **Option 2**: `powershell -Command "[System.Security.Cryptography.ProtectedData]::Unprotect(...)"` 서브프로세스
  - **Option 3**: 해당 기능을 Windows에서 비활성화하고 수동 인증 가이드만 제공 (현재 상태 유지)
- [ ] 단위 테스트: Windows-only 테스트 skip 처리, GHA matrix에 `windows-latest` 추가

### C. IndexedDB 기반 인증 (Medium effort)

Chrome/Arc/Brave/Edge는 Chromium이므로 IndexedDB 경로만 맞으면 plaintext 토큰을 뽑을 수 있을 가능성이 있다 (macOS와 동일 원리).

- [ ] `src/core/browser-paths.ts`에 Windows IndexedDB 경로:
  - Chrome: `%LOCALAPPDATA%\Google\Chrome\User Data\Default\IndexedDB\`
  - Edge, Brave, Arc 각각의 `%LOCALAPPDATA%` 하위 경로
- [ ] `src/adapters/browser/indexeddb-reader.ts`: 이미 `node:fs` 기반이므로 경로만 맞으면 동작할 가능성 높음. 실기 검증 필요
- [ ] Windows 환경에서 Playwright/manual test로 IndexedDB 복구 경로 확인

### D. MCP Setup 경로 (Low effort)

- [ ] `src/cli/commands/setup.ts`의 Claude Code / Cursor / Claude Desktop config 경로:
  - Claude Code: `%USERPROFILE%\.claude.json` (기존 `~/.claude.json`과 동일 논리)
  - Cursor: `%USERPROFILE%\.cursor\mcp.json`
  - Claude Desktop: `%APPDATA%\Claude\claude_desktop_config.json`
- [ ] Windows에서 symlink 대신 `.cmd` shim 작성 (Bun이 자동 처리하지만 검증 필요)

### E. Completion script (Low effort)

- [ ] `src/cli/commands/completion.ts`에 PowerShell target 추가:
  ```bash
  af completion powershell > $PROFILE
  ```
- [ ] PowerShell `Register-ArgumentCompleter` 블록 생성 로직

### F. Documentation (Low effort)

- [ ] README.md Platform Support 섹션에 Windows 실제 동작 범위 명시 (완료 시 업데이트)
- [ ] `docs/akiflow-token-acquisition.md`에 Windows DPAPI 경로 추가 (해당 섹션 구현 완료 후)

## Dependencies & Blockers

- Bun Windows arm64는 실험 단계 — 당분간 x64만 target
- `bun:sqlite`는 Windows에서 동작 (Bun 공식 문서 확인 완료)
- `node:fs`, `node:crypto`, `node:path` 전부 Windows 호환
- DPAPI 호출을 위한 FFI 접근은 Bun 1.1+에서 지원 (`bun:ffi`)

## Acceptance Criteria

- [ ] `bun install -g akiflow-toolkit` 후 Windows PowerShell/CMD에서 `af --help` 동작
- [ ] Windows x64 standalone binary (`af-windows-x64.exe`)가 GitHub Release에 게시됨
- [ ] `af setup claude-code`가 Windows 경로(`%USERPROFILE%\.claude.json`)에 atomic merge 수행
- [ ] `af auth` 수동 플로우 정상 (B가 deferred 상태여도 OK)
- [ ] (stretch) DPAPI 복호화로 Chrome/Edge 자동 인증 성공
- [ ] 최소 1개 CI job (`windows-latest`)에서 unit test 통과

## Priority & Sequencing

- **Priority 1**: A (빌드/배포) — 1일 작업, 즉시 가치
- **Priority 2**: D (Setup 경로), E (Completion) — 각 0.5일
- **Priority 3**: C (IndexedDB) — 1~2일, 실기 검증 포함
- **Priority 4**: B (DPAPI Chrome cookie) — 3~5일, Windows 환경 필수

## References

- Bun Windows 지원: https://bun.sh/docs/installation
- Chromium DPAPI cookie encryption: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/os_crypt/sync/os_crypt_win.cc
- Bun FFI: https://bun.sh/docs/api/ffi
- PowerShell completion: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/register-argumentcompleter
