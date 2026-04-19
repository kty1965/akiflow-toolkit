---
title: "PR #20, #21 — semantic-release plugins MAJOR bump"
createdAt: 2026-04-17T13:45:00+09:00
updatedAt: 2026-04-17T13:45:00+09:00
version: "1.0.0"
type: report
tags:
  - dependabot
  - semantic-release
  - release-workflow
  - breaking-change
---

# PR #20 + #21 — `@semantic-release/npm` v13, `@semantic-release/github` v12 (MAJOR)

## PR Summary
| PR | 패키지 | From → To | Bump |
|----|--------|-----------|------|
| #20 | `@semantic-release/npm` | `^12.0.1` → `^13.1.5` | MAJOR |
| #21 | `@semantic-release/github` | `^11.0.1` → `^12.0.6` | MAJOR |

두 PR 모두 `devDependencies` 변경. `.releaserc.yaml` + `.github/workflows/release.yaml`에만 영향.

## `@semantic-release/npm` v12 → v13 Breaking Changes
출처: https://github.com/semantic-release/npm/releases/tag/v13.0.0 (2025-10-13)

### BREAKING
1. **Node 최소 버전 상승**: `node >= 22.14` 필수. v24.x 사용 시 `>= v24.10`.
2. Node v20, v21, v23 지원 중단 (v22 LTS만 지원).
3. 번들 npm을 v11로 업그레이드.

현재 설정 대비:
- `.releaserc.yaml`에서 `@semantic-release/npm`의 옵션은 `npmPublish: true` 하나뿐 — v13에서도 동일하게 유효.
- workflow(`release.yaml`)의 Node 설정: `actions/setup-node@v4` + `node-version: "22"` → setup-node는 `"22"` 요청 시 22.x LTS 최신(현재 22.11+)을 설치하므로 **22.14+ 자동 충족 여부는 setup-node 캐시/릴리즈 시점에 의존**. 안전을 위해 `"22.14"` 또는 `"lts/*"`로 고정 권장.

## `@semantic-release/github` v11 → v12 Breaking Changes
출처: https://github.com/semantic-release/github/releases/tag/v12.0.0 (2025-10-15)

### BREAKING
1. **Node 최소 버전 상승**: `node >= 22.14` 필수 (동일).
2. Node v20, v21, v23 지원 중단.
3. **GitHub Search API 사용 제거** — 이전엔 실패 이슈 검색 등에 Search API를 썼으나 v12부터 다른 엔드포인트로 이동. rate limit/permissions가 다를 수 있음.

v12.0.1 ~ v12.0.6 후속 fix:
- `@octokit/plugin-paginate-rest` v14 업데이트
- GitHub Enterprise Server 프록시 환경을 위한 undici ProxyAgent 지원
- `make_latest` 속성을 GH release POST/PATCH에 추가 (latest release 제어 버그 수정)
- `failTitle` 인자 관련 버그 수정

현재 설정 대비:
- `.releaserc.yaml`의 `@semantic-release/github` 설정:
  ```yaml
  - "@semantic-release/github"
  - assets:
      - path: dist/af-darwin-arm64, label: "macOS arm64 Binary"
      - path: dist/af-darwin-x64, label: "macOS x64 Binary"
      - path: dist/af-linux-x64, label: "Linux x64 Binary"
      - path: dist/af-linux-arm64, label: "Linux arm64 Binary"
  ```
  `assets` 스키마(`path`, `label`)는 v12에서 변경 없음.
- `successComment`/`failComment`/`failTitle`/`labels`/`releasedLabels` 등 옵션 미사용 → Search API 제거 영향 없음 (이 기능들이 Search API를 썼음).
- `permissions.issues: write`, `pull-requests: write`, `contents: write`, `id-token: write` 이미 부여됨 — v12에서도 동일.

## Peer Dep 호환성 (semantic-release v24 core)

| Plugin | v24 peer 허용 | 확인 |
|--------|--------------|------|
| `@semantic-release/npm` v13 | ✅ v13.x는 `semantic-release >=24.1.0` peer | project는 `^24.2.4` 설치 — 호환 |
| `@semantic-release/github` v12 | ✅ v12.x는 `semantic-release >=24.1.0` peer | 동일 호환 |

semantic-release v24 core 자체는 Node 20.8.1+ 지원 — plugin의 Node 22.14+ 요구가 더 엄격하므로 **실질 하한선은 Node 22.14**.

## 현재 설정 영향도

| 파일 | 변경 필요? | 내용 |
|------|----------|------|
| `.releaserc.yaml` | ❌ | 사용 옵션이 `npmPublish: true`와 `assets`만이라 포맷 동일 |
| `.github/workflows/release.yaml` | ⚠️ 권장 | `node-version: "22"` → `"22.14"`로 고정 (또는 `lts/*`) |
| `package.json` engines | ❌ | 현재 `"node": ">=18.0.0"`이지만 이는 **런타임 소비자**용 — release workflow는 CI에서만 v22 사용하므로 불일치 허용 |

> 참고: 만약 release workflow가 Node 20이나 Node 22.0~22.13에서 실행되면 plugin이 런타임에서 `EBADENGINE` 또는 ESM/API 호환 오류를 낼 수 있다. setup-node@v4의 `"22"` 처리는 **"가장 최신 22.x"**를 설치하므로 현재 시점에서는 안전하지만, 명시적 하한선 지정이 방어적 코딩.

## Risk Level

| PR | Risk | 근거 |
|----|------|------|
| #20 (npm v13) | 🟡 **Low–Med** | Node 22.14+ 하한선만 주의하면 동작. 현재 workflow가 `"22"`로 최신 설치 → 사실상 통과. |
| #21 (github v12) | 🟡 **Low–Med** | 동일 Node 하한선 + Search API 의존 옵션 미사용 → 실질 영향 없음. |

두 PR 모두 실질적 영향은 **Node 22.14 보장**뿐.

## Migration 필요 항목

### 권장 변경 1: release.yaml Node 버전 고정
```diff
  - name: Setup Node.js
    uses: actions/setup-node@v4
    with:
-     node-version: "22"
+     node-version: "22.14"
```
(또는 `node-version: "lts/*"` / `"22.x"` 고정 — 선호에 따라)

### 권장 변경 2: (선택) release.yaml actions/checkout도 v6로 통일
- PR #17은 `ci.yaml`만 bump하고 `release.yaml`의 `actions/checkout@v4`는 남겨둠.
- 릴리스 안정성을 위해 dependabot 다음 주기를 기다리거나 이번에 함께 bump 권장 (별도 PR 또는 #17 수동 확장).

## 권장 액션
✅ **두 PR(#20, #21)은 묶어서 merge** (Node 하한선이 동일, 동시 적용이 안전).

실행 순서:
1. 먼저 `release.yaml`에 Node 22.14+ 고정 커밋 푸시 (안전망).
2. #20, #21을 순서대로 또는 dependabot rebase 후 일괄 merge.
3. 다음 push 시 release workflow가 실제 publish 흐름을 태우는지 smoke test (이미 `bun run scripts/smoke-test` 존재 — 결과 모니터링).
