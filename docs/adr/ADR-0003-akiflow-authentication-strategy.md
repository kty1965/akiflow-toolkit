---
title: "ADR-0003: Akiflow 인증 전략 — 4단계 계층적 토큰 획득 + 3계층 자동 복구"
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
  - authentication
  - auth
  - reverse-engineering
  - akiflow
---

# ADR-0003: Akiflow 인증 전략 — 4단계 계층적 토큰 획득 + 3계층 자동 복구

## Context and Problem Statement

Akiflow는 공식 API를 제공하지 않으며(465명 요청, 5년간 미해결), 내부 API v5는 역공학이 필요하다. 인증 토큰을 어떻게 획득하고 유지할지 결정해야 하며, 이는 사용자 UX(로그인 횟수, 수동 개입 빈도)와 장기 안정성(토큰 만료 자동 복구)에 직결된다. 3개의 기존 커뮤니티 구현체가 서로 다른 접근을 취하고 있어 각 장점을 통합할 필요가 있다.

## Decision Drivers

- **사용자 개입 최소화**: 매번 DevTools 열어 토큰 복사하게 하면 안 됨
- **자동 토큰 갱신**: MCP 서버는 장시간 실행 → access_token/refresh_token 만료 자동 처리
- **의존성 경량화**: Puppeteer(50MB) 등 무거운 브라우저 자동화 회피
- **크로스 브라우저**: Chrome, Arc, Brave, Edge, Safari 지원
- **보안 ToS 준수**: 역공학임을 인지하되 과도한 우회는 회피
- **폴백 가능성**: 자동 방식 실패 시 수동 입력 경로 제공
- **MCP 장기 실행**: 서버 재시작 없이 토큰 만료 복구

## Considered Options

1. **4단계 계층적 토큰 획득 + 3계층 자동 복구 (하이브리드)** — 여러 오픈소스 레퍼런스의 장점을 결합
2. **수동 DevTools 추출만** (레퍼런스 A 방식) — refresh_token 환경변수
3. **Puppeteer 브라우저 자동화** (레퍼런스 B 방식)
4. **로컬 브라우저 파일 추출만** (레퍼런스 C 방식) — IndexedDB/쿠키 직접 파싱

## Decision Outcome

**선택: 4단계 계층적 토큰 획득 + 3계층 자동 복구**

### 획득 4단계

```
단계 1: 디스크 크리덴셜 (~/.config/akiflow/auth.json) 확인
단계 2: 브라우저 파일 자동 추출 (IndexedDB LevelDB + Chrome 쿠키 + Safari 쿠키)
단계 3: CDP 브라우저 로그인 (비공식 API MCP+CLI 레퍼런스에서 확인된 패턴, Puppeteer 없이 순수 WebSocket)
단계 4: 수동 refresh_token 입력 (최후 폴백)
```

### 복구 3계층

```
계층 1: access_token 재발급 (POST /oauth/refreshToken)
계층 2: 디스크 재로드 (다른 프로세스가 갱신했을 가능성)
계층 3: 단계 2(브라우저 파일 재추출) 자동 재실행
```

### 이유

- **사용자 UX 최우선**: 브라우저에 이미 로그인된 상태면 `af auth` 명령만으로 단계 2가 완전 무인 동작 (기존 CLI 레퍼런스 구현에서 실효성 검증됨)
- **의존성 최소**: Puppeteer 배제, CDP는 Node 내장 WebSocket + `child_process.spawn`으로 구현 가능 (~100KB vs ~50MB)
- **장기 안정성**: 3계층 복구로 MCP 서버가 수주 단위 연속 운영 가능
- **폴백 보장**: 어떤 환경(Windows, Docker, CI)에서도 단계 4 수동 입력으로 동작 가능

### Consequences

**Good:**
- 정상 사용 시 사용자 개입 **0회** (브라우저 기반 자동)
- refresh_token 만료 시 사용자 개입 **0회** (3계층 복구)
- 모든 계층 실패 시 명확한 안내 메시지
- Puppeteer 의존성 제거로 패키지 크기 수십 MB 절감
- 4가지 소스(indexeddb/cookie/cdp/manual)를 `Credentials.source`로 추적 → 디버깅 용이

