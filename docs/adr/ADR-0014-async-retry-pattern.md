---
title: "ADR-0014: 비동기 / 재시도 패턴 — exponential backoff + jitter + 계층별 예산"
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
  - async
  - retry
  - backoff
  - resilience
---

# ADR-0014: 비동기 / 재시도 패턴 — exponential backoff + jitter + 계층별 예산

## Context and Problem Statement

역공학 API는 예고 없이 500/503/429 에러를 반환할 수 있고, 네트워크 끊김/타임아웃도 빈번하다. 무분별한 재시도는 API rate limit을 악화시키며, 재시도 없음은 일시적 장애에 취약하다. 각 호출 지점(Auth 갱신, API 호출, CDP 연결, pending queue)에 대한 재시도 정책을 일관되게 정의해야 한다.

## Decision Drivers

- **일시 장애 복구**: 네트워크 떨림, 서버 순간 장애
- **Rate limit 준수**: 429 시 의도적 backoff
- **Thundering herd 회피**: 동시 재시도 시 서버 폭주 방지 (jitter)
- **사용자 대기 시간**: CLI는 총 10초 이내 응답 선호
- **MCP 타임아웃**: LLM 클라이언트가 기본 30초 타임아웃 → 서버는 그 이하로 완료
- **에러 분류**: 어떤 에러는 재시도 대상, 어떤 에러는 즉시 실패 (ADR-0008)

## Considered Options

1. **Exponential Backoff + Jitter + 계층별 재시도 예산** (자체 구현 유틸)
2. **라이브러리 의존**: p-retry, axios-retry 등
3. **재시도 없음**: 첫 실패 즉시 에러 반환

## Decision Outcome

**선택: Exponential Backoff + Jitter + 계층별 예산 (자체 구현)**

### `withRetry` 유틸 (core/utils/retry.ts)

```typescript
export interface RetryPolicy {
  maxAttempts: number;        // 총 시도 횟수 (첫 시도 포함)
  baseDelayMs: number;        // 첫 재시도 지연
  maxDelayMs: number;         // 상한
  multiplier: number;         // 지수 배수 (보통 2)
  jitter: "full" | "equal" | "none"; // AWS full jitter 권장
  retryable: (err: unknown) => boolean; // 재시도 가능 여부 판별
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === policy.maxAttempts || !policy.retryable(err)) throw err;
      const delay = computeDelay(attempt, policy);
      policy.onRetry?.(attempt, err, delay);
      await sleep(delay);
    }
  }
  throw lastErr;
}

function computeDelay(attempt: number, policy: RetryPolicy): number {
  const expo = Math.min(policy.baseDelayMs * Math.pow(policy.multiplier, attempt - 1), policy.maxDelayMs);
  switch (policy.jitter) {
    case "none": return expo;
    case "equal": return expo / 2 + Math.random() * (expo / 2);
    case "full": return Math.random() * expo; // AWS 권장
  }
}
```

### 계층별 재시도 예산 (Retry Budget)

**원칙**: 상위 계층에서 재시도한 호출은 하위 계층에서 다시 재시도하지 않는다 (재시도 곱셈 방지).

| 계층 | 재시도 정책 |
|------|-----------|
| **adapters/http/akiflow-api.ts** | 재시도 **없음** (투명한 원시 호출) |
| **core/services/task-command-service** | 3회, base 500ms, max 5s, full jitter — 429/5xx만 |
| **core/services/task-query-service** | 2회, base 300ms, max 2s, full jitter — 429/5xx만 |
| **core/services/auth-service (refresh)** | 2회, base 500ms, max 3s, full jitter — 5xx만 (401은 재시도 금지) |
| **core/services/auth-service (withAuth wrapper)** | 401 발생 시 **refresh 후 1회만** 재시도 (무한 루프 방지) |
| **adapters/browser/cdp-launcher** | Chrome 시작 대기: 폴링 2s 간격, 최대 60s |
| **pending queue 처리** | 지수 backoff, max 30min 간격, 영구 실패 시 로그만 |

### 재시도 가능 에러 판별

```typescript
export function isRetryable(err: unknown): boolean {
  if (err instanceof NetworkError) {
    // 5xx 또는 timeout, DNS 실패 등
    return !err.status || err.status >= 500 || err.status === 429;
  }
  if (err instanceof AuthError) return false; // 인증 에러는 재시도 의미 없음
  if (err instanceof ValidationError) return false;
  if (err instanceof AbortError) return false; // 사용자 취소
  // 알 수 없는 에러는 보수적으로 재시도 하지 않음
  return false;
}
```

### 타임아웃

각 요청은 AbortController로 타임아웃 강제:

| 작업 | 타임아웃 |
|------|---------|
| HTTP 요청 (Akiflow API) | 10초 |
| 토큰 refresh (OAuth) | 5초 |
| CDP 초기 연결 | 5초 |
| CDP 사용자 로그인 대기 | 5분 (긴 폴링) |
| MCP Tool 핸들러 전체 | 30초 (AF_MCP_TOOL_TIMEOUT_MS) |

타임아웃 시 `NetworkError`의 `status = undefined, cause = AbortError`.

### 동시 호출 제한

Singleflight 패턴으로 동일 파라미터 동시 호출 dedup:

```typescript
// 예: 동시에 af ls 여러 번 실행 시 sync가 한 번만
private inflightSync?: Promise<SyncResult>;
async sync(): Promise<SyncResult> {
  if (this.inflightSync) return this.inflightSync;
  this.inflightSync = this.doSync().finally(() => (this.inflightSync = undefined));
  return this.inflightSync;
}
```

### Consequences

**Good:**
- 일시적 네트워크 에러 자동 복구
- 429 발생 시 jitter로 Thundering herd 완화
- 계층별 예산으로 재시도 폭발 방지
- 테스트에서 mock policy 주입 가능 (maxAttempts=1로 테스트 가속)
- 라이브러리 의존성 0

**Bad:**
- 사용자 시야에 재시도가 숨겨져 "왜 느린지" 디버깅 어려움 → `LOG_LEVEL=debug`에서 onRetry 로깅
- 재시도 가능 에러 판별 규칙이 잘못되면 무한 루프 또는 너무 이른 실패 위험
- singleflight 구현체 내 메모리 누수 가능성 → `finally` 강제

## Pros and Cons of the Options

### Exponential Backoff + Jitter (선택)

- Good, because 업계 표준 (AWS SDK 등 채택)
- Good, because 자체 구현 소규모 (< 100줄)
- Good, because 계층별 정책 세부 조정 가능
- Neutral, because 테스트 시 시계 제어 복잡도 존재
- Bad, because 유지보수 책임

### 라이브러리 의존 (p-retry)

- Good, because 검증된 구현
- Neutral, because 추가 의존성 (~10KB)
- Bad, because 본 프로젝트 재시도 예산 모델에 맞추기 어려울 수 있음
- Bad, because Bun 호환성 개별 검증 필요

### 재시도 없음

- Good, because 구현 단순, 예측 가능
- Bad, because 네트워크 떨림 시 사용자가 수동 재실행해야 함
- Bad, because 429 미대응 시 사용자 경험 불안정

## 테스트 전략

```typescript
// 짧은 지연 정책 주입 → 테스트 가속
const fastPolicy: RetryPolicy = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10, multiplier: 2, jitter: "none", retryable: isRetryable };

test("5xx 에러 2회 후 성공 시 재시도 복구", async () => {
  let attempts = 0;
  const result = await withRetry(async () => {
    attempts++;
    if (attempts < 3) throw new NetworkError("temp", 503);
    return "ok";
  }, fastPolicy);
  expect(attempts).toBe(3);
  expect(result).toBe("ok");
});
```

## More Information

- **관련 ADR**:
  - [ADR-0006: Hexagonal](./ADR-0006-hexagonal-architecture.md) — adapter는 재시도 없이 원시 호출만
  - [ADR-0008: 에러 처리](./ADR-0008-error-handling-strategy.md) — 재시도 판별에 typed error 활용
  - [ADR-0009: 로깅](./ADR-0009-logging-strategy.md) — onRetry debug 로그
  - [ADR-0013: 캐시 전략](./ADR-0013-local-cache-strategy.md) — pending queue 재시도
- **관련 TASK**:
  - TASK-05 (refresh 재시도)
  - TASK-06 (AuthService의 withAuth 재시도)
  - TASK-07 (TaskCommandService PATCH 재시도)
  - TASK-08 (pending queue 영구 backoff)
  - TASK-18 (CDP 폴링)
- **Fitness Function (제안)**:
  - `withRetry`가 maxAttempts 초과 시 원본 에러 throw (타입 보존)
  - 401 에러에 대해 어떤 계층에서도 2회 초과 재시도 금지 (static assertion)
  - P99 CLI 응답 시간 < 15초 (재시도 포함 상한)
- **Revisit Triggers**:
  - Akiflow가 API rate limit 헤더(`Retry-After` 등) 제공 시 → 동적 backoff 사용
  - Streamable HTTP MCP 도입 시 → 요청 기반 timeout 조정
  - 사용자 리포트에서 "왜 이렇게 느린가" 불만 다수 발생 시 → 재시도 디폴트 완화 검토
