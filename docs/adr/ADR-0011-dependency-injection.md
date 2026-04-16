---
title: "ADR-0011: 의존성 주입 — 수동 DI + Composition Root"
createdAt: 2026-04-15T19:00:00+09:00
updatedAt: 2026-04-15T19:00:00+09:00
version: "1.0.0"
type: artifact
status: accepted
date: 2026-04-15
decision-makers:
  - Huy
consulted:
  - iterative-architecture:tradeoff-analyst
informed:
  - 팀 전체
tags:
  - adr
  - dependency-injection
  - composition-root
  - testing
---

# ADR-0011: 의존성 주입 — 수동 DI + Composition Root

## Context and Problem Statement

Hexagonal(ADR-0006) 구조에서 Service는 Port를 통해 외부 의존성을 받는다. 이 Port 구현체를 어떻게 Service에 전달할지(IoC 컨테이너 vs 수동 구성 vs Singleton vs Factory) 결정이 필요하다. 선택은 번들 크기, 테스트 용이성, 디버깅 난이도에 영향을 미친다.

## Decision Drivers

- **번들 크기 최소화**: MCP 서버 시작 속도(ADR-0001)에 직결
- **테스트 용이성**: 각 Service가 mock Port로 쉽게 교체
- **명시적 의존성**: "이 Service는 어떤 Port를 쓰는가"가 코드에서 자명
- **프레임워크 독립**: NestJS/InversifyJS 없이 동작
- **CLI/MCP 공유 컴포지션**: 두 진입점이 같은 Service 인스턴스화 로직 사용

## Considered Options

1. **수동 DI + Composition Root 패턴** — 생성자 주입 + 단일 구성 지점
2. **IoC 컨테이너** (tsyringe, InversifyJS, NestJS)
3. **모듈 레벨 Singleton** — `export const authService = ...`

## Decision Outcome

**선택: 수동 DI + Composition Root**

### Composition Root 패턴

애플리케이션 진입점 근처에 **단 하나의 파일**이 모든 의존성을 연결한다.

```typescript
// src/composition.ts (Composition Root)
import { StderrLogger } from "./adapters/observability/stderr-logger.ts";
import { XdgStorage } from "./adapters/fs/xdg-storage.ts";
import { AkiflowHttpAdapter } from "./adapters/http/akiflow-api.ts";
import { IndexedDbReader } from "./adapters/browser/indexeddb-reader.ts";
import { ChromeCookieReader } from "./adapters/browser/chrome-cookie.ts";
import { CdpBrowser } from "./adapters/browser/cdp-launcher.ts";
import { SyncCache } from "./adapters/fs/sync-cache.ts";
import { AuthService } from "./core/services/auth-service.ts";
import { TaskQueryService } from "./core/services/task-query-service.ts";
import { TaskCommandService } from "./core/services/task-command-service.ts";
import { loadConfig } from "./config.ts";

export interface AppComponents {
  logger: LoggerPort;
  authService: AuthService;
  taskQuery: TaskQueryService;
  taskCommand: TaskCommandService;
  // ...
}

export function composeApp(): AppComponents {
  const config = loadConfig();
  const logger = new StderrLogger(config.logLevel, config.logFormat === "json");

  // FS adapters
  const storage = new XdgStorage(config.configDir);
  const cache = new SyncCache(config.cacheDir, config.cacheTtlSeconds);

  // Browser adapters (ports: BrowserDataPort)
  const browserReaders = [
    new IndexedDbReader(logger),
    new ChromeCookieReader(logger),
    // Safari, etc.
  ];
  const cdpBrowser = new CdpBrowser(config.cdpPort, logger);

  // HTTP
  const http = new AkiflowHttpAdapter(config.apiBaseUrl, logger);

  // Services
  const authService = new AuthService({
    storage,
    browserReaders,
    cdpBrowser,
    http,
    logger,
  });

  const taskQuery = new TaskQueryService({ http, cache, auth: authService, logger });
  const taskCommand = new TaskCommandService({ http, cache, auth: authService, logger });

  return { logger, authService, taskQuery, taskCommand };
}
```

### 진입점에서 사용

```typescript
// src/index.ts
import { composeApp } from "./composition.ts";

if (process.argv.includes("--mcp")) {
  const app = composeApp();
  const { startMcpServer } = await import("./mcp/server.ts");
  await startMcpServer(app);
} else {
  const app = composeApp();
  const { runCli } = await import("./cli/app.ts");
  await runCli(app);
}
```

### Service는 생성자에서 의존성 선언

```typescript
// core/services/auth-service.ts
export interface AuthServiceDeps {
  storage: StoragePort;
  browserReaders: BrowserDataPort[];
  cdpBrowser: CdpBrowserPort;
  http: AuthHttpPort;
  logger: LoggerPort;
}

export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  async authenticate(): Promise<Credentials> {
    // 단계 1: disk
    const stored = await this.deps.storage.loadCredentials();
    if (stored && !this.isExpired(stored)) return stored;

    // 단계 2: browser readers 순회
    for (const reader of this.deps.browserReaders) {
      try {
        const extracted = await reader.extract();
        if (extracted) {
          await this.deps.storage.saveCredentials(extracted);
          return extracted;
        }
      } catch (err) {
        this.deps.logger.debug("browser reader failed", { reader: reader.constructor.name });
      }
    }

    // 단계 3: CDP
    // 단계 4: manual
    throw new AuthSourceMissingError("all sources exhausted");
  }
}
```

