---
title: "Dependency Upgrade Wave Plan & Retrospective"
createdAt: 2026-04-17T14:05:00+09:00
updatedAt: 2026-04-19T22:55:00+09:00
version: "1.2.0"
type: report
tags:
  - dependabot
  - wave-plan
  - retrospective
  - migration
---

# Dependency Upgrade — Wave Plan & Retrospective

## 📜 Timeline Overview

| Wave | 상태 | 범위 | 실제 순서 |
|------|-----|------|----------|
| **W0** — release.yaml 선제 | ✅ | #29 | 계획 순서대로 |
| **W1** — ci.yaml GHA | ✅ | #17, #16 | 계획 순서대로 |
| **W1.5** — bun.lock hotfix | ✅ | #31 | **돌발 추가 (분석 초기 누락)** |
| **W2** — commitlint v20 | ✅ | #18, #35 | 계획 순서대로 (#19→#35로 recreate) |
| **W3** — semantic-release plugins | ✅ | #36, #37 | 계획 순서대로 (#20/#21→#36/#37로 recreate) |
| **W4** — 사용자 병행 작업 | ✅ | #30 (tsc pre-commit + zod v3 pin) | **독립적으로 진행됨** |
| **W5** — release.yaml GHA 잔여 | ✅ | #32, #33, #34 | 분석 후 추가 발견 |
| **W6** — biome v2 migration | ✅ | #39 | 분석 후 추가 발견 |
| **W7** — release workflow 복구 | 🟡 대기 | NPM_TOKEN 설정 / OIDC 전환 | **신규 식별** |
| **W8** — Cache invalidation on writes | ✅ | TaskCommandService → `cache.upsertTask` | Tier 2 E2E로 발견, 근본 fix 완료 |
| **W9** — IndexedDB 3-origin priority | ✅ | `auth → web → product` 우선순위 배열 | Auth 복구 자동화 |
| **W10** — MCP E2E Tier 2 스크립트 | ✅ | `scripts/mcp-live-demo.ts`, `scripts/mcp-api-probe.ts` | Live 검증 자동화 |
| **W11** — Auth flow 문서화 | ✅ | `docs/akiflow-token-acquisition.md` | Mermaid 다이어그램 5종 |
| **W12** — TypeScript path aliases | ✅ | `@core @adapters @mcp @cli` (216 imports / 69 files) | TASK-typescript-path-aliases.md |
| **W13** — Security audit | ✅ | Pre-publish 위협 모델 + S-1/S-2 fix | TASK-security-audit.md · SECURITY-AUDIT-REPORT.md |
| **W∞** — zod v4 migration | ✅ Resolved (2026-04-20) | TASK-zod-v4-migration.md | overrides.zod dedup으로 해제 |

---

## ✅ 처리 완료 Waves

### W0 — 선제 release.yaml 조치 (#29)
- `actions/checkout@v4` → `@v6` (build-binaries, release 두 job)
- `node-version: "22"` → `"22.14"` (semantic-release v12/v13 min requirement)
- **성과**: 이후 W3 머지 시 Node 하한선 불일치 리스크 제거

### W1 — ci.yaml GHA 업그레이드 (#17, #16)
- `actions/checkout` v4 → v6 (ci.yaml 내 2곳)
- `actions/setup-python` v5 → v6 (pre-commit job)
- **성과**: 사전 분석 Low Risk 그대로 통과

### W1.5 — bun.lock + dependabot 생태계 복구 (#31)
- **문제**: dependabot이 `package-ecosystem: "npm"`로 설정되어 있어 PR에 `bun.lock`을 포함하지 않음. #18 머지 후 main의 package.json과 bun.lock 불일치 → CI 전체 실패.
- **조치**:
  - 로컬에서 `bun install`로 lockfile 재생성
  - `.github/dependabot.yaml`을 `package-ecosystem: "bun"`으로 전환
