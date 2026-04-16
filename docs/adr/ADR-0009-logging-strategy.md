---
title: "ADR-0009: 로깅 전략 — stdout 보호 + 구조화 로깅 + 민감 정보 마스킹"
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
  - logging
  - mcp
  - stdout
  - observability
---

# ADR-0009: 로깅 전략 — stdout 보호 + 구조화 로깅 + 민감 정보 마스킹

## Context and Problem Statement

MCP 모드에서는 **stdout이 JSON-RPC 프로토콜 전용**이므로 `console.log` 한 번만 섞여도 MCP 클라이언트(Claude Code 등)가 JSON 파싱 실패로 연결이 끊긴다(H2). 반면 CLI 모드에서는 stdout이 명령 결과를 출력하는 채널이며, 로그와 결과가 섞이면 파이프/스크립트 조합이 깨진다. 양 모드에서 동작하는 공통 로깅 계약과 민감 정보(토큰, 이메일) 마스킹 정책이 필요하다.

## Decision Drivers

- **H2 (MCP stdout 오염) 원천 차단**: core/adapters 어디서도 `console.log` 직접 호출 금지
- **CLI UX**: `--json` 옵션 등 기계 파싱 가능한 출력은 stdout, 진행 로그는 stderr
- **민감 정보 보호**: access_token, refresh_token, 이메일 주소 로그에 노출 금지
- **로그 레벨 제어**: 환경변수로 trace/debug/info/warn/error 전환
- **MCP 표준 준수**: 가능 시 MCP `notifications/message`로 client로 로그 전달
- **경량 구현**: 추가 의존성(pino, winston) 없이 자체 구현

## Considered Options

1. **LoggerPort + stderr-logger 어댑터 (자체 구현)** — core/ports/logger-port.ts 인터페이스 + adapter 구현
2. **pino 등 구조화 로깅 라이브러리**
3. **console.log/error 직접 사용** (규약만 따름)

## Decision Outcome

**선택: LoggerPort + stderr-logger 어댑터 (자체 구현)**

### 로거 인터페이스 (core/ports/logger-port.ts)

```typescript
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "silent";

export interface LoggerPort {
  trace(msg: string, context?: Record<string, unknown>): void;
  debug(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, err?: Error, context?: Record<string, unknown>): void;
}
```

### 기본 구현 (adapters/observability/stderr-logger.ts)

```typescript
const MASK_KEYS = ["accessToken", "refreshToken", "token", "Authorization", "password", "refresh_token", "access_token"];
const MASK_PATTERNS = [
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,  // JWT
  /def50200[a-f0-9]{20,}/g,                                    // refresh_token 패턴
];

function mask(value: unknown): unknown {
  if (typeof value === "string") {
    let masked = value;
    for (const p of MASK_PATTERNS) masked = masked.replace(p, "***");
    return masked;
  }
  if (Array.isArray(value)) return value.map(mask);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = MASK_KEYS.includes(k) ? "***" : mask(v);
    }
    return out;
  }
  return value;
}

export class StderrLogger implements LoggerPort {
  constructor(
    private readonly level: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? "info",
    private readonly json: boolean = process.env.LOG_FORMAT === "json",
  ) {}

  private write(level: LogLevel, msg: string, extra?: unknown): void {
    if (!this.shouldLog(level)) return;
    const entry = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...(extra ? { context: mask(extra) } : {}),
    };
    process.stderr.write(
      this.json ? JSON.stringify(entry) + "\n" : this.formatText(entry) + "\n"
    );
  }

  // ... 나머지 레벨 메서드
}
```

### stdout vs stderr 규칙

| 모드 | stdout 용도 | stderr 용도 |
|------|-----------|------------|
| **CLI (일반)** | 명령 결과 (태스크 목록 등), 사용자 대상 출력 | 진행 로그, 에러 |
| **CLI --json** | JSON 포맷 결과 (스크립트 파싱용) | 모든 로그, 에러 |
| **MCP (--mcp)** | **JSON-RPC 프로토콜 전용 — 절대 접근 금지** | 모든 로그, 에러 |

### 환경변수

| 변수 | 값 | 동작 |
|------|------|------|
| `LOG_LEVEL` | trace/debug/info/warn/error/silent | 기본값: `info` (CLI), `warn` (MCP) |
| `LOG_FORMAT` | `text` / `json` | 기본값: `text`. CI/파이프 환경에서 `json` 권장 |
| `NO_COLOR` | `1` | 컬러 출력 비활성화 |
| `AF_DEBUG` | `1` | `LOG_LEVEL=debug` 단축 |

