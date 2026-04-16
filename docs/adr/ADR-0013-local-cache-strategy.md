---
title: "ADR-0013: 로컬 캐시 전략 — sync_token 증분 + TTL + Pending Queue"
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
  - cache
  - sync-token
  - offline
---

# ADR-0013: 로컬 캐시 전략 — sync_token 증분 + TTL + Pending Queue

## Context and Problem Statement

`af ls`는 매번 호출되는 명령이며, 매번 네트워크 호출 시 지연이 UX에 부정적이다. Akiflow API는 `sync_token` 기반 증분 동기화를 지원한다. 한편, 비행기/지하철 등 오프라인 상황에서 `af add` 시 태스크가 소실되지 않아야 한다. 캐시 일관성, TTL, 오프라인 큐잉 규칙을 결정해야 한다.

## Decision Drivers

- **응답 속도**: `af ls` 500ms 이내 응답 목표
- **신선도**: 너무 오래된 캐시는 혼란 야기
- **오프라인 지원**: 비행기 모드에서 태스크 생성 가능
- **API 부하 최소화**: 매번 전체 fetch 회피 (sync_token 활용)
- **단순성**: 풀 Redis-like 인프라 불필요 (1인 사용)
- **디스크 공간**: 수만 개 태스크가 있어도 과도한 용량 회피

## Considered Options

1. **sync_token 기반 증분 + TTL + Pending Queue** — 혼합 전략
2. **TTL-only 캐시** — 단순 만료 기반 무효화
3. **캐시 없음** — 매번 API 호출

## Decision Outcome

**선택: sync_token 기반 증분 + TTL + Pending Queue**

### 캐시 구조

```
~/.cache/akiflow/                       # XDG_CACHE_HOME/akiflow
├── tasks.json                           # 전체 태스크 캐시 (Map<id, Task>)
├── tasks-meta.json                      # { syncToken, lastSyncAt, itemCount }
├── labels.json                          # 라벨 캐시
├── labels-meta.json
├── last-list.json                       # 짧은 ID → UUID 매핑 ({"1": "uuid-x", ...})
└── pending/
    └── tasks-pending.jsonl              # 오프라인 생성/수정 태스크 (append-only)
```

### 읽기 플로우 (TaskQueryService.listTasks)

```
1. tasks-meta.json 읽기 → lastSyncAt 확인
2. lastSyncAt < (now - TTL) && network 가능?
   ├─ Yes: sync_token으로 증분 fetch
   │       → tasks.json 업데이트
   │       → lastSyncAt = now
   └─ No: 캐시 그대로 사용
3. filter/search/sort 적용 → 반환
4. 짧은 ID 부여 → last-list.json 저장
```

**TTL 기본값**: 30초 (설정: `AF_CACHE_TTL_SECONDS`, ADR-0012)

### 쓰기 플로우 (TaskCommandService.createTask)

```
1. 클라이언트 UUID 생성 (H1 해결)
2. Task 객체 생성 → tasks-pending.jsonl에 append
3. 네트워크 시도
   ├─ 성공: 서버 응답 Task로 tasks.json 업데이트 + pending에서 제거
   └─ 실패:
       ├─ 네트워크 에러: pending에 유지 (다음 sync에서 재시도)
       └─ 스키마 에러/인증 실패: 에러 전파 (ADR-0008)
4. 반환: CreateTaskResult { id, queued, persisted }
```

### Pending Queue 처리 (다음 sync 시)

```
TaskQueryService.listTasks()가 호출될 때:
1. 정상 sync 플로우 실행
2. tasks-pending.jsonl 읽어 각 라인을 PATCH 재시도
3. 성공한 라인만 제거 (rewrite)
4. 영구 실패(스키마 에러 등)는 pending에 유지 + warn 로그
```

### 캐시 무효화

| 트리거 | 동작 |
|--------|------|
| TTL 만료 | 다음 읽기에서 증분 sync |
| Write 성공 | 해당 Task만 tasks.json에 삽입/갱신 (전체 re-fetch 없음) |
| Write 실패 (네트워크) | pending에 유지 |
| `af cache clear` | ~/.cache/akiflow 전체 삭제 |
| 인증 변경 | 전체 캐시 무효화 (계정 바뀌었을 가능성) |
| API 스키마 에러 | 전체 캐시 버전 호환성 문제일 수 있음 → meta.json 리셋 권장 |

