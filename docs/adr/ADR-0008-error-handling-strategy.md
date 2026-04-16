---
title: "ADR-0008: 에러 처리 전략 — Typed Errors + Boundary 변환"
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
  - error-handling
  - typed-errors
  - result-pattern
---

# ADR-0008: 에러 처리 전략 — Typed Errors + Boundary 변환

## Context and Problem Statement

에러는 core/adapters/cli/mcp 전 계층에서 발생 가능하며, 각 계층이 요구하는 표현 방식이 다르다:
- **core/adapters**: 예외 throw (TypeScript 관례)
- **CLI**: 프로세스 종료 코드 + stderr 메시지
- **MCP**: `isError: true` + 사용자 친화 content (throw 금지, ADR-0007)

통일된 에러 계층과 boundary 변환 규칙이 없으면, 동일한 문제가 두 인터페이스에서 다른 모양으로 표출되어 디버깅이 어려워진다.

## Decision Drivers

- **사용자 친화 메시지**: "무슨 일이 일어났고, 어떻게 고치는가"
- **LLM 복구 가능성**: MCP 에러가 LLM에 의미 있는 힌트를 제공
- **개발자 디버깅**: 스택 트레이스 보존, 원인 추적 가능
- **민감 정보 보호**: 에러 메시지에 토큰/경로 등 유출 방지
- **exit code 표준**: CLI가 쉘 스크립트/CI에서 조합되기 좋도록
- **경계(boundary) 명확**: core는 throw, adapter는 catch→변환, primary adapter는 표현

## Considered Options

1. **Typed Error Classes + Boundary 변환** — 커스텀 Error 계층 + 각 계층 진입 시 변환
2. **Result<T, E> 모나드** — Rust-style, neverthrow 라이브러리
3. **Bare Error + 문자열 검사** — 표준 Error만 사용, message로 분기

## Decision Outcome

**선택: Typed Error Classes + Boundary 변환**

### 에러 계층 (core/errors/index.ts)

```typescript
// 최상위 추상 클래스
export abstract class AkiflowError extends Error {
  abstract readonly code: string;       // "AUTH_EXPIRED" 등 머신 식별
  abstract readonly userMessage: string; // 사용자용 메시지 (민감 정보 없음)
  abstract readonly hint?: string;      // 복구 힌트 (예: "af auth 실행")

  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = this.constructor.name;
  }
}

// 인증
export class AuthError extends AkiflowError {
  code = "AUTH_GENERIC" as const;
  userMessage = "인증이 필요합니다.";
  hint = "터미널에서 'af auth'를 실행하세요.";
}

export class AuthExpiredError extends AuthError {
  override code = "AUTH_EXPIRED" as const;
  override userMessage = "인증이 만료되었습니다.";
  override hint = "'af auth refresh' 또는 'af auth'를 실행하세요.";
}

export class AuthSourceMissingError extends AuthError {
  override code = "AUTH_SOURCE_MISSING" as const;
  override userMessage = "인증 정보를 어디서도 찾을 수 없습니다.";
  override hint = "브라우저에서 Akiflow에 로그인 후 'af auth'를 실행하세요.";
}

// 네트워크/API
export class NetworkError extends AkiflowError {
  code = "NETWORK_GENERIC" as const;
  userMessage = "Akiflow 서버에 연결할 수 없습니다.";
  hint = "네트워크 연결을 확인해주세요.";
  constructor(message: string, public readonly status?: number, cause?: Error) {
    super(message, cause);
  }
}

export class ApiSchemaError extends NetworkError {
  override code = "API_SCHEMA_MISMATCH" as const;
  override userMessage = "Akiflow API 응답 형식이 예상과 다릅니다.";
  override hint = "Akiflow 내부 API가 변경되었을 수 있습니다. 최신 버전으로 업데이트하세요.";
}

// 검증
export class ValidationError extends AkiflowError {
  code = "VALIDATION" as const;
  userMessage = "입력값이 올바르지 않습니다.";
  constructor(message: string, public readonly field?: string, cause?: Error) {
    super(message, cause);
  }
}

// 리소스
export class NotFoundError extends AkiflowError {
  code = "NOT_FOUND" as const;
  userMessage = "요청한 리소스를 찾을 수 없습니다.";
  constructor(message: string, public readonly resourceType?: string, cause?: Error) {
    super(message, cause);
  }
}

// 브라우저/로컬
export class BrowserDataError extends AkiflowError {
  code = "BROWSER_DATA" as const;
  userMessage = "브라우저 데이터에서 토큰을 추출하지 못했습니다.";
}
```

### Boundary 변환 규칙

