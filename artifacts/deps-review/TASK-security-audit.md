---
title: "Task — Security Vulnerability Audit (Pre-publish)"
createdAt: 2026-04-19T23:10:00+09:00
updatedAt: 2026-04-19T23:10:00+09:00
version: "1.0.0"
type: spec
tags:
  - security
  - audit
  - pre-publish
  - threat-model
---

# Task: Security Vulnerability Audit

## Status
🟡 **In Progress** — 현재 세션에서 실행.

## Why Now

- Pre-alpha 상태지만 곧 npm 퍼블리시 예정 (semantic-release workflow 대기 중, W7)
- Reverse-engineered API + 로컬 민감 데이터(Chrome/Safari 토큰) 접근이라 표면이 넓음
- Binary 배포(4 플랫폼)로 공급망 공격 surface 존재
- Bun 런타임 고유 고려사항 (fetch, `Bun.file`, `--compile` single-file binary)

## Scope & Threat Model

### Assets
1. **사용자 Akiflow 자격증명** (`~/.config/akiflow/auth.json`의 `accessToken`, `refreshToken`)
2. **브라우저 세션 데이터** (Chrome Cookies SQLite, IndexedDB leveldb, Safari binarycookies)
3. **릴리스 공급망** (npm 패키지 + GitHub Releases 바이너리)
4. **MCP 서버 세션** (stdio JSON-RPC, Claude Code 등이 호출)

### Threat Actors
- 로컬 악성 프로세스 (토큰 탈취 시도)
- MCP 클라이언트 입력 악용 (prompt injection → tool 호출)
- 공급망 공격자 (의존성/릴리스 가로채기)
- 악의적 dependabot PR (실수로 merge 유도)

### Out of Scope
- Akiflow backend 자체 취약점
- 사용자의 Chrome 프로필 완전 격리
- OS 수준 권한 (assume trusted OS)

## Audit Checklist

### A. Dependency Vulnerabilities (자동)
- [ ] `bun audit` (또는 equivalent) — known CVE
- [ ] GitHub Dependabot security alerts 상태 확인 (권한 필요)
- [ ] `package.json` 직접 dep / devDep 버전 점검
- [ ] Lockfile 재현성 (`bun.lock` frozen)

### B. Secret Handling
- [ ] `auth.json` 파일 권한 (0600 기대)
- [ ] `configDir` 권한 (0700 기대)
- [ ] Secret이 stdout/stderr로 새는지 (logger 레벨별 검토)
- [ ] Secret이 에러 메시지에 포함되는지 (사용자에게 표시되는 `userMessage`)
- [ ] `.gitignore`에 `auth.json`, 캐시 dir, `.env*` 포함 여부
- [ ] 테스트 fixture에 실제 토큰이 아닌 sentinel value인지
- [ ] Token이 process env로 넘어가 `ps aux`에 노출되지 않는지

### C. Input / Network Boundary
- [ ] `process.env.AF_*` 검증 — 악의적 값이 주입 가능한 지점
- [ ] HTTPS 강제 (http:// URL 허용 안 됨)
- [ ] URL 파싱 시 SSRF 가능성 (`AF_API_BASE_URL` override)
- [ ] `fetch()`에 전달되는 URL이 user-controlled와 섞이는 위치
- [ ] MCP tool 입력의 zod validation 범위 확인 (안전 default)

### D. Process / Filesystem
- [ ] `child_process.spawn` / `exec` (특히 CDP launcher) — shell injection
- [ ] 파일 경로 조합 시 path traversal (`..` handling)
- [ ] `readFileSync` / `readdirSync` 대상 경로 whitelist 여부
- [ ] Chrome profile 읽기 시 사용자 아닌 경로 접근 방지

### E. Regex / Parser DoS
- [ ] `REFRESH_RE = /def50200[a-f0-9]{200,}/` — catastrophic backtracking 가능성
- [ ] `JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g` — ReDoS
- [ ] `JSON.parse` 전 입력 크기 제한
- [ ] LevelDB latin1 read 크기 제한 (무한 파일 대비)

### F. MCP Server Surface
- [ ] stdio 파괴 방지 (ADR-0009 — stdout은 JSON-RPC 전용)
- [ ] Tool 에러 응답이 민감 정보 누출 안 함
- [ ] Tool input UUID/date 검증 우회 불가
- [ ] `complete_task`, `delete_task` 같은 destructive tool의 `destructiveHint` annotation

### G. Supply Chain
- [ ] `release.yaml` `permissions:` 최소권한 확인
- [ ] `contents: write`, `id-token: write` 등이 실제로 필요한지
- [ ] Third-party action pin (SHA vs tag)
- [ ] `semantic-release` plugin 순서 검증 (특히 `@semantic-release/git` 전에 lint 완료)
- [ ] Binary 빌드 재현성 (`--compile --minify`)
- [ ] npm publish provenance (OIDC 전환 대기 중 — W7)

### H. Documentation / Disclosure
- [ ] `DISCLAIMER.md` — reverse-engineered API 명시
- [ ] `SECURITY.md` 존재 여부 (CVD 채널)
- [ ] README에 보안 관련 안내

## Deliverables

1. **SECURITY-AUDIT-REPORT.md** — 발견 사항 severity별 정리
2. **ADR 또는 후속 TASK** — 발견된 high/critical 이슈별 수정 계획
3. **(선택) SECURITY.md** — CVD 채널 안내

## Severity Classification

| Level | 기준 | 대응 |
|------|------|------|
| **Critical** | 인증 우회, RCE, 원격 자격증명 유출 | 즉시 수정 + patch release |
| **High** | 로컬 자격증명 유출, 공급망 훼손 가능 | 1주 이내 수정 |
| **Medium** | 제한된 조건 하 민감 정보 노출 | 다음 minor에 수정 |
| **Low** | 로깅 노이즈, defense-in-depth 개선 | backlog |
| **Info** | Best-practice 권고 | 판단 재량 |

## Execution Plan (이번 세션)

1. A~H 병렬 점검
2. 발견 사항 수집
3. `SECURITY-AUDIT-REPORT.md` 작성
4. Severity High 이상은 바로 수정 제안 패치
5. Medium 이하는 후속 TASK 분리

## Related

- `artifacts/deps-review/WAVES.md` — W13으로 추가 예정
- W7 release workflow — OIDC 전환 시 provenance 자동 첨부 (공급망 강화)
- ADR-0009 stdout 보호 (MCP surface)
- ADR-0003 3-tier auth recovery (secret lifecycle)
