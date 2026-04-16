---
title: "ADR-0010: CQRS 부분 적용 — Read/Write 서비스 분리 (Event Sourcing 미채택)"
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
  - cqrs
  - architecture
  - read-write-separation
---

# ADR-0010: CQRS 부분 적용 — Read/Write 서비스 분리 (Event Sourcing 미채택)

## Context and Problem Statement

본 프로젝트는 Akiflow API에 대한 **읽기**(태스크 조회, 캘린더 이벤트 조회)와 **쓰기**(태스크 생성/수정/완료, 스케줄링)가 서로 다른 성능/일관성 요구사항을 가진다:
- **읽기**: 자주 호출 (CLI `af ls` 매번), 캐시 우선, 약간의 stale 허용
- **쓰기**: 낮은 빈도, 즉시 반영 필요, 오프라인 시 pending queue

이를 어떤 수준의 아키텍처 분리로 다룰지(CQRS 완전 적용 / 부분 적용 / 미적용) 결정이 필요하다.

## Decision Drivers

- **성능**: 태스크 목록 조회가 매번 네트워크 호출하면 CLI UX 저하
- **오프라인 지원**: 비행기/지하철 등에서도 태스크 생성 가능해야 함
- **단순성**: 1인 사용자 규모 → Event Sourcing/Event Bus는 과잉
- **sync_token 기반 증분 동기화**: Akiflow API가 제공하는 페이지네이션 활용
- **역공학 API 제약**: 복잡한 쓰기 보장(트랜잭션, saga) 불가 → 낙관적 UI 수준
- **테스트 용이성**: 읽기/쓰기 경로 별도 테스트 가능

## Considered Options

1. **CQRS 부분 적용 — Read/Write Service 분리, Command Bus 없음**
2. **CQRS 완전 적용 — Command Handler + Query Handler + Event Store**
3. **CQRS 미적용 — 단일 TaskService에 모든 메서드**

## Decision Outcome

**선택: CQRS 부분 적용**

Command/Query 모델을 분리하되, Event Sourcing/Event Bus/CommandBus는 도입하지 않는다.

### 서비스 구조

```
src/core/services/
├── task-query-service.ts          # Read 전용
│   ├── listTasks(filter)          # 캐시 우선 → 네트워크 폴백
│   ├── searchTasks(keyword)       # 로컬 캐시 검색
│   ├── getTaskById(id)            # 캐시 우선
│   └── getTodayTasks()            # 편의 메서드 (캐시 기반)
│
└── task-command-service.ts        # Write 전용
    ├── createTask(input)          # PATCH + 캐시 무효화
    ├── updateTask(id, patch)      # PATCH + 캐시 반영
    ├── completeTask(id)           # PATCH + 캐시 반영
    ├── scheduleTask(id, when)     # PATCH + 캐시 반영
    └── unscheduleTask(id)         # PATCH + 캐시 반영
```

### Read 경로 (TaskQueryService)

```
CLI.ls() or MCP.get_tasks()
  ↓
TaskQueryService.listTasks(filter)
  ↓
1. CachePort.get(filter)
   - hit (fresh < 30s) → 즉시 반환
   - miss or stale → 다음 단계
2. TaskPort.fetch(syncToken)
   - sync_token 증분 요청
   - 응답 → CachePort.set
3. 캐시 기반 filter 적용 → 반환
```

### Write 경로 (TaskCommandService)

```
CLI.add() or MCP.create_task()
  ↓
TaskCommandService.createTask(input)
  ↓
1. 클라이언트 UUID 생성 (ADR: H1 해결)
2. PendingQueuePort.enqueue(task)    # 오프라인 대비
3. TaskPort.patch([task])            # Akiflow API 호출 (PATCH UPSERT)
   - 성공 → PendingQueuePort.ack(id) + CachePort.insert(task)
   - 실패 → pending에 유지, 다음 sync에서 재시도
4. 반환
```

### 금지 규칙

