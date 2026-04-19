---
title: "Task — zod v4 migration (final wave)"
createdAt: 2026-04-17T14:05:00+09:00
updatedAt: 2026-04-17T14:05:00+09:00
version: "1.0.0"
type: spec
tags:
  - zod
  - mcp-sdk
  - migration
  - deferred
  - final-wave
---

# Task: zod v4 Migration (Final Wave)

## Status
🔴 **Deferred** — PR #38 머지 후 `fix: pin zod to v3 for MCP SDK type compatibility` (commit 192ebfc)로 v3로 되돌림. `package.json`: `"zod": "^3.24.4"` 유지.

## Why This Task Exists
`@modelcontextprotocol/sdk@1.29.0`의 `peerDependencies.zod`는 `"^3.25 || ^4.0"`로 양쪽 major를 수용한다고 선언했지만, **실제 TypeScript 타입 정의는 zod v4의 재구조화된 타입(`ZodType<Output, Input>`, `_def` → `_zod.def`, `ZodError` issue shape 등)과 호환되지 않아** tsc 검증이 실패한다.

peer range 허용 ≠ 타입 호환성 — 이 교훈은 `~/.claude/projects/.../memory/feedback_peer_dep_vs_type_compat.md`에 기록됨.

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

## Verification Checklist (when unblocked)

- [ ] `bun add zod@^4 @modelcontextprotocol/sdk@<compatible-version>`
- [ ] `bun install` → lockfile 업데이트 확인
- [ ] `bun run lint` (biome) 통과
- [ ] `bunx tsc --noEmit -p tsconfig.json` 통과 **⭐ 필수**
- [ ] `bun test` 39개 테스트 파일 통과
- [ ] `bun run build` 성공 (dist, 4개 플랫폼 binary)
- [ ] MCP stdio 서버 smoke test (`scripts/smoke-test.ts` 또는 수동)
- [ ] inputSchema validation: 각 도구(get_events, get_tasks, search_tasks, create_task, update_task, complete_task, schedule_task, unschedule_task)에 샘플 invocation → error 없음 확인

## References

- Migration guide: https://zod.dev/v4/changelog
- Breaking changes 사전 분석: `artifacts/deps-review/pr22-zod.md`
- MCP SDK repo: https://github.com/modelcontextprotocol/typescript-sdk
- Feedback memory: `~/.claude/projects/-Users-huy-Private-akiflow-toolkit/memory/feedback_peer_dep_vs_type_compat.md`

## Expected Outcome

- zod v4 도입 시 tree-shaking 개선으로 번들 사이즈 감소 가능
- 새로운 API(`z.treeifyError`, `z.strictObject`, top-level format validators)가 필요한 미래 기능에 활용 가능
- 현재는 deferred 상태로 두고, A가 충족될 때 재개