### 테스트에서의 사용

```typescript
// __tests__/core/services/auth-service.test.ts
import { AuthService } from "../../../core/services/auth-service.ts";
import { createMockLogger, createMockStorage, createMockHttp } from "../../fixtures/mocks.ts";

test("disk에 유효한 크리덴셜이 있으면 즉시 반환", async () => {
  const storage = createMockStorage({ loadCredentials: async () => validCreds });
  const service = new AuthService({
    storage,
    browserReaders: [],
    cdpBrowser: createMockCdp(),
    http: createMockHttp(),
    logger: createMockLogger(),
  });
  const result = await service.authenticate();
  expect(result).toEqual(validCreds);
});
```

### Consequences

**Good:**
- 번들에 DI 컨테이너 추가 의존성 없음 (< 0 byte 영향)
- 의존성 관계가 `composition.ts` 한 파일에 모두 명시됨 → 전체 구조 파악 용이
- 테스트에서 Service 생성자에 직접 mock 주입 → 가장 단순한 패턴
- CLI/MCP가 `composeApp()` 한 번 호출로 동일 Service 인스턴스 사용
- "왜 이 구현체가 주입되었는가"가 코드로 추적 가능 (데코레이터 메타데이터 불필요)

**Bad:**
- `composition.ts`가 길어질 수 있음 (Service/adapter 수에 비례)
- 조건부 의존성(OS별 다른 adapter)은 수동 if-else 분기 필요
- 순환 의존성 발생 시 컴파일러가 런타임에 감지 (컨테이너의 사전 검증 없음)

## Pros and Cons of the Options

### 수동 DI + Composition Root (선택)

- Good, because 번들 크기 0 영향
- Good, because 의존성이 코드에서 명시적 (메타데이터 기반 아님)
- Good, because 테스트 시 생성자에 직접 mock 주입
- Good, because Hexagonal(ADR-0006)의 "프레임워크 독립" 철학과 일치
- Neutral, because Composition Root 파일 크기 관리 필요
- Bad, because 자동 해결(resolve) 없어 손으로 연결해야 함

### IoC 컨테이너 (tsyringe 등)

- Good, because `@injectable` 데코레이터로 선언적 의존성
- Good, because 자동 해결
- Bad, because 번들 크기 증가 (tsyringe ~50KB, InversifyJS ~150KB, NestJS ~수 MB)
- Bad, because 데코레이터 메타데이터 (`reflect-metadata`) 런타임 의존
- Bad, because Bun에서 데코레이터 메타데이터 지원 완전성 확인 필요
- Bad, because 디버깅 시 "이 인스턴스는 어디서 왔는가" 추적 어려움

### 모듈 레벨 Singleton

- Good, because 구현 가장 단순
- Bad, because 테스트 시 mock 교체 불가 (import 시점에 고정)
- Bad, because 설정 값을 모듈 import 시점에 읽어야 함 (유연성 부족)
- Bad, because 순환 import 위험

## 추가 패턴: Adapter Factory

OS별/환경별 조건부 의존성은 Factory로 추상화:

```typescript
// adapters/browser/index.ts
export function createBrowserReaders(logger: LoggerPort): BrowserDataPort[] {
  const readers: BrowserDataPort[] = [new IndexedDbReader(logger)];

  if (process.platform === "darwin") {
    readers.push(new ChromeCookieReader(logger));
    readers.push(new SafariCookieReader(logger));
  } else if (process.platform === "linux") {
    readers.push(new ChromeCookieReader(logger));
  }
  // Windows: 향후 지원

  return readers;
}
```

## More Information

- **관련 ADR**:
  - [ADR-0001: 런타임 선택 — Bun](./ADR-0001-runtime-selection-bun.md) — 번들 크기 최소화 철학
  - [ADR-0006: Hexagonal](./ADR-0006-hexagonal-architecture.md) — Port 인터페이스 정의
  - [ADR-0015: 테스트 전략](./ADR-0015-testing-strategy.md) — Port mocking 표준
- **관련 TASK**:
  - TASK-06 (AuthService 생성자 주입)
  - TASK-07 (TaskQueryService/TaskCommandService 생성자 주입)
  - TASK-14 (MCP server가 composition에서 서비스 수신)
  - TASK-09 (CLI app이 composition에서 서비스 수신)
- **Fitness Function (제안)**:
  - Service 클래스는 반드시 생성자 주입 (public static factory 금지, 테스트 격리 위해)
  - `core/` 파일에서 `import * from "./adapters/..."` 금지 (ADR-0006 규칙)
  - composition.ts 외 파일에서 adapter 직접 인스턴스화 금지
- **Revisit Triggers**:
  - Service 수가 15개 이상으로 늘어 composition이 관리 어려워질 때 → bounded context별 컴포지션 분리
  - 런타임 플러그인 시스템 필요 시 → IoC 컨테이너 도입
