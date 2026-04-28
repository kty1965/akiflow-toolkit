---
title: "Task notes/description를 MCP에 노출"
createdAt: 2026-04-28T00:00:00+09:00
updatedAt: 2026-04-28T00:00:00+09:00
version: "1.0.0"
type: suggestion
tags:
  - mcp
  - akiflow
  - task-tools
  - dx
---

## 1. 배경 (Why)

현재 MCP의 task 조회 도구(`get_tasks`, `search_tasks`)는 `formatTaskLine`을 통해
`[when] title [project] {id}` 한 줄만 렌더링한다. 하지만 도메인 타입 `Task`는
이미 `description: string | null`을 보유하고 있고(`src/core/types.ts:32`),
`TaskQueryService.getTaskById`도 구현되어 있다(`src/core/services/task-query-service.ts:130`).

즉 데이터는 있는데 **출력 단계에서 누락**된 상태다. LLM 측에서는 task 본문(notes)을
읽을 방법이 없고, 사용자는 제목만으로 맥락 판단을 강요받는다.

## 2. 목표 (Definition of Done)

- [ ] DoD-1: 단건 상세 조회 도구 `get_task` 신규 등록 (description, priority, tags, labels, schedule 포함)
- [ ] DoD-2: `get_tasks` / `search_tasks`에 `includeNotes?: boolean` 플래그 추가, 기본 false
- [ ] DoD-3: `includeNotes=true`일 때 description 첫 200자 + ellipsis를 list 항목 아래 indent로 노출
- [ ] DoD-4: 등록 테스트가 7개 tool과 새 annotation을 검증
- [ ] DoD-5: `get_task` happy path / not-found / error 경로 테스트
- [ ] DoD-6: `includeNotes` flag on/off 차이 테스트
- [ ] DoD-7: `bun test` / `bun lint` / `tsc` 통과
- [ ] DoD-8: README/CHANGELOG는 변경하지 않음 (semantic-release 자동화 영역)

## 3. 범위 (Scope)

### In-scope
- `src/mcp/tools/tasks.ts` 확장 (단일 파일 수정)
- `src/__tests__/mcp/tools/tasks.test.ts` 테스트 추가/수정

### Out-of-scope
- Akiflow API/HTTP port 변경 — description은 이미 `Task`에 매핑되어 있음
- `TaskCommandService` 변경 — 이번 변경은 read-only
- description **수정** 기능 (`update_task`에 description 추가) — 별도 PR
- 다른 tool(schedule/calendar/organize) 출력 포맷

## 4. 설계

### 4.1 신규 tool: `get_task`

```ts
// input
{ id: string }  // UUID

// output (markdown)
## Task: <title>
- id: <uuid>
- when: <[HH:MM] / [date] / inbox>
- duration: <Nm>
- project: <listId>
- priority: <n>
- labels: a, b
- tags: x, y
- done: ✓ / ✗

### Notes
<description 그대로, 없으면 "(no notes)">
```

- annotations: `readOnlyHint: true`, `openWorldHint: true`
- 내부적으로 `taskQuery.getTaskById(id)` 사용. `null` → `isError: true`로 "task not found" 반환.

### 4.2 `includeNotes` 플래그 (1번 + 2번 통합)

`get_tasks` / `search_tasks` 입력 스키마에 추가:

```ts
includeNotes: z.boolean().optional()
  .describe("Include first 200 chars of each task's notes/description (default: false)")
```

`formatTaskList` 시그니처에 `includeNotes` 추가하고, true일 때 각 항목 다음 줄에:

```
1. [09:00] Standup [project: work] {id: ...}
   notes: Daily sync at 9am — focus on blockers...
```

200자 초과 시 `…` 부착. description이 null이면 notes 줄 자체를 생략.

### 4.3 등록 테스트 보강

기존 "registers exactly the six task tools"를 `seven`으로 바꾸고 `get_task` 항목 추가.
`get_task`의 `readOnlyHint` 확인.

## 5. 워크플로우

| 단계 | 작업 | 산출물 |
|------|------|--------|
| 1 | `formatTaskDetail()` 헬퍼 추가 | tasks.ts |
| 2 | `registerGetTask()` 함수 추가 + `registerTaskTools`에 연결 | tasks.ts |
| 3 | `GetTasksInputShape` / `SearchTasksInputShape`에 `includeNotes` 필드 | tasks.ts |
| 4 | `formatTaskList` 시그니처 확장 + 호출부 갱신 | tasks.ts |
| 5 | 테스트: 등록 6→7개 검증 갱신 | tasks.test.ts |
| 6 | 테스트: `get_task` happy / not-found / error | tasks.test.ts |
| 7 | 테스트: `includeNotes` true/false 출력 차이 | tasks.test.ts |
| 8 | `bun lint && bun test` | (검증) |

## 6. 리스크 & 대안

| 리스크 | 대응 |
|--------|------|
| description이 매우 길면 list 토큰 폭증 | 200자 truncate + 기본 false |
| `get_task` 내부에서 `listTasks()` 전체 조회 → 비용 | 현재 service 구현이 그렇게 되어 있어 본 PR 범위 밖. 추후 storage layer에 단건 조회 최적화 별도 ADR로 검토 |
| Markdown 표 안 description 줄바꿈 | indent 2-space + 줄바꿈은 공백으로 normalize |

## 7. 검증

- `bun test src/__tests__/mcp/tools/tasks.test.ts`
- 수동: 로컬 MCP 클라이언트에서 `get_task`로 실제 description 보유 task 조회

## 8. 후속

- `update_task`에 description 패치 지원 (별도 제안서)
- Storage port에 `findById` 추가하여 `getTaskById` O(1) 최적화 (별도 ADR)
