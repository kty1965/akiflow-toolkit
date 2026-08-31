---
title: "공식/커뮤니티 Akiflow MCP 대비 tool 커버리지 확대"
createdAt: 2026-08-16T15:37:13+09:00
updatedAt: 2026-08-31T19:13:36+09:00
version: "1.7.0"
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
- [x] DoD-2: `delete_event`/`update_event` MCP tool 둘 다 완료 (2026-08-16). `delete_event`는
      PR #70 브랜치 커밋 `8b9e005`. `update_event`는 PR #88 커밋 `f228a02` — 라이브
      probe로 `POST /v3/events`가 minimal envelope(calendar identity +
      creator_id/organizer_id + 변경 필드만)로 진짜 partial update 되는 걸 확인 후 구현,
      create→update(제목 변경 확인)→delete로 라이브 검증 완료.
- [ ] DoD-3: Akiflow 도메인에 "someday" 개념이 실제로 존재하는지 확인 — **조사했지만
      미해결(2026-08-16)**. raw task에 `plan_period`/`plan_unit` 필드 쌍이 있어서 유력
      후보였는데, 쓰기 시도(`plan_period` 6자리/정수 요구, `plan_unit`은 month/week/day/
      someday/quarter/year 전부 "invalid" 응답)로는 정확한 포맷을 못 알아냄. 현재 계정에
      해당 필드가 채워진 실제 task도 0건이라 read로 형태를 역산할 수도 없었음. **다음
      단계는 추측이 아니라 Akiflow 웹앱에서 실제로 task를 "someday"로 지정한 뒤
      GET으로 그 값을 읽는 것** — 웹앱 조작이 필요해서 이번 세션에선 보류.
