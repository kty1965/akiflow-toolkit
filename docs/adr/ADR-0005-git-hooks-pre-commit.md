---
title: "ADR-0005: Git 훅 관리 — Python pre-commit"
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
  - git-hooks
  - pre-commit
  - husky
  - commitlint
---

# ADR-0005: Git 훅 관리 — Python pre-commit

## Context and Problem Statement

Conventional Commits 강제(semantic-release 전제, ADR-0004), 린트/포맷 자동 실행, 타입 체크 등을 커밋 시점에 자동화해야 한다. 어떤 Git 훅 관리 도구를 사용할지 결정이 필요하며, 이는 Bun 프로젝트 특성, 팀 전반 표준, 신규 기여자 온보딩 비용에 영향을 미친다.

## Decision Drivers

- **Conventional Commits 강제**: commitlint와 commit-msg stage 통합
- **다국어 훅**: TypeScript(Biome) + 타입 체크(tsc) + 일반 파일 위생(yaml/json)
- **선언적 관리**: 훅 설정이 읽기 쉽고 버전 관리 가능해야 함
- **팀 표준 일치**: 사용자가 `provisions:pre-commit-provision` 스킬을 보유 → Python pre-commit 선호 추정
- **CI 통합 용이성**: GitHub Actions에서 동일 훅 재사용 가능해야 함
- **Bun 프로젝트 특성**: husky는 Node lifecycle script에 의존, Bun도 지원하나 설정이 shell 중심

## Considered Options

1. **Python pre-commit** (pre-commit.com) — 언어 독립적, 선언적 YAML 설정
2. **husky** (v9) — Node.js 생태계 표준
3. **lefthook** — Go 기반 경량 훅 관리자
4. **Git 네이티브 훅 수동 관리** — `.git/hooks/` 직접 작성

## Decision Outcome

**선택: Python pre-commit**

### 이유

- **선언적 설정**: `.pre-commit-config.yaml`로 훅 전체가 한눈에 보임 (husky의 shell 스크립트 대비 가독성 높음)
- **표준 위생 훅 풍부**: `pre-commit/pre-commit-hooks` 저장소에 trailing-whitespace, end-of-file-fixer, check-yaml 등 즉시 사용 가능
- **commit-msg + pre-commit 한 번에**: `default_install_hook_types`로 두 stage 동시 설치
- **CI 통합 표준**: `pre-commit/action@v3.0.1` 공식 GitHub Action으로 로컬 훅과 동일하게 실행
- **사용자 팀 표준 시사**: 사용자 환경에 `provisions:pre-commit-provision` 스킬 존재 → Python pre-commit이 팀 표준일 가능성
- **언어 독립적**: TypeScript, YAML, JSON, Shell 모두 동일 프레임워크로 관리

### Consequences

**Good:**
- 훅 설정이 YAML 한 파일로 집약 → 신규 기여자가 즉시 이해
- `pre-commit autoupdate`로 훅 버전 일괄 업데이트
- 로컬 훅 = CI 훅 → 재현성 보장
- 표준 위생 훅(trailing-whitespace, EOF, check-yaml, merge-conflict 등) 기본 제공
- 훅 실패 시 명확한 에러 메시지
- 프로젝트당 훅 버전 고정 (`.pre-commit-config.yaml`의 `rev`) → 팀 내 재현 가능

**Bad:**
- **M5**: Python + pre-commit 설치 필요 (`brew install pre-commit` 또는 `pip install pre-commit`) → Bun만 설치하면 되는 순수 Node 프로젝트보다 온보딩 한 단계 추가
- CI 워크플로우에 `setup-python` 추가 필요
- pre-commit 자체 캐시가 `~/.cache/pre-commit/`에 생성되어 초기 실행 시 다운로드 시간
- Node-first 생태계의 일부 도구는 local hook으로 래핑 필요 (commitlint, biome, tsc)

## Pros and Cons of the Options

### Python pre-commit (선택)

