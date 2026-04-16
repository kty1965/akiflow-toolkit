---
title: "ADR-0012: 설정 관리 — 계층적 환경변수 + XDG 파일"
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
  - configuration
  - env-vars
  - xdg
---

# ADR-0012: 설정 관리 — 계층적 환경변수 + XDG 파일

## Context and Problem Statement

본 프로젝트는 설정 값이 다양하다: 토큰 저장 위치, 로그 레벨, API 엔드포인트(디버그용 override), 캐시 TTL, CDP 포트 등. 이들을 어떻게 우선순위를 두고 관리할지, 민감한 값(refresh_token)은 어떻게 보관할지 결정이 필요하다.

## Decision Drivers

- **민감 정보 분리**: 토큰은 설정 파일과 분리
- **커스터마이징**: CI, 테스트 환경에서 오버라이드 용이
- **XDG Base Directory**: Linux/macOS 표준 준수
- **자명성**: 사용자가 설정 위치를 쉽게 파악
- **0-config**: 기본값만으로도 동작

## Considered Options

1. **계층적 환경변수 + XDG 설정 파일 (하이브리드)**
2. **환경변수만 사용** (`.env` 파일 포함)
3. **JSON/YAML 설정 파일만 사용**

## Decision Outcome

**선택: 계층적 환경변수 + XDG 설정 파일 (하이브리드)**

### 우선순위 (높음 → 낮음)

```
1. 커맨드라인 플래그          (예: af --log-level debug ls)
2. 환경변수                   (예: LOG_LEVEL=debug af ls)
3. 프로젝트별 설정 (cwd)      (./.akiflow.yaml)      ← 드물게 사용
4. 사용자 설정                (~/.config/akiflow/config.yaml)
5. 하드코딩 기본값
```

민감 정보(`refreshToken`)는 **이 계층을 벗어나** `~/.config/akiflow/auth.json`에만 저장 (ADR-0003 참조).

### 환경변수 네임스페이스

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `AF_CONFIG_DIR` | `$XDG_CONFIG_HOME/akiflow` 또는 `~/.config/akiflow` | 설정 파일 디렉토리 |
| `AF_CACHE_DIR` | `$XDG_CACHE_HOME/akiflow` 또는 `~/.cache/akiflow` | 캐시 디렉토리 |
| `AF_API_BASE_URL` | `https://api.akiflow.com` | API 엔드포인트 (디버그용 override) |
| `AF_AUTH_BASE_URL` | `https://web.akiflow.com` | OAuth 엔드포인트 |
| `AF_CDP_PORT` | `9222` | CDP 디버깅 포트 |
| `AF_CACHE_TTL_SECONDS` | `30` | 캐시 신선도 |
| `LOG_LEVEL` | `info` (CLI) / `warn` (MCP) | 로그 레벨 (ADR-0009) |
| `LOG_FORMAT` | `text` | `text` 또는 `json` |
| `NO_COLOR` | (unset) | `1` 설정 시 컬러 비활성 |
| `AF_DEBUG` | (unset) | `1` → `LOG_LEVEL=debug` 단축 |
| `AKIFLOW_REFRESH_TOKEN` | (unset) | 수동 인증 모드 (ADR-0003 단계 4) |

**규칙**:
- 일반 설정은 `AF_` prefix (짧고 명확)
- 표준화된 변수(`LOG_LEVEL`, `NO_COLOR`, `XDG_*`)는 관례 유지
- `AKIFLOW_` prefix는 기존 커뮤니티 구현체와의 호환을 위해 인증 토큰 하나만 유지

### 사용자 설정 파일 (config.yaml)

```yaml
# ~/.config/akiflow/config.yaml (선택적)
log:
  level: info          # trace|debug|info|warn|error|silent
  format: text         # text|json
cache:
  ttlSeconds: 30
  maxEntries: 2500
api:
  baseUrl: https://api.akiflow.com
  # authBaseUrl: https://web.akiflow.com   # 디버그 override
cli:
  shortIdsPerPage: 10  # af ls에서 표시할 기본 개수
mcp:
  toolTimeoutMs: 30000
```

YAML 선택 이유: 사용자 CLAUDE.md의 포맷터 규칙에 "YAML은 `.yaml` 확장자 사용" 명시.

### 민감 정보는 별도 파일

```
~/.config/akiflow/
├── config.yaml          # 비민감 설정 (0644)
└── auth.json            # 민감 정보 — 토큰 (0600)
```

