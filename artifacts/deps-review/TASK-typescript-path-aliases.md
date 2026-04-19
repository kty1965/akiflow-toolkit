---
title: "Task — TypeScript root-based path aliases (@core, @adapters, @mcp, @cli)"
createdAt: 2026-04-19T22:55:00+09:00
updatedAt: 2026-04-19T22:55:00+09:00
version: "1.0.0"
type: spec
tags:
  - typescript
  - refactor
  - dx
  - tsconfig
  - hexagonal
---

# Task: Root-based TypeScript Path Aliases

## Status
🟡 **Open** — 단일 PR로 처리 가능한 순수 refactor. 로직 변경 없음.

## Problem

`src/` 트리가 Hexagonal 4계층(`core/`, `adapters/`, `mcp/`, `cli/`)으로 나뉘어 있어 교차 레이어 import가 빈번한데, 현재는 전부 상대 경로라 **3~4단계 `../` 체인이 108건**:

```ts
// src/mcp/tools/tasks.ts
import type { LoggerPort } from "../../../core/ports/logger-port.ts";
import type { Task, TaskQueryOptions } from "../../../core/types.ts";
import { AkiflowError } from "../../../core/errors/index.ts";
```

### 측정값 (2026-04-19 기준)

```
3+ level deep imports:  108 건
영향 파일:                33 개
```

가장 빈번한 대상:
| 건수 | 경로 |
|------|------|
| 21 | `../../../core/types.ts` |
| 20 | `../../../core/ports/logger-port.ts` |
| 17 | `../../../core/errors/index.ts` |
| 5 | `../../../core/services/task-command-service.ts` |
| 4 | `../../../core/ports/storage-port.ts` |
| 3 | `../../../core/services/auth-service.ts` |
| 3 | `../../../core/ports/cache-port.ts` |
| 2 | `../../../core/ports/akiflow-http-port.ts` |
| 1 | `../../../mcp/tools/tasks.ts` |
| 1 | `../../../mcp/tools/schedule.ts` |

### 문제점

1. **가독성 저하**: `../../../` 체인이 파일 위치에 의존해 **코드를 이동하면 경로가 바뀜**
2. **레이어 인식 약화**: 상대 경로는 "어느 레이어에 있는 무엇"인지 드러내지 못함 → ADR-0006 Hexagonal 경계가 import에 반영되지 않음
3. **리팩토링 마찰**: 파일 이동 시 다수 파일의 import 수정 필요
4. **초심자 onboarding 부담**: 새 기여자가 `../../../` 체인을 읽어서 구조 파악해야 함

## Decision Drivers

- **ADR-0006 Hexagonal**과 정합 — 도메인 경계가 import에도 명시됨
- **Bun + tsc + biome + 빌드 4개 도구 호환** 필수
- **자동화 가능한 migration** — 수작업 최소화
- **최소 블라스트 radius** — 순수 refactor, 테스트 무변경

## Options

### A. 단일 alias `@/*` → `src/*`

```jsonc
// tsconfig.json
"baseUrl": ".",
"paths": { "@/*": ["./src/*"] }
```

**장점**: 설정 최소. 패턴 단순 (`@/core/ports/logger-port.ts`).
**단점**: 레이어 semantic이 alias 이름에 없음. `@/core`나 `@/adapters` 구분은 여전히 경로 깊이로만.

### B. 레이어별 alias (권장)

```jsonc
"paths": {
  "@core/*":     ["./src/core/*"],
  "@adapters/*": ["./src/adapters/*"],
  "@mcp/*":      ["./src/mcp/*"],
  "@cli/*":      ["./src/cli/*"],
  "@config":     ["./src/config.ts"],
  "@composition":["./src/composition.ts"]
}
```

**장점**:
- Import 한 줄에 "무슨 레이어의 무엇"이 명시됨 → Hexagonal 자체 문서화
- 같은 레이어 내부 import는 기존 상대경로 유지 (응집성 강화)
- Cross-layer만 alias → 레이어 경계가 import 패턴으로 드러남
- 실수 방지: `@core`가 `@adapters`를 import하려 하면 (Hexagonal 규칙 위반) 눈에 띔

**단점**: 설정 라인 4~6개 추가. 초기 migration diff 큼.

### C. 절대 경로만 (`src/core/ports/logger-port.ts`)

`baseUrl: "."`만 설정. 상대 경로를 `src/core/...`로 대체.
**단점**: `@` prefix 없어 외부 패키지와 혼동 가능 (`bun-types` 등). Bun/Node 해석 미묘.

## Recommended

**Option B** — 레이어별 alias. ADR-0006 Hexagonal와 정합, 자체 문서화, Cross-layer 위반 탐지 쉬움.

## Compatibility Check

| 도구 | 지원 여부 | 비고 |
|------|----------|------|
| **tsc `--noEmit`** | ✅ | `baseUrl` + `paths` 표준 TypeScript 기능 |
| **Bun runtime** (`bun run`) | ✅ | Bun 1.x 이후 tsconfig paths 네이티브 지원 |
| **Bun test** (`bun test`) | ✅ | 동일 resolver 사용 |
| **Bun build** (`bun build src/index.ts`) | ✅ | Bundle 시 alias 자동 해석 |
| **Bun compile** (`--compile --minify`) | ✅ | Linux/macOS 4개 플랫폼 binary에서도 paths 보존 |
| **Biome v2** | ✅ | `organizeImports`가 `@` prefix를 local group으로 처리. `biome.json`에 별도 설정 불필요 |
| **IDE** (VSCode/JetBrains) | ✅ | tsconfig paths 자동 로드 — jump-to-definition 그대로 동작 |
| **allowImportingTsExtensions: true** | ✅ | alias 경로에도 `.ts` 확장자 유지 (`@core/ports/logger-port.ts`) |