- [x] DoD-4: MCP를 통한 재인증(`login`/`refresh` 액션)을 tool로 노출할지 여부 결정 완료
      (2026-08-31, 코드 조사만으로 판단 — 브라우저 불필요). **결론: 노출하지 않는다.**
      근거: `auth-service.ts`의 `authenticate()`가 이미 `withAuth()`의 CDP 미포함 자동
      복구 경로이고, CDP 로그인은 명시적으로 `authenticateInteractive()`로 분리돼 있음
      (코드 주석: "CDP login is intentionally excluded here — this method is on the
      withAuth() recovery path used by every API call (including from the long-running
      MCP server), which must never block on a human completing a browser login").
      `cdp-launcher.ts`를 보면 실제로 로컬에 Chrome 프로세스를 띄우고 최대 5분
      (`DEFAULT_LOGIN_TIMEOUT_MS`) 동안 사람이 브라우저에서 로그인을 완료하길 폴링
      대기하는 흐름이라, MCP tool 호출(에이전트가 동기적으로 응답을 기다리는 모델)
      안에서 트리거하면 디스플레이 없는 서버 환경에선 애초에 못 뜨고, 뜨더라도 에이전트가
      "완료됐는지" 알 방법이 없이 최대 5분 블로킹됨 — tool 모델과 근본적으로 안 맞음.
      "refresh"도 별도 tool로 의미가 없음: `withAuth()`가 모든 API 호출마다 이미
      Tier1(refresh_token)/Tier2(디스크 재로드)/Tier3(browser reader 재추출)를 자동
      수행하므로, 그 세 티어가 전부 실패한 상태(=CDP 없인 복구 불가)에서만 명시적
      "refresh" tool이 의미 있는데, 그 경우 결국 CDP가 필요해 위와 같은 문제로 되돌아감.
      **유지되는 설계**: `auth_status`(read-only, 이미 구현됨)로 상태만 진단해주고,
      실제 재인증은 사람이 터미널에서 `af auth`를 실행하도록 안내하는 현재 방식이 맞음
      — 새 tool 추가 불필요.
- [ ] DoD-9 (신규, Phase 2 조사 중 식별): 반복 task/timeslot "이 일정만 vs 전체
      인스턴스" 스코프. **읽기 전용 조사 완료(2026-08-30)** — 실계정 raw GET만으로
      스키마는 확인됨, MCP tool 설계/write 실험은 아직. 방법: `AkiflowHttpAdapter.request()`로
      `/v5/tasks?limit=2000`·`/v3/events?date=X`를 직접 GET(쓰기 없음).

      **확인된 사실(raw 응답 관찰):**
      - Event: master row는 `id === recurring_id`, `recurrence_exception: false`.
        단일 occurrence override는 별도 row로 존재 — 같은 `recurring_id`,
        `recurrence_exception: true`, `original_start_time`=override 대상 occurrence의
        원래 시각, `origin_recurring_id`=Google의 `<eventId>_R<UTCstamp>` 포맷 그대로
        패스스루(Akiflow가 새 개념을 만든 게 아니라 Google Calendar exception 모델을
        그대로 미러링).
      - Task: master row는 `id === recurring_id`, RRULE에 `UNTIL` 포함. materialize된
        occurrence row는 각자 별도 `id`, 같은 `recurring_id`, RRULE엔 `UNTIL` 빠짐,
        `original_date`가 앵커. 특이점: `recurrence_version:2`(즉 시리즈가 한 번 이상
        수정된 적 있는) 시리즈 하나에서만 occurrence id 4개가 전부 UUIDv5(결정론적,
        3번째 그룹이 `5`로 시작)였고, 나머지 미수정 시리즈 2개(총 72개 sibling)는 전부
        UUIDv4(랜덤)였음 — n=1이라 일반화는 위험하지만, "시리즈 레벨 수정이 occurrence
        id를 재생성할 수 있다"는 신호라 **occurrence id를 안정적 캐시 키로 가정하고
        PATCH하는 설계는 위험할 수 있음**.

      **미검증 가설(실제 관찰 없음, 다음 조사 대상):** "occurrence 하나만 수정 =
      그 occurrence 자체의 task row를 PATCH" — 지금 관찰된 76개 occurrence 전부
      `date === original_date`(한 번도 개별 이동된 적 없음)라 실제로 옮겨진 occurrence
      사례가 0건.

      **안전한 write 실험 시도 결과(2026-08-30):** 실 계정 데이터를 건드리지 않기 위해
      `[MCP-TEST]` 라벨 붙인 완전히 새 task를 만들어(다른 어떤 시리즈와도 무관) 마스터
      row 관찰 shape을 그대로 흉내내 `recurrence: "RRULE:FREQ=DAILY;COUNT=3"`(문자열,
      wire read shape인 배열이 아니라 write에서 기존 코드가 쓰는 그대로) +
      `recurring_id: <자기 자신의 id>`를 PATCH `/v5/tasks`로 시도 → **응답이 빈
      배열(`data: []`)로 옴(서버가 거부/no-op한 것으로 보임)**, 3초 대기 후 재조회해도
      occurrence row가 0개 materialize됨. 즉 "마스터에 recurrence+recurring_id만
      세팅하면 서버가 occurrence들을 자동 생성해준다"는 가설은 **기각** — 지금 계정에서
      관찰된 occurrence row들(마스터 하나당 수십 개)은 서버 자동 생성이 아니라 **공식
      Akiflow 클라이언트가 recurring task를 만들 때 직접 각 occurrence row를 하나씩
      PATCH로 만들어 넣는 것**으로 보임(materialization 로직 자체가 클라이언트 소유).
      → 이 가설을 확정하고 "이 일정만 수정" 실제 API 시퀀스를 알아내려면 **추측성 write
      반복이 아니라 공식 앱에서 실제로 반복 task를 만들 때 네트워크 트래픽(HAR)을 떠야
      함** — DoD-3(someday)·DoD-8b(Goal)와 동일하게 브라우저 세션이 필요해 이 세션에선
      더 진행 불가. 다음 단계: 브라우저 가능한 세션에서 (1) 반복 task 생성 (2) "이
      일정만" 수정 (3) "전체 시리즈" 수정, 세 가지 조작 각각의 HAR을 떠서 실제 PATCH
      시퀀스를 확인.

      원본 raw 필드(meeting 제목·참석자명 등 실사용자 데이터)는 이 문서에 남기지 않음 —
      probe 스크립트(`__scratch__`, 커밋 안 함) 재실행하면 동일 스키마 재확인 가능.
- [x] DoD-5: Time Slot 카테고리 완료 (2026-08-16, PR #88 커밋 `220fbd9`). `get_time_slots`/
      `create_time_slot`/`update_time_slot`/`delete_time_slot` 4개 tool 신규 — 라이브로
      create→update→delete 전부 검증. `TimeSlot` 도메인 타입도 실제 API 응답 기준으로
      재설계함(기존 `{id, date, taskId}`는 실체 없는 필드였음 — 아무 코드도 옛 shape에
      의존하지 않아서 breaking change 아님). `Duplicate`/`Pin`은 여전히 미구현(원래
      계획대로 v1 범위 밖).
- [x] DoD-6: task Tag 할당/해제 완료 (2026-08-16, PR #88). `update_task`에 `tags` 필드
      추가(전체 교체 방식), `PATCH /v5/tasks`의 `tags_ids` 필드로 라이브 확인. **부수
      발견**: `Task.tags`가 지금까지 모든 task에서 항상 undefined였음(raw API엔
      `tags_ids`만 있고 `tags`는 없는데 매핑이 아예 없었음) — `mapTaskTags`로 같이 고침.
      유사 문제로 `Task.labels`가 raw API에 대응 필드 자체가 없다는 것도 발견,
      **이슈 #87로 분리**(product 결정 필요, 이번 PR 범위 밖).
- [x] DoD-7: task Deadline 필드 완료 (2026-08-16, PR #88 커밋 `66afdbe`). raw task의
      `due_date` 필드(`date`와 독립적) 확인 후 `create_task`/`update_task`에 `deadline`
      필드로 노출. 라이브로 스케줄 없이 deadline만 있는 task 생성→`get_task`에 정확히
      표시되는 것 확인.
- [x] DoD-10 (신규, 보너스): `create_task`에 `parent` 옵션 추가 완료 (2026-08-16, 커밋
      `4358e27`) — 기존엔 서브태스크 생성에 2번 호출 필요했는데, 라이브 probe로
      `parent_id`가 최초 create PATCH에 같이 들어가도 되는 걸 확인해서 원샷으로 개선.
- [x] DoD-8a: Link 필드 완료(2026-08-30). §7 작성 시점(2026-08-16) "필드 자체 없음"으로
      기록했던 게 틀렸음 — raw `/v5/tasks` 조사에서 `links: string[]` 필드가 실존
      확인됨(2000개 중 312개 task에 URL 배열로 채워져 있음, 예: Jira/Notion 링크).
      `tags`/`due_date`와 같은 패턴(raw엔 있는데 `Task` 타입 미선언 + MCP tool 미노출).
      write도 raw PATCH `/v5/tasks`로 create→update(교체)→delete 라이브 검증 완료(전체
      교체 방식, `tags`와 동일). `Task.links` 타입 선언 + `mapTaskTags`에서 `links:
      raw?.links ?? []` 정규화 + `update_task` MCP tool에 `links`(전체 교체, tags와
      동일 패턴) 추가 + `formatTaskDetail`에 표시 — `create_task`엔 미추가(`tags`도
      create엔 없는 기존 설계와 동일하게 맞춤). 단위 테스트 3곳(mapper/service/mcp
      tool) + `composeApp()` 전체 스택 E2E(`[MCP-TEST]` 라벨 없이 create→update→
      delete, 실계정) 검증 완료.
- [ ] DoD-8b (우선순위 낮음): Goal 연동 — Akiflow의 Goals는 지금 쓰는 API 표면
      (`/v5/*`, `/v3/*`) 밖의 완전히 별도 영역으로 추정, 새 엔드포인트부터
      리버스엔지니어링해야 함(HAR 재캡처 필요, 브라우저 세션 필요 — DoD-3와 같은 이유로
      이 세션에선 착수 불가).
- [x] DoD-86-investigate: 이슈 #86(get_events 날짜 무시) 근본 원인 확정(2026-08-30).
      raw GET으로 직접 확인: `GET /v3/events?date=2026-08-30` 요청에 오늘과 무관한
      2023~2025년 이벤트 250개가 그대로 돌아옴 — **서버가 `date` 쿼리 파라미터를
      사실상 무시**(클라이언트 루프 문제 아님, `get_events`/`get_free_slots` 둘 다
      `days`만큼 매번 이 엔드포인트를 호출하는데 필터링 코드가 어디에도 없었음).
      `mapCalendarEvent`로 매핑 후 `start`/`end`가 요청한 `date`와 겹치는 것만 남기는
      클라이언트 필터(`eventOccursOnDate`, `akiflow-mappers.ts`)를 추가해 수정 —
      `AkiflowHttpAdapter.getEvents`에 적용. 단위 테스트(mapper 3케이스 + adapter 필터링
      1케이스) + 실계정 라이브 검증(`af cal --date 2025-01-28`가 250개가 아니라 실제
      그 날짜의 7개만 반환하는 것 확인) 완료.
- [ ] DoD-11 (신규, 2026-08-30 발견): raw `recurrence` 필드가 **배열**로 옴
      (`["RRULE:FREQ=YEARLY"]`, 경우에 따라 `["DTSTART:...", "RRULE:..."]` 2개짜리도
      있음)인데 `Task.recurrence`/`CalendarEvent.recurrence`는 `types.ts`에
      `string | null`로 선언돼 있고 `mapCalendarEvent`(akiflow-api.ts:428)가 그대로
      패스스루함. `#83`/`#87`(선언 타입 vs wire 실제 shape 불일치) 계열과 동일 패턴 —
      별도 이슈로 분리할지 검토.

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
1. Goal 연동(DoD-8b) — Akiflow Goals가 지금 쓰는 `/v5/*`·`/v3/*` 밖의 완전 별도 API 표면일
   가능성 높음, 웹앱 트래픽 재캡처부터 시작
2. ~~Link 필드~~ — **완료(DoD-8a, 2026-08-30)**, 아래 목록에서 제외.
3. Project/Tag 생성·삭제 — `POST`/`DELETE /v5/labels`(또는 유사)이 서버에 실제 존재하는지
   확인 필요, 지금까지 어떤 레퍼런스(공식/커뮤니티)도 구현한 적 없는 영역
4. ~~MCP-native 재인증 액션(DoD-4)~~ — **완료(2026-08-31)**, 코드 조사만으로 "노출하지
   않는다"로 결론남 (§3 DoD-4 참조). 브라우저 불필요했음, 아래 목록에서 제외.

#### 다음 브라우저 세션 실행용 체크리스트 (2026-08-31 작성)

`af auth status`가 만료 상태(source: cdp)라 이 문서를 쓰는 세션은 라이브 probe를 못함.
브라우저 가능한 세션(claude-in-chrome 등)에서 아래 순서로 진행하면 바로 착수 가능:

1. **재인증 먼저**: `af auth` 실행 → CDP가 로컬 Chrome을 띄움 → web.akiflow.com 로그인
   완료 → `af auth status`로 `active` 확인.
2. **Project/Tag 생성·삭제** (가장 저비용·고확실성이라 우선 추천): 웹 UI에서 새
   Project/Tag를 만들고 삭제하는 동안 `read_network_requests`로 실제 호출된
   메서드·URL·payload를 캡처. `POST`/`DELETE /v5/labels`(추정) 존재 여부부터 확인 —
   없으면 이 항목은 여기서 기각하고 문서에 기록.
3. **DoD-9 write 실험** (스키마 조사는 이미 끝남, §3 DoD-9 참조): 반복 task 하나 생성 →
   "이 일정만" 수정 → "전체 시리즈" 수정, 세 조작 각각 HAR/네트워크 캡처해서 실제 PATCH
   시퀀스 확인. 실 계정 데이터 보호를 위해 `[MCP-TEST]` 라벨 붙인 새 task로만 실험.
4. **DoD-3 someday**: task 하나를 웹 UI에서 "someday"로 지정 → GET으로
   `plan_period`/`plan_unit` 실제 값 확인 → 확인 즉시 원복(실 데이터 보호).
5. **Goal 연동(DoD-8b)**: 우선순위 낮음, 위 3개보다 나중에. Goal 생성/조회 화면에서
   네트워크 트래픽부터 재캡처(엔드포인트가 `/v5/*`·`/v3/*` 밖일 가능성 높음).

각 항목 완료 후 이 문서(§3 해당 DoD)를 갱신하고 커밋 — 다음 세션이 어디까지 됐는지
바로 알 수 있게.

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
| Edit Links | ✅ | `update_task.links` (전체 교체, DoD-8a, 2026-08-30) |
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
