---
title: "ADR-0021: 배포 전략 — Bun-Only 단일 런타임"
createdAt: 2026-04-20T00:00:00+09:00
updatedAt: 2026-04-20T00:00:00+09:00
version: "1.0.0"
type: artifact
status: accepted
date: 2026-04-20
decision-makers:
  - Huy
consulted:
  - Claude Code (Opus 4.7)
informed:
  - 팀 전체
tags:
  - adr
  - distribution
  - runtime
  - bun
  - npm
  - sqlite
  - package-size
---

# ADR-0021: 배포 전략 — Bun-Only 단일 런타임

## Context and Problem Statement

[ADR-0001](./ADR-0001-runtime-selection-bun.md)에서 **개발/실행 런타임**을 Bun으로 선택한 상태에서, 실제로 npm 레지스트리에 v1.0.0~v1.0.4를 릴리스하는 과정에 **실행 환경 호환성 문제**가 발생했다. ADR-0001의 "Bad: npx 호환 배포를 위해 `--target node`로 별도 JS 빌드 필요" 조항을 실제로 구현하면서 드러난 한계를 재검토하여, **배포 아티팩트(npm 패키지)가 어떤 런타임을 대상으로 할지** 결정해야 한다.

### 관측된 실패 사례 (v1.0.4)

`bun build ./src/index.ts --target node` 로 생성된 `dist/index.js`를 Node.js(shebang `#!/usr/bin/env node`)로 실행하면 다음 에러가 발생한다.

```
$ bun install -g akiflow-toolkit@1.0.4
$ af --help

Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]:
  Only URLs with a scheme in: file, data, and node are supported
  by the default ESM loader. Received protocol 'bun:'
    at throwIfUnsupportedURLScheme (node:internal/modules/esm/load:241:11)
Node.js v20.19.1
```

### 근본 원인

`src/adapters/browser/chrome-cookie.ts:1` 의

```ts
import { Database } from "bun:sqlite";
```

가 `bun build --target node` 후에도 번들에 그대로 보존된다. `bun:sqlite`는 Bun 런타임에 내장된 네이티브 모듈 스키마(`bun:`)로, Node의 ESM 로더는 이 프로토콜을 인식하지 못한다. Bun 번들러는 `bun:` 스키마 import를 Node 호환 대체 모듈로 자동 변환하지 않는다(변환 대상 API가 존재하지 않음).

production 코드에서 `bun:*` 임포트를 사용하는 파일 전수 조사 결과:

| 파일 | 용도 | Bun 전용 사유 |
|------|------|--------------|
| `src/adapters/browser/chrome-cookie.ts` | Chrome Cookies DB (SQLite) 읽기 | Chrome macOS 쿠키 암호화(AES-128-CBC) 복호화를 위한 read-only SQLite 접근 |

단 1곳. 테스트 파일들은 `bun:test`를 쓰지만 `files` 필드에서 제외되어 npm 배포에는 포함되지 않는다.

## Decision Drivers

- **런타임 무결성**: 설치 후 `af --help`가 즉시 동작해야 하며, 숨겨진 의존성/기능 격차가 없어야 한다
- **코드 수정 최소화**: 이미 안정 동작 중인 `chrome-cookie.ts`의 SQLite 복호화 로직을 재검증 없이 유지
- **패키지 크기**: npm 다운로드/설치 속도, 사용자 디스크 사용, CI 대역폭
- **크로스 플랫폼**: macOS 외 Linux/Windows 사용자의 CLI/MCP 기능 접근성
- **유지보수 부담**: 듀얼 런타임 분기(Bun/Node)로 인한 테스트 매트릭스 폭증 회피
- **Provenance/감사성**: npm 공급망 공격 대비 패키지 내용물의 투명성

## Considered Options

1. **A. Bun-Only 배포** — shebang `#!/usr/bin/env bun`, `bun build --target bun`, 설치 전제로 Bun 런타임 요구
2. **B. `better-sqlite3` 교체** — `bun:sqlite` → `better-sqlite3` (Node/Bun 공통 동작), `--target node` 유지
3. **C. Node 디스패처 래퍼** — `dist/index.js`를 12줄짜리 Node 디스패처로 교체, 실제 실행은 pre-compiled 플랫폼 바이너리가 담당
4. **D. 조건부 동적 import** — 런타임 감지 후 `bun:sqlite`를 lazy dynamic import, Chrome cookie 기능은 Bun에서만 활성

## Decision Outcome

**선택: A. Bun-Only 배포**