```
┌─────────────────────────────────────────────────────────────┐
│                    Core / Services                           │
│   throw new AuthExpiredError("token exp < now");            │
└──────────────────────────┬──────────────────────────────────┘
                           │
           ┌───────────────┴───────────────┐
           ▼                                ▼
┌──────────────────────┐          ┌──────────────────────────┐
│   CLI Boundary       │          │   MCP Boundary            │
│   try { await svc }  │          │   try { await svc }        │
│   catch (err) {      │          │   catch (err) {            │
│     logger.error(    │          │     return {               │
│       err.userMessage│          │       isError: true,       │
│     );               │          │       content: [{          │
│     if (err.hint)    │          │         type: "text",      │
│       logger.info(hint)         │         text: `${err.userMessage}\n${err.hint ?? ""}` │
│     process.exit(    │          │       }],                  │
│       exitCodeFor(   │          │     };                     │
│         err.code     │          │   }                        │
│       )              │          │                            │
│   }                  │          │                            │
└──────────────────────┘          └──────────────────────────┘
```

### Exit Code 매핑 (CLI)

| Code | 상황 | Exit Code |
|------|------|-----------|
| 0 | 정상 | 0 |
| AUTH_* | 인증 관련 | 2 |
| NETWORK_*, API_SCHEMA_MISMATCH | 네트워크/API | 3 |
| VALIDATION | 입력 검증 실패 | 4 |
| NOT_FOUND | 리소스 없음 | 5 |
| BROWSER_DATA | 브라우저 데이터 | 6 |
| 기타 | 예기치 못한 에러 | 1 |

### 민감 정보 마스킹

`userMessage`는 토큰/개인 정보 미포함을 **원칙으로**하며, `Error.message`(내부)는 디버깅용 상세 정보 허용하되 로거(ADR-0009)가 마스킹 처리.

### Consequences

**Good:**
- CLI/MCP가 동일 에러를 서로 다른 포맷으로 적절히 표현
- `code` 필드로 자동화/스크립트 친화 (e.g., `af ls || [ $? -eq 2 ] && af auth`)
- `hint` 덕분에 사용자 복구 경로 명확
- LLM이 `isError` content + hint를 읽고 다음 Tool 선택 가능 (예: auth_status Tool 호출)
- `cause` 체인으로 스택 트레이스 보존

**Bad:**
- 에러 클래스 파일 증가 (10+ 클래스)
- 신규 에러 타입 추가 시 여러 boundary 문서/코드 갱신 동반
- TypeScript에서 `instanceof` 체크가 번들링 후 깨질 수 있음(드물지만) → `code` 필드 병행 사용

## Pros and Cons of the Options

### Typed Error Classes + Boundary 변환 (선택)

- Good, because instanceof + code 병행으로 타입 안전 + 직렬화 친화
- Good, because 계층별 표현 분리 가능 (userMessage vs message)
- Good, because 기존 Error 생태계와 호환 (stack trace, cause)
- Neutral, because 클래스 파일 관리 필요
- Bad, because boundary 구현체 2곳(CLI, MCP)에 변환 코드 중복

### Result<T, E> 모나드 (neverthrow)

- Good, because 컴파일 타임 에러 처리 강제
- Good, because Railway-oriented programming 가능
- Bad, because TypeScript 커뮤니티에서 관례 아님 (학습 비용)
- Bad, because async/await와 결합 시 타입 복잡도 증가
- Bad, because MCP SDK 등 외부 라이브러리는 throw 기반 → 경계 변환 동일

### Bare Error + 문자열 검사

- Good, because 구현 즉시 가능
- Bad, because 에러 타입 식별에 문자열 검사 → 깨지기 쉬움
- Bad, because 사용자/개발자 메시지 분리 불가
- Bad, because 다국어화 불가

## More Information

- **관련 ADR**:
  - [ADR-0006: Hexagonal Architecture](./ADR-0006-hexagonal-architecture.md) — core는 throw, adapter는 변환
  - [ADR-0007: MCP Tool 설계](./ADR-0007-mcp-tool-design-principles.md) — isError 패턴 준수
  - [ADR-0009: 로깅 전략](./ADR-0009-logging-strategy.md) — 민감 정보 마스킹은 로거가 담당
- **관련 TASK**:
  - TASK-02 (types.ts에 에러 클래스 정의)
  - TASK-06 (AuthService가 AuthExpiredError 등 throw)
  - TASK-07 (AkiflowClient가 NetworkError/ApiSchemaError throw)
  - TASK-09~13 (CLI commands의 boundary 변환)
  - TASK-15, 16 (MCP tools의 isError 변환)
- **Fitness Function (제안)**:
  - 모든 MCP Tool이 try/catch로 에러를 isError로 감싸는지 CI 검사 (static analysis)
  - CLI가 에러 시 exit code ≥ 1로 종료 (테스트)
  - `userMessage`에 토큰/패스워드 문자열 포함 여부 검사 (regex CI)
- **Revisit Triggers**:
  - TypeScript 5.x 이상에서 discriminated union 에러 처리가 표준화될 때
  - 다국어 지원(i18n) 필요 시 → userMessage를 키 기반으로 분리
  - 사용자 리포트에서 에러 메시지가 모호하다는 피드백 다수 발생 시
