---
title: "Task — zod v4 migration (final wave)"
createdAt: 2026-04-17T14:05:00+09:00
updatedAt: 2026-04-20T00:00:00+09:00
version: "2.0.0"
type: spec
tags:
  - zod
  - mcp-sdk
  - migration
  - resolved
  - final-wave
---

# Task: zod v4 Migration (Final Wave)

## Status
✅ **Resolved (2026-04-20)** — `package.json` `overrides.zod: ^4.3.6` 추가로 중복 zod 인스턴스 dedup → MCP SDK(1.29.0)와 zod v4 완벽 호환 확인. tsc / biome / bun test(443 pass) / build 전부 통과.

## Why This Task Existed
초기 판단: "MCP SDK 타입 정의가 zod v4를 지원 안 함" (tsc 24 errors 관측).

**실제 원인 (2026-04-20 재분석)**: `@modelcontextprotocol/sdk`가 zod를 `dependencies` + `peerDependencies`에 **중복 선언**. Bun이 peer dedup 하지 않고 `node_modules/@modelcontextprotocol/sdk/node_modules/zod@3.25.76`을 별도 설치 → 프로젝트 안에 zod 인스턴스 2개 공존 → `AnySchema = z3.ZodTypeAny | z4.$ZodType` 타입이 MCP SDK 로컬 zod@3.25.76에서 resolve → 우리의 zod@4.3.6 값과 nominal mismatch.

해결: `package.json`에 `overrides.zod: ^4.3.6` 추가하면 Bun이 중복 설치를 단일 인스턴스로 dedup.

peer range 허용 ≠ 타입 호환성 ≠ 설치 구조 — 교훈은 `~/.claude/projects/.../memory/feedback_peer_dep_vs_type_compat.md` 갱신됨.

## Blocker Analysis (gating conditions)

이 Task를 해제하려면 다음 셋 중 하나가 충족되어야 한다:

### A. Upstream: MCP SDK 타입 정의 업데이트 대기
- [ ] `@modelcontextprotocol/sdk`의 issue tracker에서 zod v4 타입 호환 이슈 모니터링
  - 검색: https://github.com/modelcontextprotocol/typescript-sdk/issues?q=zod+v4
- [ ] 다음 MCP SDK 릴리스(현재 1.29.0 이후)에서 zod v4 타입 지원 추가 여부 확인
- [ ] 지원 추가 시: `bun add @modelcontextprotocol/sdk@latest zod@^4` → `bun install` → `bun run lint` / `tsc` / `bun test` 통과 확인 후 PR 생성

### B. Pin-around: MCP SDK를 fork 또는 타입 패치
- [ ] `patch-package` 또는 `pnpm.patches`에 상응하는 Bun 패치 메커니즘(`bun patch`)으로 MCP SDK의 `.d.ts` 로컬 수정
- [ ] 단점: 유지보수 부담, SDK 업데이트 시 재적용 필요
- [ ] 권장도: 낮음. A가 늦어질 때만 고려.

### C. Code-side: inputSchema를 zod와 분리
- [ ] MCP `registerTool({ inputSchema })`가 zod가 아닌 JSON Schema 객체를 직접 받게 전환
- [ ] 우리 코드는 zod v4로 업그레이드하되, MCP tool 정의부에서는 `z.object(...).shape` 결과를 JSON Schema로 변환하는 어댑터 레이어 추가
- [ ] 현재 사용 3개 파일(`src/mcp/tools/calendar.ts`, `tasks.ts`, `schedule.ts`)이 전부 zod shape 객체를 `inputSchema`로 넘기므로 영향 큼
- [ ] 권장도: 중. 장기적으로 MCP SDK와 zod major를 decouple할 수 있어 이점 있으나 단기 비용 큼.

## Approach (recommended)

**A 우선** — 3~4주 간격으로 MCP SDK 릴리스 노트 점검, 지원 추가 시 바로 업그레이드.

자동화: GitHub Actions에서 주간 `@modelcontextprotocol/sdk` 릴리스를 체크하여 이슈/PR 자동 생성하는 cron workflow 추가 고려.

## Verification Checklist (2026-04-20 실행 결과)

- [x] `bun add zod@^4` → `zod@4.3.6` 설치
- [x] `package.json` `overrides.zod: ^4.3.6` 추가 → MCP SDK 중복 zod dedup
- [x] `bun install` (clean install) → 단일 `node_modules/zod` 확인
- [x] `bun run lint` (biome) 통과
- [x] `bunx tsc --noEmit -p tsconfig.json` 통과 — 0 errors (기존 24 errors 해소)
- [x] `bun test` 40개 테스트 파일 / 443 pass / 0 fail
- [x] `bun run build` → `dist/index.js` 1.43MB 정상
- [x] `bun run build:darwin-arm64` → native binary 정상 실행
- [x] `af --help` 실기 확인

## References

- Migration guide: https://zod.dev/v4/changelog
- Breaking changes 사전 분석: `artifacts/deps-review/pr22-zod.md`
- MCP SDK repo: https://github.com/modelcontextprotocol/typescript-sdk
- Feedback memory: `~/.claude/projects/-Users-huy-Private-akiflow-toolkit/memory/feedback_peer_dep_vs_type_compat.md`

## Expected Outcome

- zod v4 도입 시 tree-shaking 개선으로 번들 사이즈 감소 가능
- 새로운 API(`z.treeifyError`, `z.strictObject`, top-level format validators)가 필요한 미래 기능에 활용 가능
- 현재는 deferred 상태로 두고, A가 충족될 때 재개