### 이유

1. **ADR-0001 정합성 유지**: 이미 Bun 런타임을 전제로 아키텍처가 구성되어 있다. 배포 단계에서 Node 호환을 억지로 유지하는 것은 "Bun의 시작 속도/TypeScript 네이티브" 선택 근거를 약화시킨다.

2. **코드 변경 범위 0**: `chrome-cookie.ts`의 `bun:sqlite` 사용은 그대로 유지. 옵션 B는 AES-128-CBC 복호화 + PBKDF2 키 유도 + PKCS7 패딩 제거 로직 재검증 필요(보안 민감 코드). 옵션 D는 ESM의 top-level import 제약 우회에 트릭(`new Function("return import(...)")`)이 필요하고 번들러 external 설정이 얽힌다.

3. **패키지 크기가 오히려 작아짐**: 옵션 C는 pre-compiled 바이너리 4개를 npm에 포함시켜 단일 버전이 **~332MB**가 되는 반면, 옵션 A는 Bun 번들 **~1.2MB** 하나만 포함하면 된다 (아래 "Package Size Analysis" 참고).

4. **실제 제약은 "Chrome cookie 자동 추출"뿐**: Linux/Windows 사용자는 Bun을 설치하면 CLI/MCP 전 기능을 쓸 수 있고, Chrome cookie 자동 추출은 OS별 쿠키 암호화 방식(macOS Keychain / Linux libsecret / Windows DPAPI) 차이로 어차피 macOS 전용이었다. Bun-only 결정이 새로운 플랫폼 제약을 추가하지 않는다.

### Consequences

**Good:**

- npm 패키지 크기 **~99.6% 감소** (332MB → 1.2MB, "Package Size Analysis" 참조)
- 번들 아티팩트 단순화: `bun build --target bun` 한 줄, `scripts/post-build.ts`(shebang 재작성기) 삭제
- Chrome cookie 자동 추출 포함 전 기능이 macOS에서 그대로 동작
- Linux/Windows에서도 Bun 설치 시 CLI/MCP 모두 동작 (수동 `af auth` 경유)
- 번들러 external, 조건부 import 등 복잡한 트릭 불필요
- 테스트/개발 환경과 배포 환경의 런타임이 완전히 일치 (dev=prod parity)

**Bad:**

- **사용자가 반드시 Bun 1.1+을 사전 설치해야 함** — Node-only 사용자는 `af`를 쓸 수 없음. Bun 설치 한 줄(`curl -fsSL https://bun.sh/install | bash`)이지만 허들은 존재.
- `engines` 필드에서 `node`를 제거하므로 npm이 Node만 있는 환경에서 경고/블록할 가능성 (실제로는 peer/engine 필드는 정보성 경고에 그침)
- Windows arm64는 Bun 실험 단계 — x64 사용자만 안정적으로 가능
- PowerShell completion 스크립트 부재 (bash/zsh/fish만 지원) — Windows 사용자 DX 저하

**Neutral:**

- `.releaserc.yaml`의 semantic-release 자체는 Node로 실행 (release.yaml에서 `setup-node` 유지) — 배포 파이프라인은 듀얼 런타임 유지, 최종 산출물만 Bun 전용
- `bun install -g` 외에도 `npm install -g`, `pnpm add -g` 등 다른 매니저로 설치 가능하지만, 실행은 어차피 shebang이 지정한 `bun`을 요구

## Package Size Analysis

결정의 핵심 근거 중 하나인 패키지 크기를 정량화한다.

### 옵션별 npm tarball 크기 비교

| 옵션 | `dist/` 구성 | Unpacked | Tarball (gzip) | 주요 변수 |
|------|------------|----------|---------------|----------|
| **A. Bun-only (선택)** | `index.js` (번들 1.2MB) | **~1.2MB** | **~300KB** | Bun 네이티브 번들 1개 |
| B. better-sqlite3 | `index.js` (번들 1.5MB) + native prebuilt | ~3MB | ~800KB | `better-sqlite3` 설치 시 prebuilt binary 다운로드 (~2MB) |
| C. Node dispatcher | `index.js` (디스패처 ~1KB) + 4개 플랫폼 바이너리 | **~332MB** | **~128MB** | Bun 런타임이 각 바이너리에 내장되어 용량 폭증 |
| D. 조건부 import | `index.js` (번들 1.2MB) | ~1.2MB | ~300KB | 번들러 external 설정 + 런타임 감지 로직 추가 |

