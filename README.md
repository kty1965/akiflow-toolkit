# akiflow-toolkit

> **Unofficial project.** Not affiliated with Akiflow Inc.
> Uses reverse-engineered internal API. May break without notice.
> See [DISCLAIMER.md](./DISCLAIMER.md).

Unofficial CLI and MCP server for [Akiflow](https://akiflow.com), enabling terminal-based task management and AI agent integration (Claude Code, Cursor, Claude Desktop).

## Status

**Alpha** — Published to npm as `akiflow-toolkit`. Requires **[Bun](https://bun.sh) 1.1+** runtime.

## Planned Features

- **CLI** (`af`): Task management from terminal — add, list, complete, schedule, projects, calendar
- **MCP Server** (`af --mcp`): AI agent integration via Model Context Protocol
- **Auto Authentication**: Extracts tokens from browser data (IndexedDB, cookies) — no manual DevTools copy
- **Token Auto-Recovery**: 3-tier recovery when tokens expire (refresh → disk reload → browser re-extract)
- **Cross-browser**: Chrome, Arc, Brave, Edge, Safari support (macOS)

## Architecture

Key decisions are documented as Architecture Decision Records (ADRs):

- [ADR Index](./docs/adr/README.md) — All 15 ADRs
- Highlights: Bun runtime, Hexagonal (Ports & Adapters), Outcome-first MCP Tools, semantic-release, Test Diamond

## Runtime Requirement — **Bun Only**

`akiflow-toolkit`은 [Bun](https://bun.sh) runtime 전용 CLI입니다. Node.js로는 실행할 수 없습니다.

- 배포 번들이 `bun:sqlite` 등 Bun 네이티브 모듈을 직접 사용합니다 (Chrome cookie DB 파싱 용도).
- shebang이 `#!/usr/bin/env bun`으로 고정되어 있습니다.
- Bun은 Node.js 호환 API를 대부분 지원하므로 기능적 제약은 거의 없습니다.

> Node.js 지원이 필요하면 `better-sqlite3`로 교체하는 별도 마이그레이션이 필요합니다 ([docs/tasks/](./docs/tasks/) 참고).

## Installation

### Prerequisites

Bun 1.1+ 설치:
```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

### Install CLI

```bash
bun install -g akiflow-toolkit
af --help
```

## Platform Support

| Platform | Runtime | CLI core | MCP server | Auto auth (browser) | Status |
|----------|---------|----------|-----------|---------------------|--------|
| **macOS** (arm64/x64) | Bun 1.1+ | ✅ | ✅ | ✅ Chrome/Arc/Brave/Edge/Safari | **Fully supported** |
| **Linux** (x64/arm64) | Bun 1.1+ | ✅ | ✅ | ❌ (manual `af auth` only) | **Partial** — see [docs/tasks/linux-support.md](./docs/tasks/linux-support.md) |
| **Windows** (x64) | Bun 1.1+ | ✅ | ✅ | ❌ (manual `af auth` only) | **Partial** — see [docs/tasks/windows-support.md](./docs/tasks/windows-support.md) |

### macOS

자동 인증 포함 전체 기능이 동작합니다.

```bash
bun install -g akiflow-toolkit
af auth        # Chrome/Arc/Brave/Edge/Safari에서 자동 토큰 추출
af ls
```

### Linux

CLI 및 MCP는 정상 동작합니다. Chrome cookie 자동 추출은 미구현(libsecret 미연동)이므로 수동 인증을 사용합니다.

```bash
bun install -g akiflow-toolkit

# 수동 인증: Akiflow 웹 로그인 후 DevTools → Network → request headers에서
# Bearer <JWT>를 복사해 붙여넣기
af auth

af ls
```

제약 사항:
- Chrome cookie 기반 auto-auth 미지원
- Safari 관련 기능 없음 (Apple 전용 브라우저)

### Windows

CLI 및 MCP는 동작합니다. DPAPI(Windows 쿠키 암호화) 미연동으로 Chrome cookie 자동 추출은 불가능.

PowerShell에서:
```powershell
bun install -g akiflow-toolkit
af auth        # 수동 입력
af ls
```

제약 사항:
- Bun Windows arm64는 실험 단계 (x64 권장)
- PowerShell용 completion 스크립트 미제공 (bash/zsh/fish만 지원)
- Chrome cookie 기반 auto-auth 미지원

### From Source (development)

```bash
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

### Verifying authentication

After `af auth`, you can confirm the CLI is talking to the real Akiflow API at four levels of depth:

```bash
# 1. Is a credential stored?
af auth status
# → Authenticated: active
#     source: indexeddb
#     expiresAt: 2026-04-19T13:28:30.768Z

# 2. Does the stored token actually reach Akiflow API? (diagnostic probe)
bun run scripts/mcp-api-probe.ts
# → ✓ Akiflow API reachable AND token accepted.
#   status 200 OK, body length 5MB+

# 3. Can a real MCP client spawn the server and round-trip a task?
bun run scripts/mcp-live-demo.ts
# → runs 9 steps: spawn → tools/list → auth_status → READ precheck
#   → create_task → verify inbox → complete_task → verify done
# A clean run ends with "✓ All Tier 2 E2E checks passed."

# 4. Try it from your editor
#    MCP: register `af --mcp` in ~/.claude.json and ask
#    Claude Code "오늘 할 일 보여줘".
```

**If something fails**, read [`docs/akiflow-token-acquisition.md`](./docs/akiflow-token-acquisition.md) — it walks through the dual auth scheme (Laravel session cookie vs OAuth JWT), the 4-tier extraction cascade (IndexedDB → Cookie → Safari → Manual), the `withAuth` recovery sequence, and six known failure modes with concrete fixes.

Most common remedy when `auth_status` shows `source: cookie` but API calls throw `fetch failed` / `Header has invalid value`:

```bash
osascript -e 'tell application "Google Chrome" to quit'   # release leveldb LOCK
bun run src/index.ts auth logout
bun run src/index.ts auth                                 # re-scan IndexedDB
bun run src/index.ts auth status                          # expect source: indexeddb
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

### Local MCP registration (before npm publish)

Until `akiflow-toolkit` lands on npm, you can still use it from Claude Code / Cursor / Claude Desktop by building a standalone binary and symlinking it into your `PATH`. `af setup` performs an atomic merge-write on the editor config, so any existing `mcpServers` entries are preserved.

#### Install

```bash
# 1. Build a self-contained binary for your platform (Bun runtime embedded)
bun run build:darwin-arm64   # Apple Silicon
# bun run build:darwin-x64   # Intel Mac
# bun run build:linux-x64    # Linux x64
# bun run build:linux-arm64  # Linux arm64

# 2. Symlink into a PATH directory (no sudo required)
mkdir -p ~/.local/bin
ln -sf "$PWD/dist/af-darwin-arm64" ~/.local/bin/af

# 3. Make sure ~/.local/bin is on PATH
echo "$PATH" | tr ':' '\n' | grep -q "$HOME/.local/bin" \
  || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
# Open a new shell, or: source ~/.zshrc

# 4. Smoke check
af --help
af auth status               # expect: source: indexeddb, active

# 5. Register the MCP server in your AI editor
af setup claude-code         # → ~/.claude.json
# af setup cursor            # → ~/.cursor/mcp.json
# af setup claude-desktop    # → ~/Library/Application Support/Claude/... (macOS only)

# 6. Restart the editor, then try a tool call (e.g. "show me today's inbox")
```

When you edit source code later, only step 1 needs to run again — the symlink keeps pointing at the fresh binary.

#### Uninstall

```bash
# 1. Remove the akiflow entry from every editor config where it was registered
jq 'del(.mcpServers.akiflow)' ~/.claude.json > ~/.claude.json.new && mv ~/.claude.json.new ~/.claude.json
[ -f ~/.cursor/mcp.json ] && jq 'del(.mcpServers.akiflow)' ~/.cursor/mcp.json > ~/.cursor/mcp.json.new && mv ~/.cursor/mcp.json.new ~/.cursor/mcp.json
# Claude Desktop (macOS):
#   CONFIG=~/Library/Application\ Support/Claude/claude_desktop_config.json
#   jq 'del(.mcpServers.akiflow)' "$CONFIG" > "$CONFIG".new && mv "$CONFIG".new "$CONFIG"

# 2. Remove the PATH shim
rm -f ~/.local/bin/af

# 3. (Optional) Drop the compiled binaries
rm -rf dist/

# 4. (Optional) Revoke stored auth credentials
bun run src/index.ts auth logout    # or: rm ~/.config/akiflow/auth.json

# 5. Restart the editor
```

## Disclaimer

See [DISCLAIMER.md](./DISCLAIMER.md).

## License

MIT © kty1965
