---
title: "ADR-0006: 코드 아키텍처 — Hexagonal (Ports & Adapters)"
createdAt: 2026-04-15T19:00:00+09:00
updatedAt: 2026-04-15T19:00:00+09:00
version: "1.0.0"
type: artifact
status: accepted
date: 2026-04-15
decision-makers:
  - Huy
consulted:
  - iterative-architecture:option-explorer
  - iterative-architecture:tradeoff-analyst
informed:
  - 팀 전체
tags:
  - adr
  - architecture
  - hexagonal
  - ports-and-adapters
  - layered
---

# ADR-0006: 코드 아키텍처 — Hexagonal (Ports & Adapters)

## Context and Problem Statement

본 프로젝트는 (1) **역공학된 Akiflow 내부 API**에 의존하므로 언제든 변경될 수 있고, (2) **두 개의 진입점**(CLI와 MCP 서버)에서 동일한 비즈니스 로직을 공유해야 하며, (3) **여러 외부 의존성**(HTTP API, 브라우저 IndexedDB/쿠키, macOS Keychain, 파일 시스템)을 테스트 시 쉽게 교체해야 한다. 이를 만족하는 코드 구조 원칙이 필요하다.

## Decision Drivers

- **외부 변경에 대한 격리**: Akiflow API 스키마 변경 시 도메인 로직 미변경 목표
- **이중 진입점 지원**: CLI + MCP가 동일한 core 계층을 호출
- **테스트 용이성**: 외부 의존성(브라우저, FS, Keychain, HTTP) 모두 mock 가능
- **구현 복잡도 vs 이점**: 소규모 프로젝트에 과도한 DDD/Clean Architecture는 피함
- **기존 레퍼런스**: 역공학 API를 다루는 기존 커뮤니티 레퍼런스들은 대부분 절차형 스타일
- **프레임워크 의존성 최소화**: NestJS 등 DI/IoC 컨테이너 도입 회피

## Considered Options

1. **Hexagonal (Ports & Adapters)** — 도메인 중심, 외부는 어댑터
2. **Layered Architecture** — Presentation / Application / Domain / Infrastructure 4층
3. **Clean Architecture** — Entity / Use Case / Interface Adapter / Framework
4. **절차형 모듈 구조** — 기능별 평면 파일 배치 (기존 레퍼런스 스타일)

## Decision Outcome

**선택: Hexagonal (Ports & Adapters) — 단, 경량 적용**

엄격한 Clean Architecture의 계층 수를 줄여, 다음 2-포트 구조로 단순화한다.

```
┌─────────────────────────────────────────────────────────────┐
│               Primary (Driving) Adapters                     │
│   ┌──────────────┐              ┌────────────────┐          │
│   │  src/cli/    │              │   src/mcp/     │          │
│   │  (citty)     │              │  (McpServer)   │          │
│   └──────┬───────┘              └────────┬───────┘          │
│          │                                │                  │
└──────────┼────────────────────────────────┼─────────────────┘
           │                                │
           ▼                                ▼
┌─────────────────────────────────────────────────────────────┐
│                    Core (Domain)                             │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐  │
│   │  src/core/services/                                  │  │
│   │   ├─ AuthService         ← AuthPort 소유              │  │
│   │   ├─ TaskService         ← TaskPort 소유              │  │
│   │   └─ CalendarService     ← CalendarPort 소유          │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐  │
│   │  src/core/ports/         (인터페이스만)               │  │
│   │   ├─ AuthPort            (authenticate, refresh, ...)│  │
│   │   ├─ TaskPort            (fetch, create, update, ...)│  │
│   │   ├─ CachePort           (get, set, invalidate, ...) │  │
│   │   ├─ BrowserDataPort     (readIndexedDB, readCookie) │  │
│   │   └─ LoggerPort          (info, warn, error, ...)    │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│           Secondary (Driven) Adapters                        │
│   src/adapters/                                              │
│   ├─ akiflow-http.ts     → AkiflowApi v5 (TaskPort 구현)    │
│   ├─ indexeddb-reader.ts → LevelDB 파서 (BrowserDataPort)    │
│   ├─ chrome-cookie.ts    → SQLite + PBKDF2 (BrowserDataPort) │
│   ├─ xdg-storage.ts      → ~/.config/akiflow (AuthPort 부분) │
│   ├─ cdp-browser.ts      → CDP WebSocket (BrowserDataPort)  │
│   └─ stderr-logger.ts    → console.error wrapper (Logger)   │
└─────────────────────────────────────────────────────────────┘
```

### Consequences

**Good:**
- Akiflow API 변경 시 `adapters/akiflow-http.ts` 1개 파일만 수정 → 도메인/CLI/MCP 모두 무영향
- CLI/MCP는 core의 Service만 호출하므로 진입점 추가/변경 자유로움
- 테스트에서 `AuthPort`, `TaskPort` 등을 mock 구현으로 대체 용이 (`@test-engineer`의 `/write-unit-test` 친화적)
- 프레임워크 독립 (NestJS 등 DI 컨테이너 불필요) → 번들 크기 최소
- `AuthService.authenticate()`의 4단계 폴백은 ports 조합(BrowserDataPort + HttpPort + StoragePort)으로 명확히 표현

**Bad:**
- 단순 CRUD 메서드까지 Port/Adapter 분리 → 보일러플레이트 증가 (20~30% 추가 코드)
- 신규 기여자가 디렉토리 구조 이해에 시간 필요 (docs/ARCHITECTURE.md 필수)
- 타입 정의(`core/types.ts`)와 Port 인터페이스(`core/ports/*.ts`) 중복 관리 필요
- core와 adapters 간 타입 변환 boundary 명시 필요