### 옵션 C 상세 (배포했던 v1.0.4와 동일 구조)

v1.0.4 실제 tarball 구성 (`npm pack akiflow-toolkit@1.0.4` 결과):

```
package/dist/af-darwin-arm64    61,663,648 bytes (~59 MB)
package/dist/af-darwin-x64      ~60 MB (추정)
package/dist/af-linux-arm64     ~90 MB (추정)
package/dist/af-linux-x64       99,889,778 bytes (~95 MB)
package/dist/index.js            1,179,443 bytes (~1.1 MB)  ← 이게 깨진 번들
package/LICENSE
package/README.md
package/package.json
총 unpackedSize: 332,117,000 bytes (~332 MB)
tarball (gzip):  128,115,707 bytes (~128 MB)
```

옵션 C는 `index.js`를 12줄짜리 디스패처로 바꾸더라도 바이너리 4개 총량은 그대로라 **330MB 수준 유지**.

### 옵션 A 상세 (이 ADR 선택안)

`bun build --target bun` 결과:

```
package/dist/index.js            ~1,240,000 bytes (~1.2 MB)
package/LICENSE
package/README.md
package/package.json
총 unpackedSize: ~1.3 MB
tarball (gzip):   ~300 KB (추정)
```

**약 **99.6%** 축소** (332MB → 1.3MB).

### 사용자 영향

| 지표 | 옵션 C (v1.0.4) | 옵션 A (이 ADR) | 개선 |
|------|---------------|---------------|-----|
| npm install -g 다운로드 | ~128MB | ~300KB | ~420배 |
| 설치 후 디스크 사용 | ~332MB | ~1.3MB | ~255배 |
| CI (GitHub Actions) 캐시 대역폭 | 높음 | 낮음 | 동일 비율 |
| 첫 실행 시작 속도 | ~5ms (native binary) | ~50ms (Bun run .js) | 옵션 A가 ~45ms 느림 |

옵션 A의 시작 속도 손실(~45ms)은 체감 불가한 수준이며, 설치 경험의 차이(128MB vs 300KB)가 훨씬 크게 작용한다고 판단.

## SQLite Support — Detailed Handling

### 현재 사용처

`src/adapters/browser/chrome-cookie.ts`:
- `new Database(cookiesDb, { readonly: true })` — Chrome의 Cookies SQLite DB를 read-only로 오픈
- `db.query("SELECT name, encrypted_value, host_key FROM cookies WHERE ...")` — prepared statement
- `.all()` — 모든 행 fetch

호출 빈도: `af auth` 또는 토큰 재인증 플로우(`withAuth` 재시도) 시에만. 일상적인 CRUD 경로에서는 호출되지 않음.

### Bun-Only 선택 시 처리

**변경 없음.** `bun:sqlite`를 그대로 유지. `bun build --target bun`은 `bun:sqlite` 임포트를 그대로 보존하며, Bun 런타임이 실행 시 네이티브로 해결한다.

### 옵션 B (`better-sqlite3`) 전환 시 영향 (선택 안 함)

선택되지 않았지만 향후 Node 호환이 필요해질 때 대안으로 기록:

```ts
// Before (bun:sqlite)
import { Database } from "bun:sqlite";
const db = new Database(path, { readonly: true });
const rows = db.query("SELECT ...").all();

// After (better-sqlite3)
import Database from "better-sqlite3";
const db = new Database(path, { readonly: true });
const rows = db.prepare("SELECT ...").all();
```

차이점:
- 함수명: `db.query` → `db.prepare` (둘 다 prepared statement 반환)
- 반환 타입: 미묘하게 다름 (Bun은 `unknown[]`, better-sqlite3는 `any[]` with type assertion 필요)
- Native module: `better-sqlite3`는 node-gyp 빌드 또는 prebuilt binary 다운로드 필요 → 네트워크 정책 엄격한 환경에서 설치 실패 가능

테스트 파일(`src/__tests__/adapters/browser/chrome-cookie.test.ts`)의 모킹 레이어도 `BrowserDataPort` 포트 인터페이스 수준으로만 상호작용하므로, sqlite 구현체 교체 시 직접 영향은 없음 (Hexagonal [ADR-0006] 효과).

### Revisit Trigger

- `@modelcontextprotocol/sdk`가 Bun 지원 중단 발표 시 → ADR-0001 함께 재검토
- Bun 사용자 기반이 충분히 작고 Node 사용자 요청이 빗발칠 때 → 옵션 B(`better-sqlite3`) 전환 재평가
- Chrome cookie 자동 추출 기능을 Linux/Windows로 확장하게 될 때 → OS별 쿠키 암호화 어댑터 분리 시 sqlite 추상화 layer 재도입