권한이 다르며, 백업/동기화 제외 규칙에서도 다르게 취급하도록 docs/CONFIGURATION.md에 명시.

### ConfigPort (core/ports/config-port.ts)

```typescript
export interface ConfigPort {
  logLevel(): LogLevel;
  logFormat(): "text" | "json";
  cacheTtlSeconds(): number;
  apiBaseUrl(): string;
  authBaseUrl(): string;
  cdpPort(): number;
  configDir(): string;
  cacheDir(): string;
}
```

이를 Hexagonal(ADR-0006)의 Port로 분리 → 테스트에서 mock 용이.

### Consequences

**Good:**
- 12-factor App 원칙 준수 (환경변수 우선)
- CI/테스트에서 쉽게 오버라이드 가능 (`AF_CACHE_DIR=/tmp/test ... bun test`)
- 민감 정보와 비민감 설정 파일 분리 → 실수 방지
- XDG 준수로 Linux/macOS 규약 일치
- 사용자가 config.yaml을 작성하지 않아도 모든 기본값으로 동작

**Bad:**
- 설정 소스가 여러 개(CLI flag/env/config file/default)라 "왜 이 값이 나오는가" 디버깅 시 `af config --show` 같은 진단 커맨드 필요
- YAML 파서(`yaml` 패키지 ~30KB) 의존성 추가 또는 자체 minimal 파서 필요
- Windows의 XDG 경로 매핑 결정 필요 (`%APPDATA%`/`%LOCALAPPDATA%`)

## Pros and Cons of the Options

### 계층적 환경변수 + XDG 설정 파일 (선택)

- Good, because 모든 수준(CI/테스트/일상)에서 적절한 오버라이드 수단 제공
- Good, because 민감 정보 분리 자연스러움
- Neutral, because 설정 소스 다수 → 진단 커맨드 필요
- Bad, because YAML 파서 의존성

### 환경변수만 사용

- Good, because 구현 가장 단순
- Good, because 컨테이너/CI 친화적
- Bad, because 사용자 일상 설정(예: 즐겨찾는 프로젝트) 저장 어려움
- Bad, because 설정 항목 10개 넘으면 shell profile 오염

### JSON/YAML 설정 파일만 사용

- Good, because 설정 한곳에 집약
- Bad, because 환경변수 오버라이드 불가 → CI/테스트 경직
- Bad, because 민감 정보도 동일 파일에 섞일 위험

## 진단 명령어 (권장)

```bash
af config --show
# 출력 (예시):
# logLevel:         info             (source: default)
# logFormat:        text             (source: config.yaml)
# cacheTtlSeconds:  30               (source: default)
# configDir:        ~/.config/akiflow (source: XDG_CONFIG_HOME)
# apiBaseUrl:       https://api.akiflow.com (source: env AF_API_BASE_URL)
```

## More Information

- **관련 ADR**:
  - [ADR-0003: Akiflow 인증 전략](./ADR-0003-akiflow-authentication-strategy.md) — auth.json은 별도 파일로 분리
  - [ADR-0006: Hexagonal](./ADR-0006-hexagonal-architecture.md) — ConfigPort로 의존성 역전
  - [ADR-0009: 로깅 전략](./ADR-0009-logging-strategy.md) — LOG_LEVEL, LOG_FORMAT 정의
  - [ADR-0013: 캐시 전략](./ADR-0013-local-cache-strategy.md) — AF_CACHE_TTL_SECONDS 활용
- **관련 TASK**:
  - TASK-03 (storage.ts — XDG 기반)
  - TASK-08 (cache.ts — `AF_CACHE_DIR`, `AF_CACHE_TTL_SECONDS`)
  - TASK-18 (cdp.ts — `AF_CDP_PORT`)
  - TASK-22 (docs/CONFIGURATION.md)
- **Fitness Function (제안)**:
  - `af config --show` 출력에 모든 설정 + 소스 표시
  - 민감 정보(refreshToken) 값은 출력에서 마스킹
  - CI: `AF_CONFIG_DIR=/tmp/test` 격리 검증 테스트
- **Revisit Triggers**:
  - Windows 사용자 증가 시 → `%APPDATA%` 매핑 재검토
  - 다중 계정 프로필 요구 시 → `AF_PROFILE=work` 등 도입
  - 설정 항목 20+ 초과 시 → 하위 네임스페이스 분리 (예: `AF_LOG_*`, `AF_CACHE_*`)
