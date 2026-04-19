---
title: "Task — TaskCommandService write 경로에서 read cache 무효화"
createdAt: 2026-04-19T22:05:00+09:00
updatedAt: 2026-04-19T22:05:00+09:00
version: "1.0.0"
type: spec
tags:
  - cache
  - cqrs
  - consistency
  - bug
---

# Task: TaskCommandService write 후 read cache invalidation

## Status
🟡 **Open** — Tier 2 E2E 실행 중 발견 (2026-04-19).

## Symptom
`create_task` 직후 `get_tasks(filter: inbox)`를 호출하면 방금 만든 task가 결과에 **없음**. 다시 30초 이상 기다려 TTL이 만료되어야 나타남.

재현:
```bash
bun run scripts/mcp-live-demo.ts
# …
[6] create_task — title="e2e-demo-xxx"
    ✓ created id=<uuid>

[7] get_tasks filter=inbox — verify new task is listed
    ✗ marker "e2e-demo-xxx" not found in inbox response
```

E2E 스크립트는 `AF_CACHE_TTL_SECONDS=0`으로 우회하지만, 이건 **테스트 전용 회피책**. 실제 MCP 클라이언트(Claude Code 등)에서 "방금 만든 task 바로 조회"를 하면 30초간 stale 데이터.

## Root Cause

`src/core/services/task-query-service.ts:46`의 `listTasksWithCache`:
```ts
const ttl = (this.deps.cacheTtlSeconds ?? 30) * 1000;
const meta = await cache.getMeta();
if (meta?.lastSyncAt) {
  const age = Date.now() - new Date(meta.lastSyncAt).getTime();
  if (age < ttl) {
    const cached = await cache.getTasks();
    return applyFilters(cached, options);
  }
}
```

→ TTL이 경과하지 않으면 API 호출 없이 캐시만 반환.

`src/core/services/task-command-service.ts`의 `createTask / updateTask / completeTask / scheduleTask / unscheduleTask` 어느 메서드도 **cache를 touch하지 않음**. Write는 API로 잘 가지만 cache는 이전 스냅샷 그대로.

## Decision Drivers (fix 옵션 선택 기준)

- **정합성**: write 직후 read가 자기 write를 보는 것이 기본 기대값 (read-your-writes consistency)
- **네트워크 비용**: write마다 cache 전체 refetch는 과함. 로컬 병합이 비용 효율적
- **복잡도**: CachePort 인터페이스 변경 최소화

## Options

### A. Write 후 cache 전체 무효화 (간단)
```ts
async createTask(input: CreateTaskInput): Promise<Task> {
  const task = await this.patchSingle(payload, "createTask");
  await this.deps.cache?.setMeta({ lastSyncAt: null, syncToken: meta.syncToken, itemCount: 0 });
  return task;
}
```
- 장점: 구현 단순, 한 곳 수정
- 단점: 다음 read가 전체 list 재동기화 → 느림 (5MB / 2.6초 관측됨)

### B. Write 결과를 cache에 merge (정밀)
```ts
async createTask(input: CreateTaskInput): Promise<Task> {
  const task = await this.patchSingle(payload, "createTask");
  const cached = await this.deps.cache?.getTasks() ?? [];
  await this.deps.cache?.setTasks([...cached.filter(t => t.id !== task.id), task]);
  // meta.lastSyncAt은 유지 (next read는 여전히 cache hit)
  return task;
}
```
- 장점: 즉시 일관, 네트워크 0회
- 단점: Command service에 CachePort 주입 필요 (현재 없음)

### C. Sync_token 기반 incremental sync (현행 구조 활용)
- `listTasksWithCache`가 이미 `sync_token` 지원 (line 58~85)
- Write 후 cache meta의 `lastSyncAt`만 null로 → 다음 read가 `sync_token` 기반 delta fetch
- 장점: B보다 단순, 전체 refetch 아님
- 단점: delta fetch의 정확성이 Akiflow API에 의존

## Recommended

**B + C 조합**:
1. `TaskCommandService`에 `CachePort` 주입 (ADR-0011 composition root 업데이트)
2. Write 메서드들이 반환된 `Task`를 cache에 merge
3. 대량 변경(향후 bulk ops) 대비로 `lastSyncAt`은 살짝 past로 밀어 다음 read가 delta sync

## Test Plan
- unit: `TaskCommandService.createTask` 호출 후 `cache.getTasks()`에 새 id 포함
- integration: 기존 `mcp-live-demo.ts`에서 `AF_CACHE_TTL_SECONDS=0` 제거해도 step [7] 통과
- regression: `TaskQueryService.listTasks` 테스트 스위트 그대로 통과

## Workaround (until fixed)

- `AF_CACHE_TTL_SECONDS=0` env
- 또는 write 후 `af cache clear` CLI (존재한다면) 호출

## Related
- `src/core/services/task-command-service.ts`
- `src/core/services/task-query-service.ts:46`
- `src/composition.ts` (DI wiring)
- ADR-0010 CQRS, ADR-0014 retry policy (이 task는 ADR-0010의 read-your-writes 약속 보강)