**Bad:**
- **H3**: macOS Keychain 접근 시 보안 팝업 발생 가능 (→ 실패 시 IndexedDB로 graceful fallback)
- **M2**: CDP 사용 시 Chrome 실행 파일 경로 OS/브라우저별 감지 필요
- **M3**: refresh_token rotation 정책이 Akiflow 측 비공개 → 갱신 응답에서 새 토큰 저장으로 대응
- Akiflow 내부 API 구조 변경 시 모든 4단계가 동시에 깨질 수 있음 (단일 실패점)
- 역공학 접근 → Akiflow ToS 회색지대 (개인 사용 범위에서만 권장)
- IndexedDB LevelDB 파싱은 정규식 기반이라 Akiflow 웹앱 UI 변경 시 취약할 수 있음

## Pros and Cons of the Options

### 4단계 + 3계층 (선택)

- Good, because 자동화 최대화 + 폴백 보장
- Good, because 의존성 최소 (Puppeteer 없음)
- Good, because 3개 기존 구현체의 장점을 모두 통합
- Neutral, because 구현 복잡도 증가 (4개 방식 + 3개 복구 계층)
- Bad, because Akiflow 내부 변경 시 영향 범위 넓음 (모든 계층 공통 API 사용)

### 수동 DevTools 추출 (레퍼런스 A: refresh_token 환경변수 방식)

- Good, because 구현 간단 (env var 1개)
- Good, because 가장 안정 (수동 토큰은 변경에 둔감)
- Bad, because 매번 30분마다 사용자가 DevTools 열어야 함 (실용성 제로)
- Bad, because MCP 서버 장기 운영 불가능

### Puppeteer 브라우저 자동화 (레퍼런스 B: 브라우저 로그인 자동화 방식)

- Good, because 최초 로그인 UX 가장 깔끔
- Good, because 브라우저 세션 자동 관리
- Bad, because Puppeteer ~50MB 의존성
- Bad, because headless 서버 환경에서 동작 불가
- Bad, because 패키지 크기 폭증

### 로컬 브라우저 파일 추출만 (레퍼런스 C: IndexedDB/쿠키 직접 파싱 방식)

- Good, because 무인 동작 (이미 로그인 상태면)
- Good, because 의존성 최소
- Bad, because 처음 쓰는 사용자는 브라우저에 먼저 로그인해야 함
- Bad, because CI/Docker 환경에서 동작 불가 (브라우저 파일 없음)
- Bad, because 토큰 만료 시 사용자가 브라우저에서 재로그인 후 `af auth` 재실행 필요

## More Information

- **관련 ADR**: [ADR-0001](./ADR-0001-runtime-selection-bun.md) (Bun의 `bun:sqlite`로 Chrome 쿠키 DB 접근), [ADR-0002](./ADR-0002-cli-mcp-entrypoint-pattern.md) (core 계층 공유로 CLI/MCP가 동일 AuthManager 사용)
- **관련 TASK**: TASK-03 (storage), TASK-04 (extract-token), TASK-05 (refresh), TASK-06 (AuthManager), TASK-18 (CDP), TASK-19 (3계층 복구 + Safari)
- **해결하는 정합성 이슈**: H3 (macOS Keychain), M2 (Chrome 경로), M3 (refresh_token rotation)
- **Fitness Function (제안)**:
  - 정상 조건: `af auth` 실행 시 사용자 개입 0회 (브라우저 로그인 상태 전제)
  - 복구 조건: refresh_token 만료 후 다음 API 호출 시 자동 갱신 성공률 ≥ 95%
  - 의존성: npm 패키지 크기 < 10MB (Puppeteer 도입 방지 가드)
- **레퍼런스 (익명화)**:
  - 레퍼런스 A — refresh_token 환경변수 방식의 Akiflow MCP 구현 (`POST /oauth/refreshToken` + `Bearer` 헤더로 v5 API 접근)
  - 레퍼런스 B — Puppeteer로 브라우저를 띄워 로그인 후 토큰 캡처하는 Akiflow MCP 구현
  - 레퍼런스 C — 브라우저 IndexedDB LevelDB와 암호화 쿠키를 직접 파싱하는 Bun 기반 Akiflow CLI
  - 레퍼런스 D — 동일하게 공식 API 없는 서비스(NotebookLM)용 CDP 기반 쿠키 추출 + 3계층 인증 복구 패턴을 구현한 MCP+CLI 듀얼 레퍼런스
  - 역공학된 Akiflow 내부 API 스펙 문서 (v5 엔드포인트, UPSERT 방식, sync_token 페이지네이션)
- **Revisit Triggers**:
  - Akiflow가 공식 API 출시 시 (465명 요청 중) → 역공학 전면 제거
  - 내부 API 구조 변경으로 4개 방식 중 3개 이상 동시 실패 발생 시
  - ToS 변경으로 역공학 명시적 금지 시
