---
title: "ADR-0015: 테스트 전략 — Test Diamond + Port Mocking"
createdAt: 2026-04-15T19:00:00+09:00
updatedAt: 2026-04-15T19:00:00+09:00
version: "1.0.0"
type: artifact
status: accepted
date: 2026-04-15
decision-makers:
  - Huy
consulted:
  - testing-helper:test-engineer
  - iterative-architecture:tradeoff-analyst
informed:
  - 팀 전체
tags:
  - adr
  - testing
  - test-diamond
  - port-mocking
---

# ADR-0015: 테스트 전략 — Test Diamond + Port Mocking

## Context and Problem Statement

본 프로젝트는 역공학 API 의존, 브라우저 파일 읽기, CDP 상호작용, CLI/MCP 두 진입점 등 테스트 대상이 다양하다. 기존 `testing-helper` 플러그인의 TP-TEST 표준(Test Diamond, Given-When-Then)을 어떻게 적용할지 결정이 필요하다. 테스트 피라미드 vs 다이아몬드, mock 전략, fixture 관리, E2E 범위 등이 포함된다.

## Decision Drivers

- **빠른 피드백**: 단위 테스트는 1초 내 전체 실행
- **역공학 안정성 검증**: 실제 Akiflow API 연동 확인 필요 (제한적)
- **외부 의존성 격리**: 테스트에서 실제 브라우저/네트워크 접근 최소화
- **Bun 생태계**: `bun:test` 내장 테스트 러너 활용
- **TP-TEST 표준 준수**: 팀 표준 `testing-helper`의 규약
- **ADR-0006 Hexagonal과 정합**: Port mocking이 자연스럽게 가능

## Considered Options

1. **Test Diamond (Unit 55% / Integration 40% / E2E 5%) + Port Mocking** — TP-TEST 표준
2. **Test Pyramid (Unit 70% / Integration 20% / E2E 10%)** — 전통적
3. **Unit 중심 + Contract Tests** — Pact 등 컨슈머 주도

## Decision Outcome

**선택: Test Diamond (Unit 55% / Integration 40% / E2E 5%) + Port Mocking**

### 계층별 테스트 정의

#### 1. Unit Tests (55% — src/__tests__/core/, src/__tests__/adapters/)

**대상**: core/services, core/utils, 개별 adapter의 내부 로직

**특징**:
- Port mock으로 외부 의존성 완전 격리
- 실행 시간 < 10ms per test
- 런타임: `bun:test`
- Given-When-Then 주석 필수 (TP-TEST-002)

```typescript
// __tests__/core/services/auth-service.test.ts
import { describe, test, expect, mock } from "bun:test";
import { AuthService } from "../../../core/services/auth-service.ts";

describe("AuthService", () => {
  describe("authenticate", () => {
    test("disk에 유효한 크리덴셜이 있으면 즉시 반환", async () => {
      // Given
      const storage = mock(() => ({
        loadCredentials: async () => validCreds,
        saveCredentials: async () => {},
      }))();
      const service = new AuthService({ storage, browserReaders: [], cdpBrowser, http, logger });

      // When
      const result = await service.authenticate();

      // Then
      expect(result).toEqual(validCreds);
      expect(storage.loadCredentials).toHaveBeenCalledTimes(1);
    });
  });
});
```

#### 2. Integration Tests (40% — src/__tests__/integration/)

**대상**:
- CLI 명령어 End-to-Ingress (`af add`, `af ls`, `af do` 전체 flow)
- MCP Tool 핸들러 (McpServer에 Tool 등록 후 stdio transport 모의 호출)
- 실제 Adapter 조합: FS + HTTP mock server (예: `@mswjs/msw` 대신 Bun 내장 `Bun.serve` 사용)

**특징**:
- Composition Root(ADR-0011) 일부 재사용
- 네트워크 mock (localhost HTTP server), 파일 시스템은 임시 디렉토리
- 실행 시간 < 500ms per test

```typescript
// __tests__/integration/cli/add.test.ts
describe("af add", () => {
  test("태스크 생성 → 캐시 반영 → ls에서 조회 가능", async () => {
    // Given: mock API server + temp config dir
    const server = await startMockAkiflowServer();
    process.env.AF_API_BASE_URL = server.url;
    process.env.AF_CONFIG_DIR = await mkdtemp("af-test-");

    // When
    await runCli(["add", "통합 테스트 태스크", "--today"]);
    const output = await captureStdout(() => runCli(["ls", "--json"]));

    // Then
    const tasks = JSON.parse(output);
    expect(tasks.some(t => t.title === "통합 테스트 태스크")).toBe(true);
  });
});
```

#### 3. E2E Tests (5% — TASK-21 Phase E, F)

**대상**: 실제 Akiflow 서비스와의 End-to-End

**특징**:
- CI에서는 skip (기본)
- 로컬에서 `bun test --e2e` + 환경변수로 트리거
- TASK-21의 로컬 검증 스크립트가 이에 해당
- Claude Code MCP 통합 테스트는 수동 (자동화 어려움)

```bash
# E2E 실행 조건
BUN_TEST_E2E=1 AKIFLOW_REFRESH_TOKEN=... bun test --filter e2e
```

### Port Mocking 패턴

모든 Port는 테스트 fixture로 mock 구현을 제공:

