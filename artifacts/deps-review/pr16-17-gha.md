---
title: "PR #16, #17 — GitHub Actions MAJOR bump"
createdAt: 2026-04-17T13:45:00+09:00
updatedAt: 2026-04-17T13:45:00+09:00
version: "1.0.0"
type: report
tags:
  - dependabot
  - github-actions
  - ci
  - breaking-change
---

# PR #16 + #17 — `actions/setup-python@v6`, `actions/checkout@v6` (MAJOR)

## PR Summary
| PR | Action | From → To | Bump |
|----|--------|-----------|------|
| #17 | `actions/checkout` | `v4` → `v6` | MAJOR (v4 → v5 → v6) |
| #16 | `actions/setup-python` | `v5` → `v6` | MAJOR |

두 PR 모두 `.github/workflows/ci.yaml`만 수정. **⚠️ release.yaml은 건드리지 않음** (별도 bump 필요).

## `actions/checkout` v4 → v6 Breaking Changes
출처:
- https://github.com/actions/checkout/releases/tag/v5.0.0 (2025-08-11)
- https://github.com/actions/checkout/releases/tag/v6.0.0 (2025-11-20)

### BREAKING
1. **v5**: Node 20 → Node 24 런타임 전환 (action 내부 JS가 Node 24에서 실행).
   - **최소 GitHub runner 버전: v2.327.1+** 필요.
2. **v6**: Credentials를 별도 파일에 persist (이전엔 git config를 통해 인-repo persist). `persist-credentials: false`로 비활성화 가능.

### 실질 영향
- GitHub-hosted `ubuntu-latest` runner는 현재 v2.3xx 최신 — 자동 충족.
- self-hosted runner 사용 시 runner v2.327.1+ 업그레이드 필요 → **본 프로젝트는 전부 `ubuntu-latest` 사용 (영향 없음)**.
- 사용 옵션: `fetch-depth: 0`, `persist-credentials: false` → v6에서 둘 다 유지됨.

## `actions/setup-python` v5 → v6 Breaking Changes
출처: https://github.com/actions/setup-python/releases/tag/v6.0.0 (2025-09-04)

### BREAKING
1. Node 런타임 v20 → **v24** 전환.
   - 최소 runner v2.327.1+ 필요.

### 비파괴 (참고)
- 새 기능: `pip-version` 입력, `.python-version` 개선 읽기, Pipfile에서 version 파싱.
- 버그 수정: pip 인증/Windows PATH/PyPy python-version 출력 등.

### 실질 영향
- 사용 옵션: `python-version: "3.12"` → v6에서도 동일 동작.
- hosted runner 사용 → 런타임 전환 투명 (영향 없음).

## 전체 Workflow 영향도

### `.github/workflows/ci.yaml` (PR에 포함됨)
| Step | Before | After |
|------|--------|-------|
| `Checkout` in `check` job (L13) | `actions/checkout@v4` | `@v6` |
| `Checkout` in `pre-commit` job (L37) | `actions/checkout@v4` | `@v6` (with `fetch-depth: 0`) |
| `Setup Python` (L42) | `actions/setup-python@v5` | `@v6` (python-version: "3.12") |
| 기타 action | `oven-sh/setup-bun@v2`, `pre-commit/action@v3.0.1` | 미변경 |

### `.github/workflows/release.yaml` (⚠️ PR에 포함 안 됨)
이 파일에서도 다음이 사용되지만 **PR #16/#17 머지 후에도 구버전 그대로 유지**:
| Step | 현재 | 상태 |
|------|------|------|
| `Checkout` in `build-binaries` (L25) | `actions/checkout@v4` | ❌ 미업데이트 |
| `Checkout` in `release` (L57) | `actions/checkout@v4` (with `fetch-depth: 0, persist-credentials: false`) | ❌ 미업데이트 |
| `Setup Node` (L68) | `actions/setup-node@v4` | dependabot이 별도 PR로 올릴 예정 |
| `Upload/Download Artifact` (L40, L79) | `@v4` | dependabot이 별도 PR로 올릴 예정 |

> **dependabot은 PR별로 파일 scope를 좁히는 경향이 있음**. release.yaml 전용 action bump PR은 이번 배치에 없으니, 일관성을 위해 **수동으로 release.yaml의 `actions/checkout@v4`도 v6로 동반 bump** 권장.

## Runner 호환성

| 환경 | runner v2.327.1+ 필요 | 상태 |
|------|----------------------|------|
| GitHub-hosted `ubuntu-latest` | ✅ 자동 충족 | 정상 |
| self-hosted | - | **미사용** |

→ 런타임 측 리스크 없음.

## Risk Level

| PR | Risk | 근거 |
|----|------|------|
| #17 (checkout v4→v6) | 🟢 **Low** | hosted runner, 사용 옵션 호환, release.yaml 잔존 외 구조적 이슈 없음 |
| #16 (setup-python v5→v6) | 🟢 **Low** | Node 24 내부 전환만, `python-version: "3.12"` 동일 작동 |

## Migration 필요 항목

### 필수 (PR 자체)
- 없음. 머지하면 됨.

### 권장 (일관성)
release.yaml의 `actions/checkout@v4`를 v6로 동반 bump:
```diff
 jobs:
   build-binaries:
     ...
     steps:
-      - uses: actions/checkout@v4
+      - uses: actions/checkout@v6
   release:
     ...
     steps:
       - name: Checkout
-        uses: actions/checkout@v4
+        uses: actions/checkout@v6
         with:
           fetch-depth: 0
           persist-credentials: false
```

선택적으로 release.yaml의 `actions/setup-node@v4`도 주의 관찰 (Node 22.14 하한선은 PR #20/#21 migration 참고).

## 권장 액션
✅ **#16, #17 함께 merge** (순서 무관, 동일 파일 ci.yaml만 수정하므로 conflict 가능성 있으나 dependabot이 rebase로 자동 해결).

후속:
- release.yaml checkout bump를 별도 작은 PR로 push (또는 dependabot 다음 주기에 위임).