- **Query 서비스 내부에서 직접 TaskPort.patch() 호출 금지** (읽기 호출이 쓰기 유발하면 안 됨)
- **Command 서비스 응답은 필요 최소한만** (생성된 id, 업데이트된 필드) — 전체 리스트 재조회 유발 금지
- **낙관적 UI**: 로컬 캐시 먼저 반영 → 네트워크 실패 시 rollback 및 에러 전파

### Consequences

**Good:**
- CLI/MCP 양쪽에서 읽기 경로 성능 예측 가능 (캐시 우선)
- 오프라인 작성 지원 (pending queue)
- Read/Write 테스트 독립 (ADR-0015)
- 역공학 API 변경 시 Command/Query 영향 범위 분리 분석 가능
- LLM이 `get_tasks` Tool을 반복 호출해도 네트워크 부하 미미

**Bad:**
- Service 파일 2개로 증가 (작은 프로젝트에 약간 과잉)
- Read 후 Write가 필요한 플로우(예: `af task edit` = read → modify → write)에서 두 서비스 조율 필요
- Event 기반 동기화 불가 (Akiflow가 webhook 미제공 → pull 기반만 가능)
- 캐시 일관성 책임이 Command 서비스에 있음 (명시적 무효화/반영)

## Pros and Cons of the Options

### CQRS 부분 적용 (선택)

- Good, because Read/Write 성능/일관성 요구 분리 충족
- Good, because 오프라인 지원 자연스럽게 표현
- Good, because 테스트 격리 쉬움
- Neutral, because 일부 플로우에서 두 서비스 조율 필요
- Bad, because 소규모에는 약간의 구조 비용

### CQRS 완전 적용 (Event Sourcing 포함)

- Good, because 감사/재생 가능
- Bad, because Akiflow API가 이벤트 스트림 미제공 → 인위적 이벤트 구성 필요
- Bad, because 1인 사용자 대상 CLI에 극도의 오버엔지니어링
- Bad, because 복잡도 → 개발 속도 저하

### CQRS 미적용 (단일 TaskService)

- Good, because 구현 가장 단순
- Bad, because 읽기/쓰기 성능 요구 타협 (둘 다 네트워크 호출)
- Bad, because 오프라인 pending 로직을 Service 여기저기에 분산
- Bad, because "읽기가 쓰기 유발" 같은 안티패턴 방지 장치 없음

## 관련 타입 예시

```typescript
// Query 응답 — 최소 정보 + 매타데이터
export interface TaskListResult {
  tasks: Task[];
  source: "cache" | "network" | "cache+network";  // 디버그용
  freshness: Date;
}

// Command 응답 — 변경 결과만
export interface CreateTaskResult {
  id: string;
  queued: boolean;  // pending에 저장되었는지
  persisted: boolean; // 서버에 반영되었는지
}
```

## More Information

- **관련 ADR**:
  - [ADR-0006: Hexagonal Architecture](./ADR-0006-hexagonal-architecture.md) — Service가 Ports를 조합
  - [ADR-0013: 로컬 캐시 전략](./ADR-0013-local-cache-strategy.md) — Query 서비스가 활용
  - [ADR-0014: 비동기/재시도 패턴](./ADR-0014-async-retry-pattern.md) — Command 서비스의 PATCH 재시도
- **관련 TASK**:
  - TASK-07 (AkiflowClient → TaskQueryService + TaskCommandService로 분할)
  - TASK-08 (CachePort + PendingQueuePort 구현)
  - TASK-10 (CLI add/ls/do가 적절한 서비스 호출)
  - TASK-15 (MCP task tools가 적절한 서비스 호출)
- **Fitness Function (제안)**:
  - TaskQueryService가 TaskPort.patch 호출 0건 (static analysis)
  - TaskCommandService 응답 크기가 입력 대비 5배 이하 (리스트 재조회 방지)
  - 오프라인 모드에서 `af add` 호출 시 pending에 저장되고 exit 0
- **Revisit Triggers**:
  - Akiflow가 webhook/SSE 제공 시 → 이벤트 기반 동기화 가능
  - 멀티 디바이스 동시 편집 충돌 처리 필요 시 → CRDT/OT 검토
  - 사용자 기록 감사 요구 발생 시 → Event Sourcing 부분 도입
