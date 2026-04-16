# akiflow-toolkit

> **Unofficial project.** Not affiliated with Akiflow Inc.
> Uses reverse-engineered internal API. May break without notice.
> See [DISCLAIMER.md](./DISCLAIMER.md).

Unofficial CLI and MCP server for [Akiflow](https://akiflow.com), enabling terminal-based task management and AI agent integration (Claude Code, Cursor, Claude Desktop).

## Status

**Pre-alpha** — Under active development. Not yet published to npm.

## Planned Features

- **CLI** (`af`): Task management from terminal — add, list, complete, schedule, projects, calendar
- **MCP Server** (`af --mcp`): AI agent integration via Model Context Protocol
- **Auto Authentication**: Extracts tokens from browser data (IndexedDB, cookies) — no manual DevTools copy
- **Token Auto-Recovery**: 3-tier recovery when tokens expire (refresh → disk reload → browser re-extract)
- **Cross-browser**: Chrome, Arc, Brave, Edge, Safari support

## Architecture

Key decisions are documented as Architecture Decision Records (ADRs):

- [ADR Index](./docs/adr/README.md) — All 15 ADRs
- Highlights: Bun runtime, Hexagonal (Ports & Adapters), Outcome-first MCP Tools, semantic-release, Test Diamond

## Installation

> Not yet published to npm. Currently development-only.

```bash
# npm (after publish)
npm install -g akiflow-toolkit

# Bun (after publish)
bun install -g akiflow-toolkit

# From source (now)
git clone https://github.com/kty1965/akiflow-toolkit.git
cd akiflow-toolkit
bun install
bun run dev
```

## Quick Start

> Coming soon after initial implementation.

```bash
# Authenticate (auto-extracts from browser)
af auth

# Use CLI
af ls
af add "New task" --today

# Setup MCP for Claude Code
af setup claude-code
```

## Documentation

- [CLI Commands](./docs/COMMANDS.md) *(coming soon)*
- [MCP Tools](./docs/MCP_TOOLS.md) *(coming soon)*
- [Authentication Guide](./docs/AUTHENTICATION.md) *(coming soon)*
- [Architecture Decisions](./docs/adr/README.md)
- [Contributing](./docs/CONTRIBUTING.md) *(coming soon)*

## Development

### Prerequisites

- [Bun](https://bun.sh) >= 1.0.0
- [pre-commit](https://pre-commit.com) (`brew install pre-commit` or `pip install pre-commit`)

### Setup

```bash
git clone https://github.com/kty1965/akiflow-toolkit.git
cd akiflow-toolkit
bun install
pre-commit install --install-hooks
```

### Commands

```bash
bun run dev          # Hot reload 개발 모드
bun test             # 테스트 실행
bun run lint         # Biome 린트
bun run build        # npm 배포용 dist/ 빌드
bun run build:binary # 크로스 플랫폼 바이너리 빌드
```

## Disclaimer

See [DISCLAIMER.md](./DISCLAIMER.md).

## License

MIT © kty1965
