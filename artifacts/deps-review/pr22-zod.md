---
title: "PR #22 — zod v3 → v4 영향 분석"
createdAt: 2026-04-17T13:45:00+09:00
updatedAt: 2026-04-17T13:45:00+09:00
version: "1.0.0"
type: report
tags:
  - dependabot
  - zod
  - migration
  - breaking-change
---

# PR #22 — `zod` 3.25.76 → 4.3.6 (MAJOR)

## PR Summary
| 항목 | 값 |
|------|----|
| 패키지 | `zod` |
| 범위 | `dependencies` (런타임 번들) |
| From → To | `^3.24.4` (installed 3.25.76) → `^4.3.6` |
| Bump | **MAJOR** (v3 → v4) |
| 변경 파일 | `package.json` 1 line |

## Breaking Changes (공식 migration guide 근거)
출처: https://zod.dev/v4/changelog

### 1) Error customization
- `message` param deprecated → `error` param 권장 (하위호환 유지)
- `invalid_type_error`, `required_error` 제거

### 2) ZodError 구조 변경
- 이슈 타입 일부 병합: `ZodInvalidTypeIssue` → `$ZodIssueInvalidType`
- `.format()`, `.flatten()` deprecated → `z.treeifyError()` 권장
- `.addIssue()` / `.addIssues()` deprecated → `err.issues.push()` 직접 사용

### 3) `z.string()` format 메서드 relocation
- `.email()`, `.uuid()`, `.url()`, `.base64()`, `.ipv4/6()`, `.cidrv4/6()` → 최상위 함수로 분리 (`z.email()`, `z.uuid()` ...)
- `.ip()`, `.cidr()` 제거 → `z.ipv4()/z.ipv6()` / `z.cidrv4()/z.cidrv6()`로 분리
- UUID는 RFC 9562 엄격 검증 → 과거처럼 permissive가 필요하면 `z.guid()`

### 4) `z.object()` 변경
- `.strict()`, `.passthrough()` deprecated → `z.strictObject()`, `z.looseObject()` 권장
- `.merge()` deprecated → `.extend()` 권장
- `.deepPartial()` 제거, `.nonstrict()` 제거
- `z.unknown()` / `z.any()`는 더 이상 key-optional 아님

### 5) `z.enum()` / `z.nativeEnum()`
- `z.nativeEnum()` deprecated → `z.enum()`이 enum-like 입력 직접 수용
- `.Enum`, `.Values` alias 제거 → `.enum`만

### 6) Numbers
- `Infinity` / `-Infinity` 무효화
- `.safe()`가 `.int()`와 동일 동작 (floats 거부)

### 7) Arrays
- `z.array().nonempty()`가 `.min(1)`과 동일 동작; 반환 타입이 tuple(`[T, ...T[]]`) 아닌 `T[]`로 변경

### 8) `z.record()`
- 단일 인자 사용 제거 — key/value 두 schema 모두 요구
- enum key는 exhaustive → 부분 허용하려면 `z.partialRecord()`

### 9) `z.function()` / `z.promise()` 재설계
- `z.function()`은 더 이상 schema 아님 — `input`/`output` 정의 후 `.implement()`/`.implementAsync()`
- `z.promise()` 완전 deprecated

### 10) `.refine()` / `.transform()`
- 타입 predicate가 타입 narrowing 안 함
- `ctx.path` 제거 (성능 최적화)
- `.refine()`의 두 번째 인자(에러 메시지 함수 overload) 제거

### 11) 내부 구조
- Generic: `ZodType<Output, Def, Input>` → `ZodType<Output, Input>`
- `._def` → `._zod.def`
- `ZodEffects` 제거 (refinement가 스키마에 직접 내장)

## 실제 코드 영향도

사용처 3개 파일에서 호출되는 API를 breaking change와 교차 검증:

| 사용 API | 호출 위치 | v4 호환 | 비고 |
|---------|----------|---------|------|
| `z.string()` | tasks.ts:50, 53, 102, 151, 158, 215, 218, 224, 291; calendar.ts:55; schedule.ts:39, 40, 41 | ✅ | 그대로 호환 |
| `.regex(re, msg)` | 동일 위치 다수 | ✅ | `msg`가 string이라 `error` 마이그레이션 불필요 (하위호환) |
| `.min(n)` | tasks.ts:102, 151, 215, 291; schedule.ts:39 | ✅ | 인자 1개, 메시지 없음 |
| `.optional()` | 다수 | ✅ | 유지 |
| `.nullable()` | tasks.ts:221, 227 | ✅ | 유지 |
| `.describe()` | 다수 | ✅ | 유지 |
| `.max(n)` | calendar.ts:59 | ✅ | 유지 |
| `z.number().int().positive()` | tasks.ts:162 | ✅ | `.int()` 유지. `.safe()` 미사용이라 영향 없음 |
| `z.number().int().min().max()` | calendar.ts:59 | ✅ | 유지 |
| `z.enum([...])` (string enum) | tasks.ts:56 | ✅ | 유지 (v4 공식 권장) |

**미사용 (breaking 영향 없음):**
- `z.string().email/.uuid/.url/.ip/.cidr` — 전부 미사용
- `.transform()` / `.refine()` — 미사용
- `z.record()` / `z.function()` / `z.promise()` — 미사용
- `z.object().strict/.passthrough/.merge/.deepPartial` — 미사용 (inputSchema는 shape 객체 전달만 하며 MCP SDK가 내부적으로 z.object로 래핑)
- `ZodError`, `.format()`, `.flatten()`, `.addIssue()` — 미사용
- `z.nativeEnum()` — 미사용 (string enum만 씀)

## Peer Dep 충돌 가능성

`node_modules/@modelcontextprotocol/sdk/package.json` 확인:
```json
"zod": "^3.25 || ^4.0"   // dependencies + peerDependencies 동시에
```
- **MCP SDK 1.29.0은 이미 zod v3.25~v4.x 양쪽 지원** — v4.3.6으로 bump해도 peer 충돌 없음.
- `chrono-node`, `citty`, `rrule` 등 나머지 런타임 dep는 zod 미사용 확인.

## Risk Level
**🟢 Low**

근거:
- 사용 API가 모두 v4에서 변경 없이 작동하는 원시 검증자들 (regex/min/max/optional/nullable/enum/describe)
- v4의 주요 breaking change 영역(`ZodError`, `transform/refine`, `z.function/record`, string format 메서드)은 모두 미사용
- 가장 큰 위험원이던 peer dep는 MCP SDK가 선제적으로 `^3.25 || ^4.0` 지원

## Migration 체크리스트
- [x] peer dep 확인 (pass)
- [x] breaking API 교차 점검 (모두 미사용)
- [ ] 머지 후 검증:
  - `bun install --frozen-lockfile`
  - `bun test` (39개 테스트 파일) — 스키마 파싱/inputSchema 정상 동작 확인
  - `bun run lint` — 타입 에러 없음 확인
  - `bun run build` — dist 빌드 성공
- [ ] MCP 서버 smoke test — `registerTool`의 inputSchema가 v4에서도 그대로 수용되는지 (MCP SDK 1.29가 이미 지원하므로 pass 예상)

## 권장 액션
✅ **Merge as-is (단, CI 통과 후)**

- 코드 변경 불필요
- engines(`node >=18.0.0`, `bun >=1.0.0`)는 zod v4의 런타임 요건과 호환
- 번들 사이즈 영향: v4가 tree-shakable하여 **감소 가능성 높음** (직접 측정 권장 — `bun run build` 후 dist 크기 비교)
