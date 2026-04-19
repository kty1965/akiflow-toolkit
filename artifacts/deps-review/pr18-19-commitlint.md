---
title: "PR #18, #19 — commitlint v19 → v20"
createdAt: 2026-04-17T13:45:00+09:00
updatedAt: 2026-04-17T13:45:00+09:00
version: "1.0.0"
type: report
tags:
  - dependabot
  - commitlint
  - commit-hook
  - breaking-change
---

# PR #18 + #19 — `@commitlint/cli` + `@commitlint/config-conventional` v19 → v20 (MAJOR)

## PR Summary
| PR | 패키지 | From → To | Bump |
|----|--------|-----------|------|
| #18 | `@commitlint/cli` | `^19.8.1` → `^20.5.0` | MAJOR |
| #19 | `@commitlint/config-conventional` | `^19.8.0` → `^20.5.0` | MAJOR |

둘 다 `devDependencies`. 호출 지점: `bunx --bun commitlint`.

## `@commitlint/*` v19 → v20 Breaking Changes
출처: https://github.com/conventional-changelog/commitlint/releases/tag/v20.0.0 (2025-09-25)

### BREAKING (v20.0.0 하나만)
1. `body-max-line-length` 규칙이 **URL을 포함한 라인에서 최대 길이 검사를 건너뜀** (완화 방향 변경).
   - 기존: URL도 길이 제한 적용 → 긴 URL 포함 시 커밋 실패 가능.
   - 신규: URL이 있으면 해당 라인 무시 → 사용성 개선이지만 "이전보다 규칙이 느슨"해지는 의미에서 major bump.

### v20.1 ~ v20.5 후속 변경 (비파괴)
- v20.3: `.mts` config 파일 지원, `scope-delimiter-style` 규칙 추가
- v20.3: `breaking-change-exclamation-mark` 규칙 추가
- v20.4: 내부 의존성 정리 (chalk→picocolors, lodash 제거 등), `conventional-commits-parser` v6로 업그레이드 — parser 동작 fine-tuning 가능
- v20.5: `--cwd` 검증 추가, async config export 지원 (CJS 프로젝트)

### 잠재적 행동 변화 주의
- v20.4의 **parser 업그레이드(conventional-commits-parser v6)** — scope 파싱/footer 파싱 등 edge case에서 v19와 다르게 해석될 수 있음. 내부 리팩토링 수준이라 일반적 Conventional Commits 메시지엔 영향 없음 (공식적으로 breaking으로 분류하지 않음).
- 일부 `fix(parse)`가 release 시 footer 특수문자 escape 조정 → 기존 통과하던 footer가 다시 검증될 가능성 낮지만 0은 아님.

## 실제 설정 영향도

### 현재 프로젝트 설정
- `commitlint.config.mjs`:
  ```js
  export default { extends: ["@commitlint/config-conventional"] };
  ```
  → extends만 있고 custom rules 없음. v20에서도 포맷 동일.
- `.pre-commit-config.yaml`의 commit-msg hook:
  ```yaml
  - id: commitlint
    entry: bunx --bun commitlint --edit
    stages: [commit-msg]
  ```
  → CLI 호출 인자 `--edit` 유지 (v20에서도 지원).
- `.github/workflows/ci.yaml`의 PR 검증:
  ```bash
  bunx --bun commitlint --from=${{ ... }} --to=${{ ... }}
  ```
  → `--from`/`--to` 인자는 v20에서도 유지.
- `.husky/` **존재하지 않음** — husky 관련 호환성 이슈 **없음** (pre-commit Python 기반 사용 중).

### @modusign/commitlint-preset
- user global 규칙에 언급되나 이 프로젝트 `commitlint.config.mjs`에는 `@commitlint/config-conventional`만 상속 → **영향 없음**.

## Node/Bun 런타임 호환성

| 환경 | commitlint v20 요구 | 현재 |
|------|---------------------|------|
| Node | `v18` / `v20` / `>=22` (v20.0 릴리즈 노트에는 명시 없음; package.json 메타는 `>=v18`) | engines `>=18.0.0` OK |
| Bun | `bunx --bun` 경로로 호출 중 | Bun `>=1.0.0` OK |

- CI(`ubuntu-latest` + `oven-sh/setup-bun@v2 latest`)에서 Bun으로 실행 — commitlint v20도 ESM이라 Bun 최신 LTS에서 정상 resolve.
- pre-commit hook의 `language: system` + `entry: bunx --bun ...` 패턴은 Bun이 PATH에 있는 한 v20에서도 변화 없음.

## Risk Level
**🟢 Low**

근거:
- 유일한 v20.0 breaking change(`body-max-line-length` URL 완화)는 우리 preset(`config-conventional`)에서 기본 비활성 또는 완화 방향 → 기존 통과하던 메시지는 계속 통과.
- custom rule 없음, husky 없음 → config 포맷 변경 영향 제로.
- parser v6 fine-tuning은 실제 커밋 메시지가 spec에 맞는 한 risk negligible (최근 커밋 `feat:`, `ci:`, `chore:` 형태 모두 정상).

## Migration 필요 항목

### 필수
- [x] 두 PR을 **동시 merge** (lockstep) — `@commitlint/cli@20` + `@commitlint/config-conventional@19` 혼용은 `resolve-extends`에서 이론적으로 동작하지만, 공식적으로 major 버전 일치 권장.

### 선택(권장하지 않음)
- custom rule 없으므로 `commitlint.config.mjs` 수정 불필요.

### 검증
- [ ] 머지 후 `bun install --frozen-lockfile`
- [ ] `bunx --bun commitlint --edit` 샘플 메시지로 수동 실행 (이미 PR 검증 CI에서 자동 확인됨)
- [ ] 최근 20개 커밋을 로컬에서 `commitlint --from=HEAD~20 --to=HEAD`로 돌려 false positive 확인 (선택)

## 권장 액션
✅ **두 PR을 함께 merge (순서 무관)** — 가능하면 한 PR에 bundle하는 것이 이상적이지만, dependabot이 별개로 올린 상태. `@dependabot rebase`로 각각 최신화한 후 #18 → #19 연속 merge (또는 반대).
