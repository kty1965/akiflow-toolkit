---
title: "Task — Linux platform support"
createdAt: 2026-04-20T00:00:00+09:00
updatedAt: 2026-04-20T00:00:00+09:00
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

## Status

🟡 **Partial** — Bun runtime이 Linux x64/arm64를 공식 지원하므로 CLI/MCP는 동작한다. 단 Chrome cookie 기반 자동 인증이 libsecret/kwallet 미연동으로 동작하지 않고, standalone binary는 GitHub Release에 이미 포함되어 있다.

## Goal

Linux (Ubuntu/Debian/Fedora/Arch 등) 사용자가 `akiflow-toolkit` 전 기능을 사용할 수 있도록 만든다. 특히 GNOME Keyring / KDE KWallet 기반 Chrome cookie 자동 인증을 복구한다.

## Current State

| 영역 | 현재 | 비고 |
|------|------|------|
| Bun runtime | ✅ Linux x64/arm64 네이티브 | 성숙도 높음 |
| CLI core (`add`, `ls`, `do`, `task`, `cache`) | ✅ 동작 | 순수 HTTP + node:fs |
| MCP 서버 (`af --mcp`) | ✅ 동작 | stdio JSON-RPC |
| Standalone binary (`af-linux-x64`, `af-linux-arm64`) | ✅ 이미 GHA matrix에 포함 | Release 자산으로 게시 중 |
| `af setup claude-code` / `cursor` | ✅ `~/.config` / `~/.claude.json` 경로 동작 | XDG 규격 |
| `af setup claude-desktop` | ❌ 미지원 | Claude Desktop 자체가 Linux 미지원 |
| `af auth` (수동) | ✅ 동작 | Bearer JWT 직접 입력 |
| `af auth` (자동 — IndexedDB) | ⚠️ 미검증 | 경로 코드 없음, 구현 확인 필요 |
| `af auth` (자동 — Chrome/Brave/Edge cookie) | ❌ 미지원 | libsecret(Secret Service) 미연동 |
| `af auth` (자동 — Safari) | ❌ 해당 없음 | Apple 전용 |
| Completion script | ✅ bash/zsh/fish | Linux 표준 셸 전부 커버 |

## Required Work

### A. Chrome/Chromium cookie 자동 인증 (High effort)

Linux Chrome/Chromium 계열 브라우저는 cookie 암호화에 `Secret Service API`(libsecret) 또는 kwallet을 사용한다. `chrome-cookie.ts`는 현재 macOS Keychain만 지원한다.

암호화 체계 요약:
- Chrome이 랜덤 master password를 생성
- master password를 libsecret (GNOME) 또는 kwallet (KDE)에 저장
- 저장 실패 시 fallback password `"peanuts"` 사용
- 쿠키 값은 PBKDF2(password, "saltysalt", 1 iteration, 16바이트) → AES-128-CBC
- 접두사 `v10` (peanuts) 또는 `v11` (libsecret)로 암호화 방식 구분

구현 항목:
- [ ] `src/core/browser-paths.ts`에 Linux 경로 추가:
  - Chrome: `~/.config/google-chrome/Default/Cookies`
  - Chromium: `~/.config/chromium/Default/Cookies`
  - Brave: `~/.config/BraveSoftware/Brave-Browser/Default/Cookies`
  - Edge: `~/.config/microsoft-edge/Default/Cookies`
- [ ] `src/adapters/browser/chrome-cookie.ts`를 OS 분기 구조로 리팩터:
  - `getDecryptionPassword(browser, platform)` 추상화
  - macOS: 기존 `getKeychainPassword` (Keychain)
  - Linux: 신규 `getSecretServicePassword` (libsecret DBus 호출)
- [ ] libsecret 접근 방식 옵션:
  - **Option 1**: `secret-tool lookup application chromium` 서브프로세스 호출 (libsecret-tools 패키지 필요)
  - **Option 2**: `gdbus call --session --dest org.freedesktop.secrets ...` DBus 직접 호출 (의존성 없음)
  - **Option 3**: 첫 트라이 libsecret → 실패 시 `"peanuts"` fallback
