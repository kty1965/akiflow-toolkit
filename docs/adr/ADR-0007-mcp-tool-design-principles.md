---
title: "ADR-0007: MCP Tool 설계 원칙 — Outcome-first"
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
  - mcp
  - tool-design
  - outcome-first
  - api-design
---

# ADR-0007: MCP Tool 설계 원칙 — Outcome-first

## Context and Problem Statement

MCP 서버가 노출할 Tool의 네이밍, 입력 스키마, 응답 포맷, annotations 규칙을 결정해야 한다. Akiflow API에는 20+개 엔드포인트가 있으나, 이를 1:1로 Tool로 노출하면 LLM이 선택 과부하에 빠져 hit rate가 급격히 떨어진다. MCP 개발 Best Practices 리서치에서 도출된 원칙을 이 프로젝트 표준으로 공식화한다.

## Decision Drivers

- **LLM hit rate 최대화**: 적은 수의 명확한 Tool이 많은 수의 일반화 Tool보다 선택 정확도 높음
- **Tool description 품질**: LLM이 "언제 이 Tool을 써야 하는가"를 이해해야 함
- **에러 복구 가능성**: LLM이 에러를 읽고 재시도할 수 있어야 함
- **annotations 활용**: readOnly/destructive 명시로 사용자 승인 플로우 최적화
- **일관성**: CLI 명령어와 Tool 이름이 1:1 매핑되지 않더라도 개념 일치 필요
- **확장성**: 새 Tool 추가 시 기존 Tool 이름 체계와 충돌 없이 추가 가능해야 함

## Considered Options

1. **Outcome-first (사용자 의도 단위)** — 1 Tool = 1 사용자 목표
2. **API endpoint 1:1 wrapping** — 각 Akiflow API 엔드포인트당 Tool 1개
3. **범용 Tool 소수** — `execute_query`, `execute_command` 같은 일반화 Tool

## Decision Outcome

**선택: Outcome-first**

Tool은 Akiflow API 엔드포인트가 아니라 **사용자가 달성하려는 목표** 단위로 설계한다.

### 핵심 규칙

#### 1. 네이밍 — `verb_noun` snake_case

```
✓ get_tasks        get_events       create_task
✓ complete_task    schedule_task    unschedule_task
✓ search_tasks     auth_status

✗ tasks            (목적어만)
✗ do_thing         (모호)
✗ handleTaskUpdate (camelCase)
```

#### 2. Description 필수 3요소

모든 Tool description은 반드시 포함:
- **무엇을 하는가** (What)
- **언제 써야 하는가** (When)
- **어떤 결과가 돌아오는가** (Output format hint)
- **호출 예시 자연어 2~3개** (hit rate 결정적 개선)

```typescript
// 좋은 예
server.tool(
  "get_tasks",
  "Akiflow 태스크를 조회합니다. " +
  "오늘의 할 일, 특정 날짜 태스크, 또는 inbox(미분류) 태스크를 가져올 수 있습니다. " +
  "날짜 미지정 시 오늘 기준. " +
  "결과는 정렬된 태스크 목록 (id, title, date, time, project). " +
  "예: '오늘 할 일 보여줘', '내일 스케줄 확인', 'inbox 태스크 목록'",
  { /* schema */ }
);

// 나쁜 예
server.tool("get_tasks", "태스크 조회", { /* schema */ });
```

#### 3. Input Schema — strict Zod

```typescript
// 모든 프로퍼티에 .describe() 필수
// enum, min/max, format 제약 최대한 활용
{
  date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD format")
    .optional()
    .describe("조회할 날짜 (YYYY-MM-DD). 미지정 시 오늘"),
  filter: z.enum(["today", "inbox", "done", "all"])
    .optional()
    .describe("필터: today=오늘 스케줄, inbox=미분류, done=완료, all=전체"),
}
```

#### 4. Output — 구조화된 텍스트

```typescript
// LLM이 이해하기 쉬운 포맷으로 가공 (JSON dump 금지)
return {
  content: [{
    type: "text",
    text: formatTasksForLLM(tasks), // "## 오늘 태스크 — 3건\n1. ..."
  }],
};
```

#### 5. 에러는 `isError: true` (throw 금지)

```typescript
// ✓ OK — LLM이 읽고 재시도 가능
return {
  content: [{ type: "text", text: `조회 실패: ${error.message}. 'af auth'로 재인증하세요.` }],
  isError: true,
};

// ✗ 금지 — LLM이 에러 콘텐츠를 보지 못함
throw new Error("Auth failed");
```

#### 6. annotations 명시

