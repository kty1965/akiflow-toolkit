---
title: "ADR-0004: 릴리즈 자동화 — semantic-release"
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
  - release
  - semver
  - semantic-release
  - automation
---

# ADR-0004: 릴리즈 자동화 — semantic-release

## Context and Problem Statement

버전 결정, CHANGELOG 생성, npm 퍼블리시, GitHub Release 생성, git 태깅을 자동화해야 한다. 수동 `npm version patch && git push --tags` 방식은 휴먼 에러, 버전 스킵, CHANGELOG 누락 위험이 있다. 사용자 팀 CLAUDE.md에 이미 "Conventional Commits + Semantic Release 자동화" 표준이 명시되어 있다.

## Decision Drivers

- **Conventional Commits 강제**: 커밋 메시지 기반 자동 버전 결정
- **CHANGELOG 자동 생성**: 수동 관리 배제
- **GitHub Release + 바이너리 첨부**: Bun 컴파일 바이너리 4종 업로드 필요
- **멀티 채널**: main(stable), beta, next(pre-release) 병행
- **사용자 팀 표준**: CLAUDE.md에 semantic-release 명시
- **Bun 프로젝트와의 공존**: 프로젝트 자체는 Bun, 릴리즈 도구는 Node 기반 가능한가
- **OIDC 지원**: npm provenance, NPM_TOKEN 없이 trusted publishing 가능한가

## Considered Options

1. **semantic-release v25** — 완전 자동, Conventional Commits 필수
2. **release-please** (Google) — 반자동, 릴리즈 PR 리뷰 단계
3. **changesets** (pnpm 생태계) — 수동 changeset 선언
4. **수동 관리** — `npm version` + 수동 CHANGELOG + 수동 GitHub Release

## Decision Outcome

**선택: semantic-release v25**

### 이유

- 사용자 CLAUDE.md에 "Semantic Release 워크플로우를 자동화" 표준 명시 → 정확히 부합
- main push = 자동 릴리즈 → 수동 개입 **0회**
- Bun 프로젝트와 완전 호환 (CI에서 setup-bun + setup-node 병행, 업계 표준 패턴)
- `@semantic-release/github`로 Bun 컴파일 바이너리를 Release asset으로 자동 업로드
- OIDC trusted publishing 지원 (v25+) → NPM_TOKEN 없이 `id-token: write` 권한으로 배포 가능
- 주간 다운로드 약 207만 → 압도적 생태계

### Consequences

**Good:**
- 개발자는 `feat:`/`fix:` 커밋만 신경쓰면 됨 → 실수 방지
- CHANGELOG.md가 항상 최신 상태 유지
- 버전 스킵 불가 (커밋 기반 자동 계산)
- beta/next 채널로 pre-release 관리 자동화
- OIDC publishing으로 credential 유출 위험 감소

**Bad:**
- **M4**: semantic-release v25는 Node 22.14+ 요구 → GitHub Actions에 setup-bun + **setup-node** 동시 사용 필수
- `setup-node`의 `registry-url` 설정 금지 (semantic-release 인증과 충돌)
- Conventional Commits 위반 시 릴리즈가 안 됨 → 교육/린팅 필수 (→ ADR-0005로 해결)
- plugins 순서 민감 (`@semantic-release/git`은 반드시 마지막)
- 초기 설정 복잡도 높음 (`.releaserc.yaml` + 5개 플러그인)

## Pros and Cons of the Options

### semantic-release v25 (선택)

- Good, because main push = 자동 릴리즈 (휴먼 개입 0)
- Good, because 사용자 팀 표준과 일치 (CLAUDE.md)
- Good, because Bun 컴파일 바이너리를 GitHub Release에 자동 업로드 (`@semantic-release/github.assets`)
- Good, because OIDC trusted publishing 지원 (v25+) — NPM_TOKEN 불필요
- Good, because npm provenance 서명 자동 (공급망 보안)
- Good, because beta/next pre-release 채널 네이티브 지원
- Neutral, because Node 기반 도구지만 Bun 프로젝트와 CI 분리하여 공존 가능
- Bad, because plugins 순서 민감도 높음
- Bad, because Conventional Commits 위반 시 릴리즈 누락 가능 (→ commitlint로 차단 필수)

### release-please

- Good, because 릴리즈 PR로 검토 단계 제공
- Good, because Google 유지보수, 모노레포 네이티브 지원
- Neutral, because 릴리즈 전 PR 리뷰로 한 단계 증가
- Bad, because 완전 자동화 대비 단계 추가 (사용자 팀 기대와 상이)
- Bad, because 커뮤니티 규모는 semantic-release보다 작음

### changesets

- Good, because 커밋 메시지와 버전을 분리 (세밀한 제어)
- Good, because 모노레포 네이티브 지원 (pnpm 생태계 표준)
- Bad, because 개발자가 매 PR마다 `changeset add` 수동 실행 필요
- Bad, because 단일 패키지 프로젝트에는 오버엔지니어링
- Bad, because Conventional Commits 강제가 기본 X (별도 도구 필요)

### 수동 관리

- Good, because 학습 곡선 제로
- Bad, because 버전 스킵/오타/누락 위험
- Bad, because CHANGELOG 갱신 잊기 쉬움
- Bad, because 사용자 팀 표준 미준수
- Bad, because 반복 작업 (릴리즈마다 수 분 소요)

## More Information

- **관련 ADR**: [ADR-0001](./ADR-0001-runtime-selection-bun.md) (Bun 프로젝트에서 Node 도구 공존), [ADR-0005](./ADR-0005-git-hooks-pre-commit.md) (Conventional Commits 강제 = pre-commit + commitlint)
- **관련 TASK**: TASK-01 (`.releaserc.yaml` 설정), TASK-20 (GitHub Actions release.yaml)
- **해결하는 정합성 이슈**: M4 (Node 22+ 요구, registry-url 충돌)
- **Fitness Function (제안)**:
  - main 브랜치 push 시 100% 자동 릴리즈 트리거 (feat/fix가 있을 경우)
  - 릴리즈 실패율 < 1% (semantic-release dry-run CI에서 검증)
  - CHANGELOG.md와 npm publish 버전 100% 일치
- **설정 요약**:
  ```yaml
  # .releaserc.yaml (간략)
  branches: [main, {name: beta, prerelease: true}, {name: next, prerelease: true}]
  plugins:
    - commit-analyzer
    - release-notes-generator
    - changelog
    - npm
    - github (with binary assets)
    - git (MUST be last)
  ```
- **레퍼런스**:
  - [semantic-release v25](https://github.com/semantic-release/semantic-release)
  - [Bun runtime 지원 이슈 #3527 (not planned, CI 분리 권장)](https://github.com/semantic-release/semantic-release/issues/3527)
  - [사용자 CLAUDE.md 10-git-commit.md](file:///Users/huy/.claude/10-git-commit.md)
- **Revisit Triggers**:
  - 프로젝트가 모노레포로 전환될 때 → changesets 또는 semantic-release-monorepo 검토
  - release-please가 Google 공식 표준으로 확대되고 단일 패키지 지원 개선 시
  - semantic-release v26+ 메이저 변경 시