- Good, because 선언적 YAML 설정 (`.pre-commit-config.yaml`)
- Good, because 표준 위생 훅 기본 제공 (trailing-ws, EOF, check-yaml, large-files 등)
- Good, because commit-msg + pre-commit stage 통합 관리
- Good, because 공식 GitHub Action (`pre-commit/action@v3.0.1`)으로 CI 재현성
- Good, because 사용자 팀 스킬(`provisions:pre-commit-provision`) 존재 → 표준 추정
- Neutral, because Python 의존성 추가 → 개발자 로컬에 설치 필요
- Bad, because Bun 프로젝트에서 별도 언어 런타임(Python) 추가 설치 부담

### husky v9

- Good, because Node 생태계 표준
- Good, because `prepare: husky` script로 `bun install` 시 자동 초기화 가능
- Good, because shell 기반이라 커스터마이징 자유도 높음
- Bad, because 훅 파일(`.husky/commit-msg`)이 shell 스크립트로 분산 → 가독성 낮음
- Bad, because 표준 위생 훅 별도 구현 필요 (pre-commit의 기본 제공 대비)
- Bad, because CI와 로컬 재현성이 shell 스크립트에 의존

### lefthook

- Good, because Go 단일 바이너리, 빠른 실행
- Good, because `lefthook.yml` 선언적 설정
- Neutral, because Evil Martians 유지보수, 커뮤니티 소규모
- Bad, because pre-commit 대비 생태계 작음
- Bad, because 표준 훅 라이브러리 없음 (모두 커스텀)
- Bad, because 사용자 팀 표준 아님

### Git 네이티브 훅

- Good, because 외부 의존성 0
- Bad, because 버전 관리 불가 (`.git/hooks/`는 git에 포함 안 됨)
- Bad, because 팀 공유 어려움 (심볼릭 링크/커스텀 스크립트 필요)
- Bad, because 복잡도 증가 시 유지보수 어려움

## More Information

- **관련 ADR**: [ADR-0004](./ADR-0004-release-automation-semantic-release.md) (commitlint + Conventional Commits는 semantic-release의 전제)
- **관련 TASK**: TASK-01 (`.pre-commit-config.yaml` + `commitlint.config.mjs`), TASK-20 (CI에 setup-python + pre-commit/action 통합), TASK-22 (docs/CONTRIBUTING.md의 설치 가이드)
- **해결하는 정합성 이슈**: M5 (pre-commit Python 의존성 → README에 설치 가이드 명시로 대응)
- **훅 구성 요약**:
  ```yaml
  default_install_hook_types: [pre-commit, commit-msg]
  repos:
    # 표준 위생 (pre-commit/pre-commit-hooks v5.0.0)
    - trailing-whitespace, end-of-file-fixer, check-yaml, check-json,
      check-merge-conflict, check-added-large-files, mixed-line-ending
    # Local hooks
    - commitlint (commit-msg): bunx --bun commitlint --edit
    - biome-check (pre-commit): bunx biome check --write
    - tsc (pre-commit): bunx tsc --noEmit
  ```
- **Fitness Function (제안)**:
  - `pre-commit run --all-files` CI 통과율 100%
  - Conventional Commits 위반 커밋이 main에 도달하는 비율 0% (commit-msg 훅 + CI 재검증)
  - 신규 기여자가 `pre-commit install --install-hooks` 1회 실행으로 훅 활성화
- **레퍼런스**:
  - [pre-commit.com](https://pre-commit.com)
  - [pre-commit GitHub Action](https://github.com/pre-commit/action)
  - [pre-commit/pre-commit-hooks (standard hooks)](https://github.com/pre-commit/pre-commit-hooks)
- **Revisit Triggers**:
  - 팀이 Python을 더 이상 사용하지 않는 방향으로 정리될 때 → lefthook(Go 단일 바이너리) 재검토
  - pre-commit이 주요 브레이킹 체인지 발생 시
  - Bun이 네이티브 Git 훅 관리자를 출시 시