### 캐시 크기 관리

- Akiflow API 기본 `limit=2500` 페이지네이션
- tasks.json이 10MB 초과 시 `af cache clear` 권고 로그 (`> AF_CACHE_MAX_MB`로 오버라이드)
- 완료 후 90일 이상 지난 태스크는 캐시에서 제외 (meta의 `earliestKeepDate` 기준)

### Consequences

**Good:**
- `af ls` 캐시 hit 시 즉시 응답 (디스크 read 10ms 내외)
- 오프라인 상태에서 `af add` 가능 → 온라인 복귀 시 자동 반영
- API 부하 최소화 (sync_token 증분으로 대역폭 절감)
- 짧은 ID 매핑이 `af do 1` 같은 자연스러운 UX 제공
- 캐시 파일이 JSON → 디버깅/수동 검사 용이

**Bad:**
- TTL 30초 동안 다른 클라이언트(웹앱)에서 변경한 내용 미반영 (Eventually Consistent)
- `af ls` 직후 `af add`는 문제없으나 웹앱에서 변경 후 바로 `af ls`는 stale 가능 → `af ls --fresh` 플래그 제공
- Pending에 영구 실패 태스크가 쌓일 위험 → 주기적 감사 필요
- 캐시 파일 손상 시 복구 로직(graceful degradation → 전체 re-sync) 필요

## Pros and Cons of the Options

### sync_token + TTL + Pending Queue (선택)

- Good, because Akiflow API 기능 최대 활용
- Good, because 오프라인 지원 자연스럽게 구현
- Good, because TTL로 단순한 신선도 관리
- Neutral, because pending 영구 실패 처리 필요
- Bad, because 캐시 스키마 설계 필요

### TTL-only 캐시

- Good, because 구현 가장 단순
- Bad, because sync_token 미활용 → 매번 전체 fetch (대역폭/시간 낭비)
- Bad, because 오프라인 지원 어려움

### 캐시 없음

- Good, because 일관성 보장 (항상 서버 권위)
- Bad, because UX 불량 (`af ls` 매번 수 초 대기)
- Bad, because 오프라인 전혀 지원 안 됨
- Bad, because API rate limit 위험

## 특수 케이스

### `af ls --fresh`

TTL 무시하고 강제 sync. 웹앱 변경 확인 시 사용.

### `af cache clear`

- pending 포함 모든 캐시 삭제 (주의 경고)
- `af cache clear --keep-pending`로 pending은 보존

### sync 중 충돌

서버에 이미 존재하는 UUID(PATCH 경합) → 서버 값을 권위로 간주하고 pending에서 제거.

## More Information

- **관련 ADR**:
  - [ADR-0010: CQRS 부분 적용](./ADR-0010-cqrs-partial-adoption.md) — Query가 캐시 우선, Command가 무효화
  - [ADR-0012: 설정 관리](./ADR-0012-configuration-layered.md) — `AF_CACHE_TTL_SECONDS`, `AF_CACHE_DIR`
  - [ADR-0014: 비동기/재시도](./ADR-0014-async-retry-pattern.md) — pending 재시도 backoff
- **관련 TASK**:
  - TASK-08 (local cache 구현)
  - TASK-07 (TaskPort 인터페이스에 sync 메서드)
  - TASK-10 (af ls, af add가 캐시 사용)
- **Fitness Function (제안)**:
  - `af ls` P95 응답 시간 < 500ms (캐시 hit 시)
  - sync_token 미활용 시 경고 로그 (개발 단계)
  - pending 태스크가 7일 이상 성공 안 하면 사용자 알림
  - `af cache clear` 후 재실행 시 정상 동작 (파괴적 테스트)
- **Revisit Triggers**:
  - Akiflow가 webhook/SSE 제공 시 → 실시간 push 기반 캐시로 전환
  - 멀티 디바이스 동시 편집 일관성 이슈 발생 시 → OT/CRDT 검토
  - 단일 계정당 태스크 100만개 이상 규모 → SQLite 기반 캐시 전환