```typescript
// __tests__/fixtures/mocks.ts
export function createMockStorage(overrides?: Partial<StoragePort>): StoragePort {
  return {
    loadCredentials: async () => null,
    saveCredentials: async () => {},
    clearCredentials: async () => {},
    ...overrides,
  };
}

export function createMockHttp(responses: Map<string, unknown>): AkiflowHttpPort {
  return {
    async get(path) {
      if (responses.has(path)) return responses.get(path);
      throw new NetworkError("not mocked", 404);
    },
    async patch(path, body) {
      return { success: true, data: body };
    },
  };
}

export function createMockLogger(): LoggerPort {
  return {
    trace: () => {}, debug: () => {}, info: () => {},
    warn: () => {}, error: () => {},
  };
}
```

### Fixture 관리 (TP-TEST-003)

```
src/__tests__/
├── fixtures/
│   ├── mocks.ts               # Port mock factory 함수
│   ├── tasks.ts               # sample Task 데이터
│   ├── credentials.ts         # sample Credentials
│   ├── leveldb/               # IndexedDB 바이너리 샘플
│   │   ├── valid-token.log
│   │   └── expired-token.log
│   └── cookies/               # Safari 바이너리 쿠키 샘플
│       └── akiflow.binarycookies
```

### 테스트 커버리지 목표

| 계층 | 분기 커버리지 |
|------|-------------|
| core/services | ≥ 80% |
| core/utils | ≥ 90% |
| adapters | ≥ 60% (외부 I/O 제외) |
| cli/commands | ≥ 70% (integration 포함) |
| mcp/tools | ≥ 80% (integration 포함) |
| **전체** | ≥ 65% (TP-TEST-001 baseline) |

### 테스트 실행 환경 분리

```bash
# 단위 테스트만 (빠른 피드백, CI PR 단계)
bun test src/__tests__/core src/__tests__/adapters

# 통합 포함
bun test src/__tests__/

# E2E 포함 (로컬 only)
BUN_TEST_E2E=1 bun test
```

### Consequences

**Good:**
- 빠른 단위 테스트로 TDD 가능
- 통합 테스트가 Integration Adapter까지 포함 → 실수 포착 확률 높음
- Port mocking으로 외부 의존성 완전 격리 (Hexagonal 시너지)
- `testing-helper` 에이전트(@test-engineer, @coverage-analyst)와 정확히 정합
- CI 시간: 단위 < 5초, 통합 < 30초, E2E 제외

**Bad:**
- Mock factory 유지보수 필요 (Port 인터페이스 변경 시 동반 수정)
- Integration 테스트가 비중 높아 fixture 관리 비용
- 역공학 API 변경 시 E2E에서만 포착 → 일반 CI에서 누락 가능 → 별도 스모크 테스트(TASK-21)로 보완

## Pros and Cons of the Options

### Test Diamond + Port Mocking (선택)

- Good, because TP-TEST 표준과 testing-helper 에이전트에 100% 정합
- Good, because Hexagonal과 구조적 합치
- Good, because Integration 비중 40%로 실수 포착력 상승
- Neutral, because E2E 5%로 역공학 위험 완전 제거 못 함 → TASK-21로 보완
- Bad, because fixture 관리 비용

### Test Pyramid (전통)

- Good, because 단위 테스트 우세 → 실행 빠름
- Bad, because Integration 부족으로 adapter 구성 오류 포착 늦음
- Bad, because Hexagonal 가치 활용 못 함

### Unit + Contract Tests

- Good, because API 스펙 준수 강제
- Bad, because Akiflow 내부 API는 공식 스펙 부재 → contract 작성 어려움
- Bad, because Pact 등 추가 도구 의존

## testing-helper 에이전트 활용

| 상황 | 사용 에이전트 |
|------|-------------|
| 신규 서비스 클래스 작성 직후 | `/write-unit-test src/core/services/xxx.ts` |
| 신규 CLI 명령어 | `/write-integration-test src/cli/commands/xxx.ts` |
| 신규 MCP Tool | `/write-integration-test src/mcp/tools/xxx.ts` |
| Phase 완료 시 갭 분석 | `@coverage-analyst` (자동 spawn) |
| 반복 테스트 실패 패턴 분석 | `/test-retro` |

## More Information

- **관련 ADR**:
  - [ADR-0006: Hexagonal Architecture](./ADR-0006-hexagonal-architecture.md) — Port mocking 전제
  - [ADR-0008: 에러 처리](./ADR-0008-error-handling-strategy.md) — typed error로 assertion 용이
  - [ADR-0011: 의존성 주입](./ADR-0011-dependency-injection.md) — 생성자 주입이 테스트 친화
- **관련 TASK**:
  - 전체 TASK의 "테스트 계획" 섹션 (이미 각 TASK에 포함)
  - TASK-21 (로컬 통합 검증 / E2E)
  - TASK-22 (docs/TESTING.md)
- **Fitness Function (제안)**:
  - `bun test src/__tests__/core` 실행 시간 < 5초
  - 전체 커버리지 ≥ 65% (기준선 위반 시 CI 실패)
  - 각 Service는 최소 1개 Given-When-Then 주석 포함 unit test
- **레퍼런스**:
  - testing-helper 플러그인의 TP-TEST-001~005 문서
- **Revisit Triggers**:
  - bun:test에 심각한 제약 발생 시 → vitest 전환
  - 성능 테스트 필요 시 → Performance 계층 추가
  - E2E 자동화 가능해지면 비율 상향