```typescript
server.tool("complete_task", description, schema, handler, {
  annotations: {
    destructive: true,  // 상태 변경 → 사용자 승인 유도
    idempotent: false,  // 여러 번 호출 시 결과 다름
  }
});

server.tool("get_tasks", description, schema, handler, {
  annotations: {
    readOnly: true,     // 안전 → 자동 승인 가능
  }
});
```

### Tool 인벤토리 상한

- 단일 MCP 서버당 **15개 이하 Tool** 권장
- 20개 초과 시 ADR-0006의 bounded context 분리 검토

### Consequences

**Good:**
- LLM이 상황에 맞는 Tool을 더 정확히 선택
- Tool description이 내장된 문서 역할 → `docs/MCP_TOOLS.md` 자동 생성 가능
- 파괴적 작업에 사용자 개입 유도 (annotations.destructive)
- 에러 발생 시 LLM 자가 복구 (isError 패턴)

**Bad:**
- API 엔드포인트와 Tool 이름이 다를 수 있어 디버깅 시 매핑 필요
- Outcome 정의가 모호한 경우 팀 내 합의 비용 발생
- 하나의 outcome이 여러 API를 조합해야 할 때 Service 계층(ADR-0006)에서 조율 필요

## Pros and Cons of the Options

### Outcome-first (선택)

- Good, because LLM hit rate 최대화 (검증된 패턴)
- Good, because Tool 수 제한으로 컨텍스트 절약
- Good, because 사용자 의도와 직관적 매핑
- Neutral, because 내부 API와 이름이 달라 매핑 문서 필요
- Bad, because Outcome 정의 합의 비용

### API endpoint 1:1 wrapping

- Good, because 구현 단순 (Akiflow API 한 번 매핑)
- Bad, because Tool 수 폭증 (20+개) → LLM 선택 오류 증가
- Bad, because "현재 사용자에게 중요한 태스크 조회" 같은 복합 의도 표현 어려움
- Bad, because Akiflow API 스펙 변경에 Tool 인터페이스 종속

### 범용 Tool 소수

- Good, because 극도로 적은 Tool 수
- Bad, because LLM이 파라미터 조합을 잘못 구성하여 호출 실패율 높음
- Bad, because 프롬프트 인젝션 취약 (자유도 과다)
- Bad, because MCP 컨벤션과 상이

## 구체 Tool 목록 (본 프로젝트)

| Tool | Outcome | annotations |
|------|---------|-------------|
| `get_tasks` | 특정 시점/필터의 태스크 조회 | readOnly |
| `search_tasks` | 키워드/프로젝트/라벨로 검색 | readOnly |
| `create_task` | 새 태스크 추가 | - |
| `update_task` | 기존 태스크 속성 수정 | - |
| `complete_task` | 태스크 완료 처리 | destructive |
| `schedule_task` | 태스크를 특정 일시에 배치 | - |
| `unschedule_task` | 태스크를 inbox로 되돌림 | - |
| `get_events` | 캘린더 이벤트 조회 | readOnly |
| `get_projects` | 프로젝트 목록 | readOnly |
| `get_labels` | 라벨 목록 | readOnly |
| `get_tags` | 태그 목록 | readOnly |
| `auth_status` | 인증 상태 확인 | readOnly |

총 12개 Tool (상한 15개 이내).

## More Information

- **관련 ADR**:
  - [ADR-0002: CLI + MCP 진입점 패턴](./ADR-0002-cli-mcp-entrypoint-pattern.md) — Tool이 primary adapter 2
  - [ADR-0006: Hexagonal Architecture](./ADR-0006-hexagonal-architecture.md) — Tool은 core Service 호출 래퍼
  - [ADR-0008: 에러 처리 전략](./ADR-0008-error-handling-strategy.md) — isError boundary 변환
- **관련 TASK**: TASK-15 (태스크 Tools), TASK-16 (캘린더/조직 Tools)
- **Fitness Function (제안)**:
  - 모든 Tool description에 최소 1개 자연어 예시 포함 (lint 스크립트로 검증)
  - 모든 Tool input schema의 프로퍼티에 `.describe()` 호출 (CI 검사)
  - `isError: true` 패턴 강제 — throw가 Tool 핸들러에서 발생 시 CI 실패
  - Tool 수 < 15 (argc 단순 검사)
- **레퍼런스**:
  - [`__researches__/20260414060936-mcp-server-development-best-practices.md`](../../../__researches__/20260414060936-mcp-server-development-best-practices.md)
  - [`__researches__/20260410141438-mcp-server-implementation-guide.md`](../../../__researches__/20260410141438-mcp-server-implementation-guide.md)
- **Revisit Triggers**:
  - MCP 공식 SDK가 Tool annotations 확장 (예: `requires_consent`) 시
  - LLM이 Tool 선택 정확도 개선 기능(Tool ranking 등) 도입 시
  - 사용자 피드백에서 Tool 조합 시 혼란 보고 시
