---
title: "ADR-0002: CLI + MCP 진입점 패턴 — 단일 진입점 + `--mcp` 플래그 분기"
createdAt: 2026-04-15T18:00:00+09:00
updatedAt: 2026-04-15T18:00:00+09:00
version: "1.0.0"
type: artifact
status: accepted
date: 2026-04-15
decision-makers:
  - Huy
consulted:
  - iterative-architecture:option-explorer
  - iterative-architecture:tradeoff-analyst
informed:
  - 팀 전체
tags:
  - adr
  - cli
  - mcp
  - architecture
  - entrypoint
---

# ADR-0002: CLI + MCP 진입점 패턴 — 단일 진입점 + `--mcp` 플래그 분기

## Context and Problem Statement

하나의 프로젝트에서 **CLI 도구**(`af auth`, `af ls` 등)와 **MCP 서버**(Claude Code 등에서 stdio transport로 호출)를 모두 제공해야 한다. 두 모드를 어떻게 하나의 배포물로 노출할지(단일 바이너리, 복수 바이너리, 모노레포) 결정이 필요하다. 선택에 따라 배포 복잡도, 사용자 UX, 코드 재사용성이 달라진다.

## Decision Drivers

- **배포 단순성**: npm 패키지 1개로 CLI + MCP 모두 제공 가능한가
- **사용자 UX**: `af auth` (CLI)와 `af --mcp` (MCP) 모두 직관적이어야 함
- **코드 재사용**: 인증, API 클라이언트 등 core 계층 공유 필수
- **레퍼런스 구현**: 한 비공식 API MCP+CLI 듀얼 레퍼런스(복수 바이너리 채택), 대형 오픈소스 린터(단일 진입점 + `--mcp` 플래그 채택) 등 검증된 패턴이 존재
- **MCP stdio 제약**: MCP 모드에서 stdout은 JSON-RPC 전용 → CLI 프레임워크의 stdout 사용 충돌 방지 필요
- **초기 프로젝트 규모**: 소규모 단일 패키지 적절성

## Considered Options

1. **단일 진입점 + `--mcp` 플래그 분기** (대형 오픈소스 린터에서 채택된 방식)
2. **복수 바이너리** `af` + `af-mcp` (비공식 API MCP+CLI 듀얼 레퍼런스에서 채택된 방식)
3. **모노레포** (core/cli/mcp 3개 패키지)

## Decision Outcome

**선택: 단일 진입점 + `--mcp` 플래그 분기**

### 이유

초기 단계 소규모 프로젝트에서 가장 단순하고, MCP 모드 분기를 citty 초기화 **이전**에 수행하여 플래그 충돌과 stdout 오염을 동시에 해결할 수 있다. 배포물 하나만 관리하면 된다.

```typescript
// src/index.ts
if (process.argv.includes("--mcp")) {
  const { startMcpServer } = await import("./mcp/server.ts");
  await startMcpServer();
} else {
  const { runCli } = await import("./cli/app.ts");
  await runCli();
}
```

### Consequences

**Good:**
- npm 배포 1개 (`akiflow-toolkit`) → 사용자가 `npm install -g` 한 번으로 CLI + MCP 모두 사용
- `af setup claude-code`에서 `command: "af", args: ["--mcp"]`로 깔끔하게 등록
- citty가 미인식 `--mcp` 플래그에 에러 내기 전에 분기 → 충돌 자동 방지 (**M1 해결**)
- MCP 모드 시 `cli/app.ts` 임포트 자체가 이뤄지지 않음 → citty의 stdout 오염 리스크 원천 차단 (**H2 해결**)
- core 계층(`src/core/`)을 CLI/MCP가 공유 → 코드 중복 최소화

**Bad:**
- `--mcp` 플래그가 CLI 명령어 네임스페이스를 약간 오염 (예약어)
- 단일 진입점이므로 CLI/MCP를 독립적으로 배포/버전 관리 불가
- 향후 MCP 서버가 크게 성장하여 별도 배포 필요해지면 리팩토링 필요

## Pros and Cons of the Options

### 단일 진입점 + `--mcp` 플래그 분기 (선택)

- Good, because 배포 복잡도 최소 (npm 패키지 1개, 바이너리 1개)
- Good, because 사용자 설치/학습 곡선 단축
- Good, because 대형 오픈소스 프로젝트에서 검증된 레퍼런스 패턴 존재
- Good, because citty 초기화 전 분기 → 플래그 충돌 + stdout 오염 자동 해결
- Neutral, because 코드 재사용을 위해 core/cli/mcp 디렉토리 분리 필요 (자연스러움)
- Bad, because `--mcp`가 예약된 CLI 플래그가 됨

### 복수 바이너리 (`af` + `af-mcp`)

- Good, because 역할 분리 명확
- Good, because package.json `bin` 필드로 두 커맨드 동시 등록 가능
- Neutral, because 비공식 API MCP+CLI 듀얼 레퍼런스가 채택한 패턴이나 본 프로젝트 규모 대비 과도
- Bad, because 2개 바이너리 관리 (빌드, shebang 후처리 2회)
- Bad, because 사용자가 두 명령어를 모두 인식해야 함
- Bad, because 여전히 동일 npm 패키지이므로 독립 버전 관리 불가

### 모노레포 (Turborepo / Nx)

- Good, because core를 다른 프로젝트에서 재사용 가능
- Good, because CLI/MCP 독립 버전/배포 가능
- Bad, because 소규모 초기 프로젝트에 과도한 복잡도
- Bad, because 빌드 도구(Turborepo) 추가 학습 비용
- Bad, because Bun workspace + 모노레포 도구 조합 검증 필요
- Bad, because semantic-release 모노레포 플러그인 별도 필요

## More Information

- **관련 ADR**: [ADR-0001](./ADR-0001-runtime-selection-bun.md) (Bun 런타임), [ADR-0003](./ADR-0003-akiflow-authentication-strategy.md) (인증 전략 — core 공유 전제)
- **관련 TASK**: TASK-01 (스캐폴딩), TASK-14 (MCP 서버 + 분기 로직), TASK-17 (af setup)
- **해결하는 정합성 이슈**: H2 (MCP stdout 오염), M1 (citty `--mcp` 플래그 충돌)
- **레퍼런스**:
  - 대형 오픈소스 린터 — 단일 진입점 + `--mcp` 플래그 분기 패턴
  - 비공식 API를 다루는 MCP+CLI 듀얼 레퍼런스 구현 — 복수 바이너리 패턴 사례
- **Revisit Triggers**:
  - MCP 서버가 대폭 확장되어 독립 배포/버전이 필요해질 때
  - Tool 수가 20개 이상으로 늘어 별도 패키지 분리가 관리에 유리해질 때
  - core 계층을 다른 프로젝트에서 재사용해야 할 때