## Pros and Cons of the Options

### Hexagonal (Ports & Adapters) (선택)

- Good, because 외부 의존성 교체 자유로움
- Good, because CLI/MCP 둘 다 primary adapter로 명확히 위치
- Good, because 테스트 포트 mocking 표준 패턴
- Good, because 역공학 API 변경 리스크 격리 (ADR-0003과 시너지)
- Neutral, because 계층 분리로 파일 수 증가
- Bad, because 소규모 프로젝트에 약간의 과잉 구조

### Layered Architecture (4층)

- Good, because 직관적이고 학습 곡선 낮음
- Neutral, because Spring/NestJS 등에서 친숙
- Bad, because 의존 방향이 위→아래로 고정되어 Domain이 Infrastructure 인터페이스를 소유 못 함
- Bad, because 외부 교체 시 Application/Domain 레이어 수정 동반

### Clean Architecture (Entity/UseCase/Adapter/Framework)

- Good, because 가장 순수한 도메인 분리
- Bad, because UseCase 객체마다 클래스 → 본 프로젝트 규모에 과도
- Bad, because 4~5층 매핑으로 네이밍 비용 증가

### 절차형 모듈 구조

- Good, because 초기 구현 속도 빠름
- Good, because 기존 커뮤니티 레퍼런스와 스타일 일치
- Bad, because CLI/MCP 공유 로직이 어디에 위치해야 하는지 모호
- Bad, because 테스트 시 외부 의존성 mock 어려움 (함수 교체 필요)
- Bad, because 파일 간 순환 의존 가능성

## 구현 가이드라인

### 디렉토리 구조 (TASK 적용)

```
src/
├── core/                       # 순수 도메인 (외부 의존성 금지)
│   ├── types.ts                # DTO/엔티티
│   ├── ports/                  # 인터페이스만 (의존성 역전)
│   │   ├── auth-port.ts
│   │   ├── task-port.ts
│   │   ├── cache-port.ts
│   │   ├── browser-data-port.ts
│   │   └── logger-port.ts
│   ├── services/               # 비즈니스 로직 (Port 주입)
│   │   ├── auth-service.ts     # AuthManager 역할
│   │   ├── task-service.ts     # AkiflowClient 대체
│   │   └── calendar-service.ts
│   └── errors/                 # 타입드 에러 (ADR-0008)
│       └── index.ts
│
├── adapters/                   # 외부 의존성 구체 구현
│   ├── http/
│   │   └── akiflow-api.ts      # fetch 기반 HTTP 어댑터
│   ├── browser/
│   │   ├── indexeddb-reader.ts
│   │   ├── chrome-cookie.ts
│   │   ├── safari-cookie.ts
│   │   └── cdp-launcher.ts
│   ├── fs/
│   │   ├── xdg-storage.ts      # ~/.config/akiflow
│   │   └── sync-cache.ts       # ~/.cache/akiflow
│   └── observability/
│       └── stderr-logger.ts
│
├── cli/                        # Primary Adapter 1 (사람 → core)
│   ├── app.ts                  # citty 정의
│   └── commands/
│
├── mcp/                        # Primary Adapter 2 (AI → core)
│   ├── server.ts               # McpServer 정의
│   └── tools/                  # Tool = Port 호출 래퍼
│
└── index.ts                    # --mcp 분기 (ADR-0002)
```

### 의존 방향 규칙 (강제)

```
cli/     → core/    (OK)
mcp/     → core/    (OK)
adapters → core/    (ports 참조, OK)
core/    → adapters (금지!)
core/    → cli/     (금지!)
core/    → mcp/     (금지!)
```

린팅 도구(Biome)로 이 규칙을 강제하거나, CI에서 import 방향 검사 스크립트 추가.

## More Information

- **관련 ADR**:
  - [ADR-0002: CLI + MCP 진입점 패턴](./ADR-0002-cli-mcp-entrypoint-pattern.md) — CLI/MCP가 primary adapter라는 관점에서 연결
  - [ADR-0003: Akiflow 인증 전략](./ADR-0003-akiflow-authentication-strategy.md) — AuthService가 여러 Port를 조합하는 구체 사례
  - [ADR-0008: 에러 처리 전략](./ADR-0008-error-handling-strategy.md) — boundary 에러 변환 규칙
  - [ADR-0011: 의존성 주입](./ADR-0011-dependency-injection.md) — Port 구현체를 Service에 주입하는 방식
- **관련 TASK**:
  - TASK-02 (types — DTO)
  - TASK-06 (AuthService로 리네이밍, Port 의존)
  - TASK-07 (TaskService 분리, HTTP adapter 별도)
  - TASK-04 (BrowserDataPort 구현체들)
  - TASK-18 (CDP adapter)
- **Fitness Function (제안)**:
  - `core/`에서 외부 패키지 import 0건 (fetch, fs, sqlite 등 모두 adapter 경유)
  - ArchUnit 유사 검증: `core/` 파일에서 `adapters/`, `cli/`, `mcp/` import 시 CI 실패
  - 모든 Service의 단위 테스트는 Port mock만 사용, 실제 HTTP/FS 접근 0건
- **Revisit Triggers**:
  - core/ports가 20개 이상으로 팽창하여 관리 부담이 클 때 → bounded context 분리 검토
  - 외부 의존성이 극소화되어 Port 추상화 가치가 낮아질 때
  - 본 프로젝트가 SaaS 형태로 확장되어 더 복잡한 DDD 필요 시 → Clean Architecture로 승격