## Pros and Cons of the Options

### A. Bun-Only 배포 (선택)

- Good, because 코드/아키텍처 변경이 거의 없음 (`package.json` 스크립트 2줄 + shebang)
- Good, because npm 패키지 크기가 ~99.6% 감소
- Good, because dev/prod 런타임 일치 → 재현성 최대
- Good, because Chrome cookie 자동 추출 기능을 그대로 유지
- Bad, because 사용자가 Bun 설치 필요 (허들 증가)
- Bad, because Windows arm64는 Bun 실험 단계

### B. `better-sqlite3` 교체

- Good, because Node/Bun 모두에서 동작 → npm 생태계 전체에 열림
- Good, because 패키지 크기 적당 (~3MB)
- Bad, because Chrome cookie 복호화 로직이 보안 민감 → 라이브러리 교체 시 테스트 비용
- Bad, because Native module 빌드 의존성 (network 제한 환경에서 설치 실패 가능)
- Bad, because ADR-0001이 정한 "Bun 네이티브 기능 활용" 기조와 충돌

### C. Node 디스패처 래퍼

- Good, because 코드 변경 0 (build 스크립트만)
- Good, because 런타임 install 불필요 (바이너리 embedded Bun)
- Bad, because **패키지 크기 ~332MB** (주된 결정 요인)
- Bad, because Windows 바이너리 별도 빌드 필요 or Windows 미지원
- Bad, because npm 공급망 공격 시 바이너리 심볼 감사 어려움

### D. 조건부 동적 import

- Good, because Node에서 CLI/MCP 코어는 동작 (Chrome cookie만 비활성)
- Bad, because `new Function("return import('bun:sqlite')")` 트릭 필요 (번들러 우회)
- Bad, because 사용자 인지도 저하 (`af auth`가 런타임에 따라 실패 원인 달라짐)
- Bad, because ESM top-level 제약으로 테스트 복잡도 증가

## More Information

- **이 ADR과 관계된 커밋/릴리스**:
  - v1.0.0~v1.0.4: npm publish 시도 및 NPM_TOKEN/OIDC 관련 문제 (ADR-0004 보강 영역)
  - v1.0.4 게시 직후 관찰된 `ERR_UNSUPPORTED_ESM_URL_SCHEME` 에러로 본 ADR 작성
  - v1.0.5 (이후): Bun-only 전환 적용

- **관련 ADR**:
  - [ADR-0001](./ADR-0001-runtime-selection-bun.md) — 런타임 선택 (이 ADR의 전제)
  - [ADR-0002](./ADR-0002-cli-mcp-entrypoint-pattern.md) — 단일 진입점 (shebang 결정의 근거)
  - [ADR-0003](./ADR-0003-akiflow-authentication-strategy.md) — 인증 전략 (Chrome cookie = `bun:sqlite` 주 사용처)
  - [ADR-0004](./ADR-0004-release-automation-semantic-release.md) — 릴리스 자동화
  - [ADR-0006](./ADR-0006-hexagonal-architecture.md) — Hexagonal (sqlite 구현체 교체 여지 보장)

- **관련 문서**:
  - [docs/tasks/windows-support.md](../tasks/windows-support.md) — Windows 플랫폼 지원 후속 태스크
  - [docs/tasks/linux-support.md](../tasks/linux-support.md) — Linux 플랫폼 지원 후속 태스크
  - `README.md` → "Runtime Requirement — Bun Only" / "Platform Support" 섹션

- **레퍼런스**:
  - Bun 공식 문서: `bun build --target bun`
  - npm docs: `files`, `bin`, `engines`
  - Node.js ESM Loader: `ERR_UNSUPPORTED_ESM_URL_SCHEME` 정의
  - Chrome Cookies 암호화 구조(macOS): AES-128-CBC + PBKDF2(Keychain password) + 16바이트 0x20 IV

- **Revisit Triggers**:
  - @modelcontextprotocol/sdk가 Bun 지원 중단 시
  - Bun 2.x breaking change 시
  - Node-only 사용자 요청이 지속적으로 발생할 때 (GitHub issues 집계)
  - Windows arm64 Bun이 stable 승격될 때 → Windows 지원 확대 재평가
  - Chrome cookie 자동 추출을 Linux/Windows로 확장할 때 → sqlite 추상화 레이어 재설계