### 위험 영역 (미리 점검)

- `scripts/` 디렉토리는 `src/` 외부이므로 paths 대상 아님 — 상대경로 유지 또는 별도 `compilerOptions.paths` 범위 확장
- `bun build:binary` 4개 플랫폼 (`darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`)에서도 alias 해석 확인 필요 (smoke test 권장)

## Migration Plan

### Step 1 — tsconfig 업데이트
```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "rootDir": "./src",
    "baseUrl": ".",
    "paths": {
      "@core/*":      ["./src/core/*"],
      "@adapters/*":  ["./src/adapters/*"],
      "@mcp/*":       ["./src/mcp/*"],
      "@cli/*":       ["./src/cli/*"],
      "@config":      ["./src/config.ts"],
      "@composition": ["./src/composition.ts"]
    },
    "types": ["bun"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
}
```

### Step 2 — Codemod (자동 import 재작성)

간단한 Bun 스크립트 `scripts/rewrite-imports.ts` 작성:

```ts
#!/usr/bin/env bun
import { Glob } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
import { relative, dirname, resolve } from "node:path";

const SRC_ROOT = resolve("src");
const LAYER_ALIAS: Record<string, string> = {
  "core":     "@core",
  "adapters": "@adapters",
  "mcp":      "@mcp",
  "cli":      "@cli",
};
const FILE_ALIAS: Record<string, string> = {
  "config.ts":      "@config",
  "composition.ts": "@composition",
};

const IMPORT_RE = /(from\s+["'])((?:\.\.\/)+[^"']+)(["'])/g;

for await (const path of new Glob("src/**/*.ts").scan(".")) {
  const absFile = resolve(path);
  const dir = dirname(absFile);
  const src = readFileSync(absFile, "utf-8");
  const next = src.replace(IMPORT_RE, (_m, p1, spec, p3) => {
    const absTarget = resolve(dir, spec);
    const rel = relative(SRC_ROOT, absTarget);
    if (rel.startsWith("..")) return `${p1}${spec}${p3}`;          // outside src

    // Single-file aliases first
    for (const [file, alias] of Object.entries(FILE_ALIAS)) {
      if (rel === file) return `${p1}${alias}${p3}`;
    }
    // Layer aliases
    const [layer, ...rest] = rel.split("/");
    const alias = LAYER_ALIAS[layer];
    if (!alias) return `${p1}${spec}${p3}`;

    // Same-layer imports stay relative (cohesion)
    const sourceRel = relative(SRC_ROOT, absFile);
    const [sourceLayer] = sourceRel.split("/");
    if (sourceLayer === layer) return `${p1}${spec}${p3}`;

    return `${p1}${alias}/${rest.join("/")}${p3}`;
  });
  if (next !== src) writeFileSync(absFile, next);
}
```

이 codemod는:
- 상대 경로만 대상 (이미 alias인 것은 건드리지 않음)
- `src/` 외부 참조는 건너뜀
- **같은 레이어 내부 import는 상대 경로 유지** (응집성)
- cross-layer만 alias 적용 (경계 명시)

### Step 3 — 실행 & 검증

```bash
bun run scripts/rewrite-imports.ts
bunx tsc --noEmit -p tsconfig.json   # 타입 체크
bun test                              # 전 테스트
bunx @biomejs/biome check --write src/   # import sorting 재정렬
bun run build                         # dist 빌드
bun run build:linux-x64               # 4 플랫폼 중 1개 컴파일 확인
```

### Step 4 — Biome import 그룹 정렬 (선택)

Biome v2의 `assist.actions.source.organizeImports: "on"`이 기본값. 별도 설정 없이:
- 외부 패키지 (`@modelcontextprotocol/sdk`, `citty`, `zod`) 그룹
- `@core/`, `@adapters/` 등 alias 그룹
- 상대 경로 (`./`, `../`) 그룹

을 자동 정렬. 필요 시 `biome.json`에 group 명시 가능.

## Test Plan

### 단위 검증
- [ ] `bunx tsc --noEmit -p tsconfig.json` — paths 해석 확인
- [ ] `bun test` — 407 tests 전체 green (회귀 0)
- [ ] sample file 5개 열어 import 가독성 개선 육안 확인

### 통합 검증
- [ ] `bun run build` — dist 빌드 성공
- [ ] `bun run build:linux-x64` — 컴파일된 바이너리 smoke (`./dist/af-linux-x64 --help`)
- [ ] `bun run scripts/mcp-live-demo.ts` — Tier 2 E2E 재통과

### 회귀 방지
- [ ] `.github/workflows/ci.yaml`이 `bun test` + `bun run build` 돌고 있으므로 CI로 자동 검증됨

## Rollback

`git revert <commit>` 한 번으로 완전 복원 가능 (순수 text diff + tsconfig 설정 변경). 런타임 의존성 무변경.

## Related

- ADR-0006 Hexagonal Architecture — alias가 경계를 import 레벨에서 강화
- ADR-0011 Composition root (`src/composition.ts` → `@composition`)
- `biome.json` — `assist.actions.source.organizeImports` 활용
- `package.json` scripts — `build`, `build:binary`, `test`, `lint`

## Effort Estimate

- 1~2 시간 (codemod 작성 + 실행 + 검증)
- 리뷰 부담: diff 크지만 패턴 단일 → skim review로 충분