### MCP 모드 로그 전달

가능하면 MCP 표준의 `notifications/message`로 client에 로그 전달:

```typescript
// MCP 모드에서만 활성화되는 추가 어댑터
export class McpNotificationLogger implements LoggerPort {
  constructor(private readonly server: McpServer) {}
  info(msg: string, ctx?: Record<string, unknown>) {
    this.server.sendLoggingMessage({ level: "info", data: { msg, ...mask(ctx ?? {}) } });
  }
  // ...
}
```

CLI 모드는 StderrLogger, MCP 모드는 StderrLogger + (선택적) McpNotificationLogger 병행.

### Consequences

**Good:**
- MCP stdout 오염 원천 차단 (core에서 `console.log` 사용 자체가 불가능 → `LoggerPort`만 주입받음)
- 토큰/JWT 자동 마스킹으로 로그 파일 유출 리스크 감소
- `LOG_FORMAT=json`으로 관측 시스템(Datadog, CloudWatch) 통합 용이
- 외부 의존성 없이 구현 가능 (번들 크기 영향 최소)
- MCP client에 로그 알림 전달 가능 (Claude Code 디버그 뷰에서 확인)

**Bad:**
- 커스텀 구현 유지보수 필요 (pino 대비 기능 한계)
- 마스킹 규칙 누락 시 민감 정보 유출 가능 → 정기 감사 필요
- JSON 포맷에서 컬러/인덴트 제거되어 개발 중 가독성 저하 → `LOG_FORMAT=text` 디폴트

## Pros and Cons of the Options

### LoggerPort + stderr-logger (선택)

- Good, because LoggerPort가 Hexagonal(ADR-0006)의 포트로 자연스럽게 통합
- Good, because stderr 강제로 H2 해결
- Good, because 마스킹/포맷 커스터마이징 자유
- Good, because 의존성 0
- Bad, because 기능 한계 (pino의 transport, sampling 등 없음)

### pino

- Good, because 성숙한 구조화 로깅, pretty-print 등 풍부
- Neutral, because 약 200KB 추가 번들
- Bad, because Bun 호환성 일부 이슈 보고 있음 (전송기 worker thread)
- Bad, because stdout 기본 → MCP 모드에서 직접 사용 불가 (destination 변경 필요)

### console.log/error 직접 사용

- Good, because 구현 없음
- Bad, because core/adapters에서 직접 `console.log` 허용 시 MCP 오염 리스크 상존
- Bad, because 마스킹 없음
- Bad, because 로그 레벨/포맷 제어 불가

## Fitness Functions

- `core/`와 `adapters/` 파일에서 `console.log` / `console.warn` / `console.info` 직접 호출 금지 (CI grep)
- MCP 모드 실행 시 stdout에 JSON-RPC 외 텍스트 출력 0건 (integration test)
- `auth.json` 또는 JWT 패턴이 로그에 나타나지 않음 (log fixture 검증)

## More Information

- **관련 ADR**:
  - [ADR-0002: CLI + MCP 진입점 패턴](./ADR-0002-cli-mcp-entrypoint-pattern.md) — MCP stdout 전용 원칙의 근거
  - [ADR-0006: Hexagonal Architecture](./ADR-0006-hexagonal-architecture.md) — LoggerPort로 포트화
  - [ADR-0008: 에러 처리](./ADR-0008-error-handling-strategy.md) — 에러 로깅 시 stack + cause 기록
- **관련 TASK**:
  - TASK-14 (MCP server.ts에 LoggerPort 주입)
  - TASK-15, 16 (Tool에서 logger 사용)
  - TASK-09~13 (CLI 명령어에서 logger 사용)
  - TASK-01 (package.json에 `"chalk"` 등 컬러 라이브러리 추가 시 옵셔널로)
- **Revisit Triggers**:
  - MCP 서버가 원격 배포(Streamable HTTP)로 전환되어 중앙 집중 로깅 필요 시 → pino + transport
  - 마스킹 룰이 자주 누락되어 유출 사고 발생 시 → 전용 secrets-detector 도입
  - OpenTelemetry 도입 결정 시 → logger + tracer 통합