- [ ] `v10` (peanuts) / `v11` (libsecret) 접두사에 따라 password 선택
- [ ] 단위 테스트: Linux CI runner에 `gnome-keyring-daemon` 부재 시 fallback 경로 검증

### B. IndexedDB 기반 인증 (Medium effort)

`src/adapters/browser/indexeddb-reader.ts`는 순수 `node:fs` 기반이다. 경로만 올바르면 Linux Chrome/Chromium에서도 plaintext 토큰을 추출할 수 있을 가능성이 있다 (macOS 동일 원리).

- [ ] `src/core/browser-paths.ts`에 Linux IndexedDB 경로:
  - Chrome: `~/.config/google-chrome/Default/IndexedDB/`
  - Chromium: `~/.config/chromium/Default/IndexedDB/`
  - Brave, Edge 각각의 `~/.config` 하위 경로
- [ ] 실기 검증:
  - Ubuntu 22.04 또는 Fedora에서 Akiflow 로그인 후 IndexedDB 디렉터리 확인
  - `LOCK` 파일 경합 문제(macOS와 동일)가 Linux에서도 발생하는지 확인
- [ ] 발견된 경로를 `BrowserProfile`에 추가하고 회귀 테스트

### C. CDP fallback (Low effort)

`src/adapters/browser/cdp-launcher.ts`는 `/usr/bin/env which`로 바이너리를 찾는다. Linux 호환성 검증 필요.

- [ ] Linux 환경에서 Chrome/Chromium 실행 파일 이름:
  - `google-chrome`, `google-chrome-stable`
  - `chromium`, `chromium-browser`
  - `brave-browser`
  - `microsoft-edge`
- [ ] 현재 `BROWSER_ID_PATTERN` 체크(Chromium-family filter)가 Linux 변종도 허용하는지 회귀 테스트

### D. Packaging (Optional)

- [ ] **AUR** (Arch User Repository) 패키지: `akiflow-toolkit-bin` (prebuilt binary 설치)
- [ ] **Homebrew on Linux**: macOS와 동일 formula 가능성 검토
- [ ] **snap / flatpak**: Bun runtime 묶음 복잡도 고려 시 후순위

## Dependencies & Blockers

- `bun:sqlite` Linux 동작 확인 완료
- libsecret DBus API는 Ubuntu/Debian/Fedora 기본 설치 (`libsecret-1-0`). Arch는 사용자 설정에 따라 다름
- kwallet (KDE)는 이번 Task 범위 밖으로 분리 가능
- `~/.config` XDG 규격은 node:path로 이미 올바르게 처리됨

## Acceptance Criteria

- [ ] `bun install -g akiflow-toolkit` 후 Linux에서 `af --help` 동작
- [ ] 수동 `af auth` + CLI/MCP 전 명령어 정상
- [ ] (stretch) Chrome/Chromium cookie 자동 인증 성공 (libsecret 경로)
- [ ] CI에 `ubuntu-latest` matrix 추가, unit test 통과
- [ ] README `Platform Support` 섹션의 Linux 열이 ✅로 업데이트됨

## Priority & Sequencing

- **Priority 1**: B (IndexedDB 검증) — 경로만 맞으면 macOS와 동일 경로 재활용, 1일 내 완료 가능성
- **Priority 2**: C (CDP fallback 회귀 검증) — 0.5일
- **Priority 3**: A (Chrome cookie libsecret) — 2~3일, DBus 호출 구현
- **Priority 4**: D (AUR/Homebrew 패키징) — 커뮤니티 수요 시

## References

- Chromium Linux cookie encryption: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/os_crypt/sync/os_crypt_linux.cc
- libsecret Secret Service DBus spec: https://specifications.freedesktop.org/secret-service/latest/
- `secret-tool` CLI: https://gitlab.gnome.org/GNOME/libsecret
- Bun Linux 지원: https://bun.sh/docs/installation