- **성과**: 이후 dependabot PR은 자동으로 bun.lock 포함, 기존 PR 4개는 recreate 필요
- **레슨**: 런타임 매니저(Bun)와 dependabot 생태계 설정 일치 확인은 프로젝트 초기 점검 체크리스트로

### W2 — commitlint v20 (#18, #35)
- `@commitlint/cli` 19 → 20 (#18, #19→#35 recreate)
- `@commitlint/config-conventional` 19 → 20
- config `extends`만 사용 + husky 없음 → migration 불필요
- **성과**: 원안대로 Low Risk 검증 완료

### W3 — semantic-release plugins (#36, #37)
- `@semantic-release/npm` 12 → 13
- `@semantic-release/github` 11 → 12
- **성과**: W0 선제 Node 22.14 pin 덕에 하한선 충돌 없음. CI/config 무변경.

### W4 — 사용자 병행 작업 (#30)
- `fix: add tsc pre-commit hook, refresh mutex, and cache-integrated sync`
- **중대 영향**: 이 PR의 마지막 커밋 `fix: pin zod to v3 for MCP SDK type compatibility`로 **W5에서 머지했던 #38(zod v4)의 실질 효과를 되돌림**
- **레슨**: dep major bump 분석에서 peer dep range만 보고 "Low Risk" 판정한 내 초기 리포트가 틀렸음을 밝힘. tsc 실측 필요성 확인.

### W5 — release.yaml GHA 잔여 (#32, #33, #34)
- `actions/download-artifact` v4 → v8
- `actions/setup-node` v4 → v6
- `actions/upload-artifact` v4 → v7
- **성과**: ci.yaml/release.yaml GHA 버전 전부 통일. 현재 사용 옵션 모두 신버전 호환.

### W6 — biome v2 (#39)
- `@biomejs/biome` 1.9.4 → 2.4.12
- `biome.json` 수동 마이그레이션 완료 (`$schema` v2로, `organizeImports` → `assist.actions.source.organizeImports`, `files.ignore` → `files.includes` 배열 포맷)
- **성과**: 새 schema 포맷 반영, `bunx biome migrate` 사용한 것으로 추정

---

## 🟡 남은 Waves

### W7 — Release Workflow 복구 (우선순위: High)

**문제 (현재 main에서 관측)**:
- 최근 release workflow run: FAILURE
- 에러: `SemanticReleaseError: No npm token specified. (code: ENONPMTOKEN)`
- `@semantic-release/npm` v13부터 **trusted publishing / OIDC 검증이 엄격**해졌으며 (v13.1 release notes: "verify auth, considering OIDC vs tokens from various registries"), `NPM_TOKEN` 환경변수가 없으면 verifyConditions 단계에서 즉시 fail.

**선택지**:

| 옵션 | 설명 | 장단점 |
|------|-----|-------|
| A. NPM_TOKEN secret 설정 | GitHub repo secrets에 npm automation token 추가 | 간단. 토큰 순환 부담 |
| B. OIDC Trusted Publishing 도입 | npm registry에 GitHub OIDC provider 등록 → id-token 기반 인증 | 토큰 관리 불필요. npm 쪽 설정 필요 |
| C. npm publish 생략 (local binary만 릴리스) | `.releaserc.yaml`에서 `@semantic-release/npm` 제거하거나 `npmPublish: false` | npm 배포 포기 시만 유효 |

**추천**: B (OIDC) — release.yaml에 이미 `id-token: write` permission 부여되어 있음. npm automation token 순환 부담 없음.

**Verification**:
- [ ] 옵션 선택 및 실행
- [ ] main push 시 release workflow가 verifyConditions 단계 통과하는지 확인
- [ ] 다음 conventional commit에서 첫 릴리스(v1.0.0 or 상응) 생성되는지 확인

### W12 — TypeScript Path Aliases (우선순위: Medium)

**목적**: `../../../core/ports/logger-port.ts` 같은 3+ 단계 deep import 108건을 `@core/ports/logger-port.ts` 같은 root-based alias로 대체.

**측정값 (2026-04-19)**:
- 3+ `../` 깊이 import: **108 건**
- 영향 파일: **33 개**
- Top: `core/types.ts` (21), `core/ports/logger-port.ts` (20), `core/errors/index.ts` (17)

**설계 (권장)**:
```jsonc
"paths": {
  "@core/*":      ["./src/core/*"],
  "@adapters/*":  ["./src/adapters/*"],
  "@mcp/*":       ["./src/mcp/*"],
  "@cli/*":       ["./src/cli/*"],
  "@config":      ["./src/config.ts"],
  "@composition": ["./src/composition.ts"]
}
```
- **Cross-layer만** alias, 같은 레이어 내부는 상대경로 유지 (응집성 + Hexagonal 경계 명시)
- Bun runtime / `bun test` / `bun build --compile` / biome / tsc 전부 네이티브 지원

**호환성 체크**: tsc ✅, Bun ✅, Bun compile ✅, Biome v2 organizeImports ✅, IDE (VSCode/JB) ✅, `allowImportingTsExtensions` ✅

**Migration**: `scripts/rewrite-imports.ts` codemod (~30줄) → 자동 일괄 변환 + 같은 레이어는 건드리지 않음

**상세 spec**: [TASK-typescript-path-aliases.md](./TASK-typescript-path-aliases.md)

**Effort**: 1~2 시간 (codemod + 검증)

---

### W13 — Security Audit (✅ 완료)

**Trigger**: npm publish 전 pre-alpha 상태에서 위협 모델 + 취약점 감사.

**범위 (A–H)**: 의존성 CVE, secret 처리, 환경 입력, 프로세스/FS 호출, regex DoS, MCP surface, 공급망, 공개 채널.

**Findings 요약**:
- 🔴 Critical 0 · 🟠 High 0 · 🟡 Medium 1 · 🟢 Low 3 · ℹ️ Info 11
- `bun audit`: 0 vulnerabilities
- 파일 권한 0600/0700 정상, stderr 마스킹 정상, MCP stdout 보호 정상
- **Medium (S-2)**: `AF_API_BASE_URL`/`AF_AUTH_BASE_URL`이 임의 URL 허용 → MITM으로 Bearer JWT 탈취 가능
- **Low (S-1)**: `execSync(\`security find-generic-password -s "${service}" -w\`)`와 `execSync(\`command -v ${cmd}\`)`이 shell template 패턴 — 현재 input은 hardcoded라 exploit 없음. Defense-in-depth

**Patches (1차 — S-1, S-2)**:
- `src/config.ts`: `parseBaseUrl` 추가 — HTTPS 강제, invalid URL reject, `AF_ALLOW_INSECURE_BASE_URL=1`로 dev opt-in
- `src/adapters/browser/chrome-cookie.ts`: `execSync` → `execFileSync` (argv array, shell 미개입)
- `src/adapters/browser/cdp-launcher.ts`: `execSync` → `execFileSync /usr/bin/env which` + `/^[A-Za-z0-9._/-]+$/` whitelist

**Patches (2차 — S-5, S-7, S-13)**:
- **S-5 (Cookie misattribution + logger binary defense)**:
  - `src/adapters/browser/chrome-cookie.ts` · `safari-cookie.ts`: decrypted Laravel 세션 쿠키를 JWT/refresh 정규식으로 필터링 후 매치될 때만 `ExtractedToken` 반환. raw 바이트가 `accessToken` 자리에 저장되는 경로 제거
  - `src/adapters/observability/stderr-logger.ts`: control-char 밀도 > 10% 문자열은 `<binary:N bytes, M control>`로 collapse
- **S-7 (GHA SHA 핀)**:
  - `.github/workflows/ci.yaml` · `release.yaml`의 모든 third-party action (13곳) SHA 핀 + `# vX.Y.Z` 주석 병기. Dependabot이 SHA와 주석 동시 업데이트
- **S-13 (CDP port-squat defense)**:
  - `src/adapters/browser/cdp-launcher.ts`:
    - `BROWSER_ID_PATTERN`: `/json/version` Browser 필드가 Chromium-family 아니면 거부
    - `isLocalDebuggerUrl`: `webSocketDebuggerUrl`이 `ws://127.0.0.1:<this.port>/`가 아니면 거부
    - 신규 option `validateTokenFn`: 캡처 토큰을 사용자 정의 함수로 검증 (실제 Akiflow API ping 등)

**신규 테스트**:
- `src/__tests__/config.test.ts`: URL validation 7개 (https 강제, http 거부, file:/javascript:/data: 거부, insecure opt-in, empty fallback)
- `src/__tests__/adapters/observability/stderr-logger.test.ts`: binary collapse 3개 (control char >10%, 정상 로그 보존, min-length threshold)
- `src/__tests__/adapters/browser/safari-cookie.test.ts`: Bearer-usable 필터 3개 (plain session null 반환, JWT 추출, refresh 추출)
- `src/__tests__/adapters/browser/cdp-launcher.test.ts`: port-squat defense 4개 + validateTokenFn 2개

**Verification**:
- `bun test` → 425/425 pass (초기 407 + W13 총 18 security tests)
- `bunx tsc --noEmit -p tsconfig.json` → clean
- Biome check → clean

**상세**: [SECURITY-AUDIT-REPORT.md](./SECURITY-AUDIT-REPORT.md), [TASK-security-audit.md](./TASK-security-audit.md)

---

### W∞ — zod v4 Migration (Final Wave, Deferred)

상세 spec: `artifacts/deps-review/TASK-zod-v4-migration.md`

**요약**:
- 현재 `"zod": "^3.24.4"` pinned (MCP SDK 타입 호환성)
- 블로커: `@modelcontextprotocol/sdk` 타입 정의가 zod v4 구조 미지원
- 해제 경로: (A) MCP SDK 업스트림 업데이트 대기 ← 추천, (B) 로컬 타입 패치, (C) zod/MCP decouple 리팩토링
- Verification: tsc `--noEmit` 실측 통과 필수

---

### W8 — Cache invalidation on writes (✅ 완료)

**배경**: Tier 2 E2E 실행 중 `create_task` 직후 `get_tasks(inbox)`가 방금 만든 task를 30초간(cache TTL) 놓치는 read-your-writes 위반 발견.

**원인**: `TaskCommandService.createTask / updateTask / completeTask / scheduleTask / unscheduleTask / deleteTask` 어느 메서드도 `CachePort.upsertTask`를 호출하지 않음. `TaskQueryService.listTasksWithCache`는 TTL 내면 캐시 그대로 반환.

**Fix**:
- `src/core/services/task-command-service.ts`: `CachePort?` 주입 + `patchSingle` 끝에서 `cache.upsertTask(task)` 호출
- `src/composition.ts`: `taskCommand = new TaskCommandService({ ..., cache })` 주입
- `src/__tests__/core/services/task-command-service.test.ts`: 5개 신규 테스트 (upsert 호출 확인, 5개 write 메서드 모두 cover, cache undefined OK, cache throw swallow, error시 cache 안 건드림)

**Related**: `TASK-cache-invalidation-on-writes.md` (원래는 별도 PR 권장으로 썼으나 Tier 2 차단 때문에 즉시 수정)

### W9 — IndexedDB 3-origin Priority (✅ 완료)

**배경**: Chrome `~/Library/Application Support/Google/Chrome/Default/IndexedDB/` 에 Akiflow가 3개 origin의 leveldb를 남김:
- `https_auth.akiflow.com_0.indexeddb.leveldb` (신규 OAuth endpoint)
- `https_web.akiflow.com_0.indexeddb.leveldb` (legacy, 현재도 토큰 있음)
- `https_product.akiflow.com_0.indexeddb.leveldb` (새 앱 상태)

기존 코드는 `web.akiflow.com`만 스캔 → `auth.akiflow.com`에 토큰이 있으면 놓침.

**Fix**:
- `src/core/browser-paths.ts`: `indexedDbPath: string` → `indexedDbPaths: string[]`
- `src/adapters/browser/browser-detector.ts`: 상수 3개를 priority 배열로, 각 browser profile마다 3개 candidate
- `src/adapters/browser/indexeddb-reader.ts`: `extract()` → `extractFromPath()` 순회 로직, 첫 성공 반환
- `src/__tests__/adapters/browser/indexeddb-reader.test.ts`: 5개 신규 테스트 (missing fallthrough, priority wins over freshness, skip no-JWT, all absent null, empty array null)

**Verification**: 실제 사용자 환경에서 `auth.akiflow.com` 실패 → `web.akiflow.com` 성공 확인 (IndexedDB reader log)

### W10 — MCP E2E Tier 2 스크립트 (✅ 완료)

**목적**: InMemoryTransport 기반 46 unit tests만 있던 상태에서 진짜 stdio 프로세스 + 실제 Akiflow 서비스 E2E 검증 필요.

**산출물**:
- `scripts/mcp-live-demo.ts` — 실제 `af --mcp` spawn + 9단계 flow (preflight → spawn → tools/list → auth_status → READ precheck → create → verify inbox → complete → verify done)
- `scripts/mcp-api-probe.ts` — auth.json 진단 + 헤더 포함 raw fetch → `err.cause`까지 노출
- 2026-04-19 전 단계 통과 확인

**발견**: W8(cache invalidation), auth cookie tier misattribution 버그, `NetworkError.cause` 로깅 누락

### W11 — Auth Flow 문서화 (✅ 완료)

**산출물**: `docs/akiflow-token-acquisition.md` (345 lines)
- 섹션 10개 + Mermaid 다이어그램 5개 (flowchart + sequenceDiagram)
- 이중 인증 체계(Laravel 세션 vs OAuth JWT) 명시
- 4-tier cascade, withAuth 복구 sequence, token 포맷 레퍼런스, 파일/경로 표, 알려진 실패 모드 6개

---

## 🎓 Retrospective Lessons

1. **Peer dep range ≠ Type compat**: `"zod": "^3.25 || ^4.0"` 같은 peer 선언은 "런타임 로드 가능"일 뿐 타입 호환을 보장하지 않는다. 앞으로 schema 라이브러리 major bump는 **default Med Risk**, tsc 실측 결과만을 Low Risk 근거로 인정.
2. **Dependabot 생태계 검증 선제**: Bun 프로젝트에 `package-ecosystem: npm`이 설정되어 있어 PR에 lockfile 누락 → main broken. 런타임 매니저 전환 시 dependabot 설정도 반드시 확인.
3. **Dependabot PR은 파일 scope가 좁다**: #17이 ci.yaml만, release.yaml은 별도 PR로 생성됨. 동일 action의 여러 사용처를 한 번에 업그레이드하려면 수동 통일 또는 `groups` 설정 필요.
4. **초기 계획 외 추가 발견(#32, #33, #34, #39)**: 분석 시점에 main에 없던 PR들이 dependabot 재생성 시 함께 떠올랐다. Wave 계획은 고정된 리스트가 아니라 동적 업데이트 가능한 구조여야 한다.
5. **Release workflow는 plugin major bump와 별개의 환경 설정 이슈를 가질 수 있다**: 이번엔 NPM_TOKEN이 원인. Plugin breaking change만 분석하지 말고 인증/권한 설정까지 점검 필요.

---

## 📌 참고

- 상세 PR별 분석: `pr22-zod.md`, `pr20-21-semantic-release.md`, `pr18-19-commitlint.md`, `pr16-17-gha.md`
- 최종 권장 요약: `SUMMARY.md`
- Final Wave 상세: `TASK-zod-v4-migration.md`
