---
title: "ADR-0001: 런타임 선택 — Bun"
createdAt: 2026-04-15T18:00:00+09:00
updatedAt: 2026-04-15T18:00:00+09:00
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
  - runtime
  - bun
  - nodejs
---

# ADR-0001: 런타임 선택 — Bun

## Context and Problem Statement

Akiflow 통합 CLI + MCP 서버 프로젝트의 개발/실행 런타임을 결정해야 한다. TypeScript 기반으로 구현하며, CLI와 MCP 서버(stdio transport)를 모두 제공하고, 크로스 플랫폼 단일 바이너리 배포도 목표다.

## Decision Drivers

- **시작 속도**: MCP 서버는 AI 에이전트가 매 세션마다 자식 프로세스로 실행 → 시작 지연이 UX에 직접 영향
- **TypeScript 네이티브 실행**: 개발 단계에서 별도 빌드 없이 실행 가능한지
- **@modelcontextprotocol/sdk 호환성**: 공식 SDK v1.29+ 동작 보장
- **단일 바이너리 컴파일**: Node 의존 없는 배포용 바이너리 생성 가능 여부
- **의존성 크기**: 역공학 기반 프로젝트 특성상 경량 유지 필수
- **npm 생태계 접근**: bunx/npx 등 실행 진입점 호환성
- **기존 레퍼런스**: Akiflow API를 역공학한 오픈소스 CLI 레퍼런스는 Bun 기반으로, 커뮤니티 MCP 서버 구현체들은 Node 기반으로 구현된 사례가 확인됨

## Considered Options

1. **Bun** — Oven-sh가 개발한 JavaScript/TypeScript 런타임
2. **Node.js** — 전통적 JavaScript 런타임
3. **Deno** — Ryan Dahl의 TypeScript-first 런타임

## Decision Outcome

**선택: Bun**

### 이유

Bun은 다음 요건을 모두 충족하는 유일한 대안이다.

- MCP 서버 시작 속도 Node.js 대비 약 14배 향상 (0.09s vs 1.2s) — AI 에이전트 응답성에 직결
- TypeScript 네이티브 실행 (개발 시 `bun run src/index.ts`) → 별도 빌드 불필요
- `bun build --compile --target=bun-<platform>`로 단일 바이너리 생성 (Node 런타임 불필요)
- `@modelcontextprotocol/sdk` v1.29+ 완전 호환 검증됨 (참고 리서치)
- `bun:sqlite` 내장 → Chrome 쿠키 DB 읽기에 추가 의존성 불필요
- 동일 Akiflow 내부 API를 역공학하는 기존 Bun 기반 레퍼런스 구현이 안정적으로 동작 중임을 확인 → 실행 가능성 검증됨

### Consequences

**Good:**
- CLI 모드 시작 속도 빠름 (대화형 UX 개선)
- MCP 서버가 AI 에이전트에서 빠르게 응답
- 개발 시 빌드 스텝 최소화 (hot reload 지원)
- 단일 바이너리 배포 시 Node 미설치 환경에서도 동작
- `bun:sqlite` 내장으로 추가 의존성 없이 Chrome 쿠키 DB 처리

**Bad:**
- Bun 자체가 아직 상대적으로 신규 런타임 (성숙도 Node 대비 낮음)
- **npx 호환 배포를 위해 `bun build --target node`로 별도 JS 빌드 필요** (dist/cli.js + `#!/usr/bin/env node` shebang)
- Windows 바이너리 크로스 컴파일 타겟(`bun-windows-x64`) 지원되나 일부 네이티브 API 제약 가능성
- semantic-release 등 Node 기반 도구는 CI에서 **setup-bun + setup-node** 병행 필요 (역할 분리)

## Pros and Cons of the Options

### Bun

- Good, because TypeScript 네이티브 실행, 빌드 스텝 생략 가능
- Good, because 시작 속도 14x 빠름 → MCP 서버 UX 결정적 개선
- Good, because 단일 바이너리 컴파일(`--compile`) 내장
- Good, because `bun:sqlite`로 Chrome 쿠키 접근 의존성 불필요
- Good, because 동일 API를 역공학한 Bun 기반 레퍼런스 구현이 존재하여 실행 가능성 검증됨
- Neutral, because semantic-release는 Node로 별도 실행 필요 (CI 분리는 표준 패턴)
- Bad, because 생태계 성숙도가 Node 대비 낮음
- Bad, because Node 호환 배포 위해 `--target node` 빌드 추가 단계 필요

### Node.js

- Good, because 압도적 생태계 성숙도, npm 호환성 완벽
- Good, because semantic-release 등 거의 모든 도구가 Node 퍼스트
- Bad, because TypeScript 실행에 `ts-node` / `tsx` 또는 사전 빌드 필요
- Bad, because 시작 속도 느림 (~1.2s) — MCP UX 열위
- Bad, because 단일 바이너리 생성에 `pkg`/`nexe` 등 별도 도구 필요 (성숙도 낮음)

### Deno

- Good, because TypeScript-first, 보안 샌드박스, 표준 라이브러리
- Bad, because npm 호환성이 Bun/Node 대비 불완전
- Bad, because `@modelcontextprotocol/sdk` Deno 검증 사례 부족
- Bad, because 참고할 Akiflow 역공학 레퍼런스(CLI 및 MCP 서버 사례들)가 모두 Node/Bun 생태계에 집중
- Bad, because Deno-specific API 학습 필요

## More Information

- **관련 ADR**: [ADR-0004](./ADR-0004-release-automation-semantic-release.md) (semantic-release가 Node 기반이므로 CI에서 setup-node 추가 필요), [ADR-0005](./ADR-0005-git-hooks-pre-commit.md) (pre-commit은 Python 기반이라 Bun과 무관)
- **관련 TASK**: TASK-01 (스캐폴딩), TASK-20 (빌드 및 배포)
- **레퍼런스**:
  - Bun 공식 문서 (`bun build --compile`, 크로스 컴파일 타겟)
  - `@modelcontextprotocol/sdk` Bun 호환성 기술 블로그
  - 기존 Bun 기반 Akiflow CLI 레퍼런스 구현 (Akiflow 내부 API 역공학)
- **Revisit Triggers**:
  - `@modelcontextprotocol/sdk`가 Bun 지원 중단 발표 시
  - Bun 메이저 버전 브레이킹 체인지 발생 시
  - Node.js가 TypeScript 네이티브 실행 + 단일 바이너리 컴파일 기본 제공 시
