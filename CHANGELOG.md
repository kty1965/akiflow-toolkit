# [1.1.0](https://github.com/kty1965/akiflow-toolkit/compare/v1.0.5...v1.1.0) (2026-04-20)


### Features

* **deps:** migrate to zod v4 via overrides dedup ([#52](https://github.com/kty1965/akiflow-toolkit/issues/52)) ([41c44bb](https://github.com/kty1965/akiflow-toolkit/commit/41c44bb6fdae81ee5f06be5867cc965b2e10e644))

## [1.0.5](https://github.com/kty1965/akiflow-toolkit/compare/v1.0.4...v1.0.5) (2026-04-19)


### Bug Fixes

* **runtime:** switch to bun-only distribution ([#50](https://github.com/kty1965/akiflow-toolkit/issues/50)) ([74fcf28](https://github.com/kty1965/akiflow-toolkit/commit/74fcf286070c19a75f293858ef9ee2f131854297))

## [1.0.4](https://github.com/kty1965/akiflow-toolkit/compare/v1.0.3...v1.0.4) (2026-04-19)


### Bug Fixes

* **release:** revert oidc trusted publishing ([#49](https://github.com/kty1965/akiflow-toolkit/issues/49)) ([db6f4ae](https://github.com/kty1965/akiflow-toolkit/commit/db6f4ae9edbe4097335ec1bc41a3f8479c2c0cca))
* **release:** switch to npm OIDC trusted publishing ([#48](https://github.com/kty1965/akiflow-toolkit/issues/48)) ([39eac79](https://github.com/kty1965/akiflow-toolkit/commit/39eac79d3651c703de8dace8bcdb398fe45f01d4))

## [1.0.3](https://github.com/kty1965/akiflow-toolkit/compare/v1.0.2...v1.0.3) (2026-04-19)


### Bug Fixes

* **release:** trigger v1.0.3 publish after npm 2fa adjustment ([#47](https://github.com/kty1965/akiflow-toolkit/issues/47)) ([502dd81](https://github.com/kty1965/akiflow-toolkit/commit/502dd811aaa648c02dae0f1a3494eb9d06c182c4))

## [1.0.2](https://github.com/kty1965/akiflow-toolkit/compare/v1.0.1...v1.0.2) (2026-04-19)


### Bug Fixes

* **release:** republish to npm after token scope correction ([#46](https://github.com/kty1965/akiflow-toolkit/issues/46)) ([c28d100](https://github.com/kty1965/akiflow-toolkit/commit/c28d100e2c97ba00c0831dc14e650defce845878))

## [1.0.1](https://github.com/kty1965/akiflow-toolkit/compare/v1.0.0...v1.0.1) (2026-04-19)


### Bug Fixes

* **release:** normalize repository url for semantic-release github plugin ([#44](https://github.com/kty1965/akiflow-toolkit/issues/44)) ([7a0e5e3](https://github.com/kty1965/akiflow-toolkit/commit/7a0e5e33a982ad38c8a3b230e8c3d317a987945f))

# 1.0.0 (2026-04-19)


### Bug Fixes

* add tsc pre-commit hook, refresh mutex, and cache-integrated sync ([#30](https://github.com/kty1965/akiflow-toolkit/issues/30)) ([d7acf1b](https://github.com/kty1965/akiflow-toolkit/commit/d7acf1b3e0c02700a46a4479b254c45592c7d0ad))
* **ci:** sync bun.lock with commitlint/cli@20 and switch dependabot to bun ecosystem ([#31](https://github.com/kty1965/akiflow-toolkit/issues/31)) ([4e82f6f](https://github.com/kty1965/akiflow-toolkit/commit/4e82f6f22f6f943cbd86070d56ed3807351c9c02)), closes [#18](https://github.com/kty1965/akiflow-toolkit/issues/18)
* **publish:** make first npm publish actually runnable ([#43](https://github.com/kty1965/akiflow-toolkit/issues/43)) ([802cd71](https://github.com/kty1965/akiflow-toolkit/commit/802cd71cda3fbd5cd58c1cb23a7c1b584a27edbf)), closes [#1](https://github.com/kty1965/akiflow-toolkit/issues/1) [#2](https://github.com/kty1965/akiflow-toolkit/issues/2)


### Features

* **api:** add HTTP adapter and CQRS TaskQuery/TaskCommand services ([#7](https://github.com/kty1965/akiflow-toolkit/issues/7)) ([225c45b](https://github.com/kty1965/akiflow-toolkit/commit/225c45b7994017c38e1f6efc58db62ca833d6150))
* **auth:** add 3-tier recovery integration and Safari cookie parser ([#26](https://github.com/kty1965/akiflow-toolkit/issues/26)) ([b7142d9](https://github.com/kty1965/akiflow-toolkit/commit/b7142d99a675561c5af44f9185cd4e0ff727ec9f))
* **auth:** add AuthService with 4-tier hierarchical orchestration ([#5](https://github.com/kty1965/akiflow-toolkit/issues/5)) ([c3f5109](https://github.com/kty1965/akiflow-toolkit/commit/c3f5109af5be0235c8c45d0eb71e0ef457c900e8))
* **auth:** add browser token extraction (IndexedDB + Chrome cookies) ([#4](https://github.com/kty1965/akiflow-toolkit/issues/4)) ([11e0749](https://github.com/kty1965/akiflow-toolkit/commit/11e0749898c571828cdd4c5f3038823c1421e1b1))
* **auth:** add CDP-based browser login (Tier 3) ([#13](https://github.com/kty1965/akiflow-toolkit/issues/13)) ([d905221](https://github.com/kty1965/akiflow-toolkit/commit/d905221112c20a9c9d8b6ded444011fa7a1c92e3))
* **auth:** add token refresh with retry and rotation detection ([#3](https://github.com/kty1965/akiflow-toolkit/issues/3)) ([ec7295a](https://github.com/kty1965/akiflow-toolkit/commit/ec7295ae11b69464f534bedef96022806c3b0995))
* **auth:** add XDG credential storage adapter ([#2](https://github.com/kty1965/akiflow-toolkit/issues/2)) ([ccd9b96](https://github.com/kty1965/akiflow-toolkit/commit/ccd9b96aeb9aeca8da22d820e34b5e6a389adb50))
* **cache:** add local sync cache with pending queue and short ID mapping ([#10](https://github.com/kty1965/akiflow-toolkit/issues/10)) ([94f9d11](https://github.com/kty1965/akiflow-toolkit/commit/94f9d11889d2dc89f195b8abd6cdeddf6ed59cf6))
* **cli:** add add/ls/do/cache commands ([#12](https://github.com/kty1965/akiflow-toolkit/issues/12)) ([4b4f173](https://github.com/kty1965/akiflow-toolkit/commit/4b4f173e42a2cd053d0ea37d0b9e6bf6a7e8cdf7))
* **cli:** add entry point, composition root, and auth commands ([#8](https://github.com/kty1965/akiflow-toolkit/issues/8)) ([6caf50e](https://github.com/kty1965/akiflow-toolkit/commit/6caf50e6ab10f96d32bd65d15781360559d1a18c))
* **cli:** add project, cal, and block commands ([#24](https://github.com/kty1965/akiflow-toolkit/issues/24)) ([ebed103](https://github.com/kty1965/akiflow-toolkit/commit/ebed103af00d76b0d3575339ae73cdaba028f338))
* **cli:** add setup command for Claude Code/Cursor/Claude Desktop ([#11](https://github.com/kty1965/akiflow-toolkit/issues/11)) ([824f847](https://github.com/kty1965/akiflow-toolkit/commit/824f8474ee4805e823ee27ae5234964baa66548d))
* **cli:** add shell completion generator (bash/zsh/fish) ([#23](https://github.com/kty1965/akiflow-toolkit/issues/23)) ([68833db](https://github.com/kty1965/akiflow-toolkit/commit/68833db80551d4540a04321ed96299dff6d94318)), closes [#compdef](https://github.com/kty1965/akiflow-toolkit/issues/compdef)
* **cli:** add task edit/move/plan/snooze/delete subcommands ([#25](https://github.com/kty1965/akiflow-toolkit/issues/25)) ([4fed4ad](https://github.com/kty1965/akiflow-toolkit/commit/4fed4adec9d35ef5f04226e066aba0af20e0c594))
* **core:** add type definitions, error hierarchy, and port interfaces ([#1](https://github.com/kty1965/akiflow-toolkit/issues/1)) ([0029f5d](https://github.com/kty1965/akiflow-toolkit/commit/0029f5d3f07742dbaef77160b000083128294d9b))
* **mcp:** add calendar, organize, and auth_status tools ([#14](https://github.com/kty1965/akiflow-toolkit/issues/14)) ([105c528](https://github.com/kty1965/akiflow-toolkit/commit/105c528d650449648259a60040f7807e1329b0c6))
* **mcp:** add MCP server core with stdio transport ([#9](https://github.com/kty1965/akiflow-toolkit/issues/9)) ([c403773](https://github.com/kty1965/akiflow-toolkit/commit/c40377321c2ec99c1765112da0a9b77ea59e0d27))
* **mcp:** add task tools (get/search/create/update/complete/schedule/unschedule) ([#15](https://github.com/kty1965/akiflow-toolkit/issues/15)) ([b2b0941](https://github.com/kty1965/akiflow-toolkit/commit/b2b0941c2cfb1abc111173a25dffceeea581df6e))
* setup Bun + TypeScript project scaffold with release tooling ([6213dd2](https://github.com/kty1965/akiflow-toolkit/commit/6213dd21fc41df72a1643a95969aff9c05b2a847))
