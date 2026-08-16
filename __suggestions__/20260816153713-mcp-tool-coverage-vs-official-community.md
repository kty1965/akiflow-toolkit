---
title: "공식/커뮤니티 Akiflow MCP 대비 tool 커버리지 확대"
createdAt: 2026-08-16T15:37:13+09:00
updatedAt: 2026-08-16T22:20:21+09:00
version: "1.2.0"
type: suggestion
tags:
  - mcp
  - akiflow
  - coverage
  - competitive-analysis
---

## 1. 배경 (Why)

Discord 채널에서 CDP 로그인 fix(#79/PR #80)를 라이브 검증하는 김에 MCP tool 20개
전수 테스트를 진행했고, 사용자가 이어서 "공식 MCP나 다른 커뮤니티 MCP에는 있는데
우리에겐 없는 API를 찾아서 커버리지를 올려보자"는 목표를 제안했다.

조사해보니 이 작업은 **이미 상당 부분 진행 중**이었다:

- `PR #70`(`worktree-akiflow-calendar-meeting-tools`, draft, 아직 main에 미merge)이
  커뮤니티 레퍼런스 `shrimpwtf/akiflow-mcp`의 커밋 히스토리를 리버스엔지니어링해서
  `get_calendars`, `create_event`, Meeting Assistant 5종(`get_recordings`,
  `get_recording`, `get_meeting_briefs`, `get_meeting_brief`,
  `create_task_from_action_item`)을 이미 구현해둔 상태다 (15→22 tool).
- 이 PR은 그 과정에서 **오늘 라이브 테스트로 재발견한 `get_events`/`get_free_slots`
  크래시(이슈 #81)와 동일한 근본 원인**(API가 snake_case로 응답하는데 camelCase로
  캐스팅)을 이미 찾아 `akiflow-mappers.ts`로 고쳐뒀다. 즉 이슈 #81은 PR #70이 merge되면
  자동 해결된다 — 별도로 다시 고칠 필요 없음.
- PR #70 본문이 링크한 사전 리서치 문서(`__researches__/20260722095619-...md`)는
  실제로는 이 저장소에 커밋된 적이 없다(과거 worktree에서 작성만 되고 유실된 것으로
  추정) — 그래서 이번에 다시 웹 조사를 했다.

오늘(2026-08-16) 추가로 확인한 것:

- **공식 Akiflow MCP가 이제 존재한다** (Akiflow 데스크톱 앱 Settings → MCP에서 URL 제공,
  2026년 5월 최종 업데이트 확인). PR #70 작성 시점(리서치 문서 날짜 2026-07-22 기준)엔
  없었거나 반영 안 됐을 가능성이 있다.
- 커뮤니티 구현이 하나 더 있다: `nickshatilo/akiflow-mcp` (task/label/tag 위주, 캘린더·
  미팅 기능 없음 — 우리가 이미 커버하는 범위의 부분집합이라 이쪽 기준으로는 새로 채울
  gap 없음).

## 2. 현재 커버리지 비교

| 영역 | 우리 (main, v1.4.1) | 우리 (PR #70 merge 후) | shrimpwtf | nickshatilo | 공식 MCP(설명 기준) |
|---|---|---|---|---|---|
| Task CRUD/schedule/complete | ✅ (14 tools) | ✅ | ✅ | ✅ (부분) | ✅ |
| Subtask (parent) | ✅ (`update_task.parent`) | ✅ | — | — | 언급 없음 |
| get_calendars | ❌ | ✅ | ✅ | ❌ | ✅ |
| create_event | ❌ | ✅ | (커밋 이력상 존재) | ❌ | ✅ |
| **update_event / delete_event** | ❌ | ❌ | 불명 | ❌ | ✅ ("edit or cancel calendar events") |
| Meeting Assistant (recordings/briefs) | ❌ | ✅ (5 tools) | ✅ | ❌ | ✅ |
| get_free_slots | ✅ (버그 있음, 이슈 #81) | ✅ (수정됨) | ❌ | ❌ | 언급 없음 |
| projects/labels/tags | ✅ (name-undefined 버그, 이슈 #83) | 동일 버그 존재 (미수정) | ✅ | ✅ (label/tag만) | ✅ |
| **"someday" 리스트** | ❌ (필터: today/inbox/done/all) | ❌ | 불명 | ❌ | ✅ 언급됨 |
| MCP-native auth 액션(login/logout/refresh) | ❌ (CLI만, MCP엔 auth_status 조회만) | ❌ | ❌ | ✅ (login/logout/refresh_tokens/set_tokens) | 불명 |

## 3. 목표 (Definition of Done)

- [x] DoD-1: PR #70을 라이브 스모크 테스트로 검증 (`get_calendars` → `create_event`,
      Meeting Assistant 5종을 실제 인증 세션에서 1회 이상 호출 확인). **완료
      (2026-08-16)** — 전부 실제 계정으로 검증됨. 단, merge는 아직 — main 대비 오래된
      스냅샷이라 rebase 필요(§6 참조). 이슈 #81은 이 브랜치가 merge되면 자동 해결.
- [x] DoD-2: `delete_event` MCP tool 구현·라이브 검증 완료 (2026-08-16, PR #70 브랜치에
      커밋 `8b9e005`로 push됨: create→delete→get_events로 사라짐 확인). `update_event`는
      아직 미구현 — 남은 절반.
- [ ] DoD-3: Akiflow 도메인에 "someday" 개념이 실제로 존재하는지 확인 — 아직 미착수.
- [ ] DoD-4: MCP를 통한 재인증(`login`/`refresh` 액션)을 tool로 노출할지 여부 결정 —
      아직 미착수.
- [ ] DoD-5 (신규): Time Slot 카테고리 전체 구현 검토 — §7 참조. `getTimeSlots`
      (`GET /v5/time_slots`)가 이미 adapter에 있는데 어떤 service/tool도 안 씀(dead
      code). Create/Duplicate/Delete/Pin 전부 리버스엔지니어링 전.
- [ ] DoD-6 (신규): task에 Tag 할당/해제(`update_task`에 `tags` 필드 추가) — 현재 조회만
      가능, 할당 경로 없음.
- [ ] DoD-7 (신규): task Deadline 필드 신설 여부 검토 — Akiflow 도메인에 `date`(스케줄)와
      별개인 deadline 개념이 실제 있는지 raw API로 먼저 확인 필요 (someday 조사와 같은
      패턴, DoD-3과 묶어서 진행 가능).
- [ ] DoD-8 (신규, 우선순위 낮음): Goal 연동, Link 필드 — Akiflow의 Goals는 지금 쓰는
      API 표면(`/v5/*`, `/v3/*`) 밖의 완전히 별도 영역으로 추정, 새 엔드포인트부터
      리버스엔지니어링해야 함. Link는 도메인 타입에 필드 자체가 없어 서버 스키마부터
      확인 필요.

## 4. 범위 (Scope)

### In-scope
- PR #70 라이브 검증·merge (기존 작업 마무리, 이번 제안의 핵심)
- `update_event`/`delete_event` 신규 tool 설계·구현
- "someday" 필드 존재 여부 조사 (조사만, 구현은 조사 결과에 따라 별도 제안으로 분리 가능)

### Out-of-scope (별도 이슈로 이미 분리됨)
- 이슈 #81 (get_events/get_free_slots 크래시) — PR #70 merge로 자동 해결
- 이슈 #82 (uncomplete_task API 응답 형식 불일치) — PR #70과 무관, 별도 수정 필요
- 이슈 #83 (get_projects/get_labels/get_tags name-undefined) — PR #70과 무관, 별도 수정 필요

## 5. 로드맵 (전체 갭 개척 순서, 2026-08-16)

발견된 모든 갭(§2, §3, §7)을 확실성·위험도·의존성 기준으로 4단계로 정렬. 매 단계
공통 작업 방법론(이번에 `delete_event`로 검증됨): **raw API probe 스크립트로 실제
응답/에러 먼저 확인(커밋 안 함) → 안전 확인되면 port→adapter→service→MCP tool 정식
구현 → unit test 추가 → `bun test`/`tsc`/`biome` 클린 → 라이브 E2E 검증(쓰기 작업은
`[MCP-TEST]` 라벨 + 직후 정리) → 커밋/push.**

### Phase 0 — 안정화 (신규 기능보다 먼저, 블로킹)
불안정한 기반 위에 새 기능을 쌓지 않기 위해 선행.
1. PR #70을 main으로 rebase → merge (§6). **이걸로 이슈 #81 자동 해결.**
2. 이슈 #82 fix (`uncomplete_task` API 응답 형식 불일치)
3. 이슈 #83 fix (`get_projects`/`get_labels`/`get_tags` name-undefined)

### Phase 1 — 이미 실마리 있음 (저위험, 바로 착수 가능)
기존 패턴(create_event/delete_event, patchTasks)을 그대로 재사용할 수 있는 영역.
1. `update_event` — create_event/delete_event와 동일한 identity envelope 패턴, 필드만
   채워서 POST하면 될 가능성 높음 (DoD-2 나머지 절반)
2. Time Slot 전체(DoD-5) — `getTimeSlots`가 이미 있으니 여기서부터: raw 응답 구조부터
   probe로 확인 → Create/Delete/Duplicate/Pin은 event 패턴(POST 전체 envelope, 또는
   task 패턴처럼 partial PATCH)일 가능성 둘 다 열어두고 실험
3. Tag 할당/해제(DoD-6) — `update_task`가 이미 쓰는 `PATCH /v5/tasks`에 `tags` 필드를
   실어 보내는 실험부터 (task write 엔드포인트 자체는 이미 검증됐으니 위험 낮음)

### Phase 2 — 조사 우선 (있는지 없는지부터 확인)
raw task/이벤트 JSON을 직접 봐야 판단 가능한 것들. 조사만으로 끝날 수도 있음(없으면 기각).
1. "someday" 필드 실존 여부 (DoD-3)
2. Deadline 필드 실존 여부 (DoD-7, date와 별개 개념인지)
3. `create_task`에 `parent` 옵션 추가 (생성과 동시에 서브태스크로, 지금은 2-call 필요)
4. 반복 task/timeslot의 "이 일정만 vs 전체 인스턴스" 스코프 개념 실존 여부

### Phase 3 — 완전 미지 영역 (고비용·저확실성, 우선순위 낮음)
엔드포인트 자체를 처음부터 찾아야 함 — HAR 캡처 등 별도 리서치 필요.
1. Goal 연동(DoD-8) — Akiflow Goals가 지금 쓰는 `/v5/*`·`/v3/*` 밖의 완전 별도 API 표면일
   가능성 높음, 웹앱 트래픽 재캡처부터 시작
2. Link 필드(DoD-8) — 서버 스키마에 존재하는지부터 확인
3. Project/Tag 생성·삭제 — `POST`/`DELETE /v5/labels`(또는 유사)이 서버에 실제 존재하는지
   확인 필요, 지금까지 어떤 레퍼런스(공식/커뮤니티)도 구현한 적 없는 영역
4. MCP-native 재인증 액션(login/refresh as MCP tool, DoD-4) — CDP 브라우저 플로우를
   tool 안에서 트리거하는 게 UX적으로 적절한지 설계 논의 먼저

### ⚠️ 설계 리스크: tool 개수
PR #70 자체가 이미 "15→22 tool, ADR-0007 20-tool 임계값 초과" 를 미해결 이슈로 남겨둠.
Phase 1+2를 다 구현하면(`update_event` +1, Time Slot +4~5, 나머지는 기존 tool 필드
확장이라 tool 수 안 늘어남) 총 tool 수가 27~28개까지 갈 수 있음. Phase 1 착수 전에
**bounded-context split**(예: Time Slot을 별도 MCP 서버/토글로 분리할지) 여부를 먼저
결정하는 게 나을 수 있음 — 이것도 Phase 1 시작 시 첫 논의 대상으로 포함.

## 6. PR #70 rebase 필요 (2026-08-16 발견)

`worktree-akiflow-calendar-meeting-tools`가 main보다 오래된 스냅샷에서 분기됨:
- CDP 로그인 fix(#79/#80) 없음 — 이 브랜치의 `af auth`는 안 먹힘
- main엔 있는 `uncomplete_task`/`restore_task`/`share_task`/`unshare_task`/
  `duplicate_task` 5개 tool이 없음
- `package.json` 버전이 `1.2.0`(main은 `1.4.1`)

**merge 전 main으로 rebase 필수** — 안 하면 5개 tool이 퇴행함. PR #70에 코멘트로도
남겨둠: https://github.com/kty1965/akiflow-toolkit/pull/70#issuecomment-5307244341

## 7. Akiflow 앱 UI 컨텍스트 메뉴 기준 커버리지 감사 (2026-08-16)

사용자가 Akiflow 앱의 "Edit Task"/"Time Slot" 우클릭 메뉴 항목을 기준으로 요청해서 감사함.

### Edit Task

| 항목 | 상태 | 비고 |
|---|---|---|
| Edit | ✅ | `update_task` |
| Mark as done | ✅ | `complete_task` (`uncomplete_task`는 버그, 이슈 #82) |
| Assign Project | ✅ | `update_task.project` |
| Assign/remove Tags | ❌ | 필드 없음 (DoD-6) |
| Assign a Deadline | ❌ | 필드 없음 (DoD-7) |
| Set as priority Goal | ❌ | Goals 기능 통째로 미구현 (DoD-8) |
| Edit Priority | ✅ | |
| Edit Duration | ✅ | |
| Edit Links | ❌ | 도메인 타입에 link/url 필드 자체가 없음 (DoD-8) |
| Create Subtask | ⚠️ 부분 | `update_task.parent`로 사후 지정만 가능, `create_task`는 parent 옵션 없음 |
| 반복 task 이동 시 전체 인스턴스 일괄 수정 | ⚠️ 부분 | `recurrence`(RRULE) r/w는 되지만 "이 일정만 vs 전체" 스코프 개념이 없음 |

### Time Slot

전부 ❌. `TimeSlot` 도메인 타입(`{id, date, start, end, taskId}`, Task/Event와 별개
엔티티)과 `getTimeSlots`(`GET /v5/time_slots`) adapter 메서드는 존재하지만 **어떤
service/tool도 사용하지 않는 dead code**. `af block`/`create_task`는 duration+datetime을
가진 일반 Task를 만드는 것일 뿐, 진짜 TimeSlot 엔티티가 아님. Create/Plan/Duplicate/
Assign Project/Delete/Pin 전부 리버스엔지니어링 이전 상태(DoD-5). "Open Project Page"는
웹 UI 네비게이션이라 API/CLI 성격상 해당 없음.

## 8. 근거 자료

- PR #70: https://github.com/kty1965/akiflow-toolkit/pull/70
- shrimpwtf/akiflow-mcp: https://github.com/shrimpwtf/akiflow-mcp
- nickshatilo/akiflow-mcp: https://github.com/nickshatilo/akiflow-mcp
- 공식 Akiflow MCP 안내: https://product.akiflow.com/en/help/articles/4302815-akiflow-mcp
