# akiflow-toolkit

[한국어](./README.md) | **English**

> **Unofficial project.** Not affiliated with Akiflow Inc.
> Uses reverse-engineered internal API. May break without notice.
> See [DISCLAIMER.md](./DISCLAIMER.md).

Unofficial CLI and MCP server for [Akiflow](https://akiflow.com), enabling terminal-based task management and AI agent integration (Claude Code, Cursor, Claude Desktop).

## Status

**Alpha** — Published to npm as `akiflow-toolkit`. Requires **[Bun](https://bun.sh) 1.1+** runtime.

## Features

- **CLI** (`af`): Task management from terminal — add, list, complete, schedule, projects, calendar
- **MCP Server**: AI agent integration via Model Context Protocol
  - `af --mcp` — stdio, one server per editor session
  - `af --mcp --http` — one shared Streamable HTTP server for every session ([details](#shared-mcp-server-http))
- **Auto Authentication**: Extracts tokens from browser data (IndexedDB, cookies) on macOS, or opens a Chrome login window via CDP — no manual DevTools copy
- **Token Auto-Recovery**: refreshes the access token 2 minutes before it expires, keeps a long-running MCP server authenticated while idle, and on a 401 falls back through refresh → disk reload → browser re-extract. Refreshes are serialized across processes (`auth.json.lock`) so the CLI and the MCP server don't refresh at the same time.
- **Cross-browser**: Chrome, Arc, Brave, Edge, Safari support (macOS)

## Architecture

Key decisions are documented as Architecture Decision Records (ADRs):

- [ADR Index](./docs/adr/README.md) — All 16 ADRs
- Highlights: Bun runtime, Hexagonal (Ports & Adapters), Outcome-first MCP Tools, semantic-release, Test Diamond

## Runtime Requirement — **Bun Only**

`akiflow-toolkit` is a CLI for the [Bun](https://bun.sh) runtime only. It does not run on Node.js.

- The published bundle uses Bun native modules such as `bun:sqlite` directly (to parse the Chrome cookie DB).
- The shebang is pinned to `#!/usr/bin/env bun`.
- Bun implements most Node.js-compatible APIs, so this costs almost no functionality.

> Node.js support would need a separate migration to `better-sqlite3` (see [docs/tasks/](./docs/tasks/)).

## Installation

### Prerequisites

Install Bun 1.1+:
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
| **Linux** (x64/arm64) | Bun 1.1+ | ✅ | ✅ | ⚠️ CDP login window (no cookie extraction) | **Partial** — see [docs/tasks/linux-support.en.md](./docs/tasks/linux-support.en.md) |
| **Windows** (x64) | Bun 1.1+ | ✅ | ✅ | ❌ (`af auth --manual` only) | **Partial** — see [docs/tasks/windows-support.en.md](./docs/tasks/windows-support.en.md) |

### macOS

Everything works, including automatic authentication.

```bash
bun install -g akiflow-toolkit
af auth        # extract the token from Chrome/Arc/Brave/Edge/Safari automatically
af ls
```

### Linux

The CLI and MCP server work normally. Automatic Chrome cookie extraction is not implemented (no libsecret
integration), but `af auth` launches Chrome/Chromium in CDP mode, opens a login window, and captures the token. Later refreshes happen automatically with the refresh token.

```bash
bun install -g akiflow-toolkit

# A Chrome/Chromium login window opens → log in to Akiflow → token is saved
af auth
# Where no browser can be opened (SSH, etc.), pass the refresh token directly
# af auth --manual < refresh-token.txt   # refresh token via stdin

af ls
```

Limitations:
- No Chrome-cookie auto-auth (use the CDP login window or `af auth --manual`)
- CDP login needs a desktop session and `google-chrome`/`chromium`
- No Safari features (Apple-only browser)

### Windows

The CLI and MCP server work. Chrome cookie extraction is not possible because DPAPI (Windows cookie encryption) is not integrated.

In PowerShell:
```powershell
bun install -g akiflow-toolkit
Get-Content refresh-token.txt | af auth --manual   # refresh token via stdin
af ls
```

Limitations:
- Bun on Windows arm64 is experimental (x64 recommended)
- No PowerShell completion script (bash/zsh/fish only)
- No Chrome-cookie auto-auth

### From Source (development)

```bash
git clone https://github.com/kty1965/akiflow-toolkit.git
cd akiflow-toolkit
bun install
bun run dev
```

## Quick Start

```bash
# Authenticate (auto-extracts from browser)
af auth

# Use CLI
af ls
af add "New task" --today

# Setup MCP for Claude Code (stdio)
af setup claude-code
# or share one server across sessions: see below
```

<a id="shared-mcp-server-http"></a>

### Shared MCP server (HTTP)

`af --mcp` (stdio) starts a separate server for every Claude Code session. To share one
server — one auth keep-alive, one token refresh — across all sessions, run the HTTP mode:

```bash
# 1. Run the server (127.0.0.1:7823/mcp; override with AF_MCP_HTTP_PORT)
af --mcp --http

# 2. Point Claude Code at it (writes { type: "http", url, headers } to ~/.claude.json)
af setup claude-code --http
```

Requests must carry `Authorization: Bearer <token>`. The token is generated on first start
at `~/.config/akiflow/mcp-http-token` (mode 0600) and copied into the Claude Code config by
`setup --http`.

To keep the server running on Linux, install the systemd user unit:

```bash
mkdir -p ~/.config/systemd/user
cp contrib/systemd/akiflow-mcp.service ~/.config/systemd/user/
# edit ExecStart if af is not at ~/.local/bin/af
systemctl --user daemon-reload
systemctl --user enable --now akiflow-mcp
journalctl --user -u akiflow-mcp -f      # logs
```

User services stop at logout unless lingering is enabled (`loginctl enable-linger $USER`).

<a id="operating-tips"></a>

### Operating tips

Commands you will reach for when running the shared HTTP server under systemd.

| Goal | Command |
|------|---------|
| Is it running? | `systemctl --user is-active akiflow-mcp` |
| Startup log (the `MCP server listening` line) | `journalctl --user -u akiflow-mcp -n 20 --no-pager` |
| Auth state | `af auth status` |
| Pick up a new release (npm install) | `bun install -g akiflow-toolkit@latest && systemctl --user restart akiflow-mcp` |
| Ship a source change (local binary, Linux x64) | `bun run build:linux-x64 && systemctl --user restart akiflow-mcp` |
| Keep it running after logout | `loginctl enable-linger $USER` |

- **With a local binary, redeploying means rebuilding it.** If you followed [Local binary registration](#local-binary-registration), the unit runs `~/.local/bin/af` → `dist/af-<platform>` (a compiled binary). `bun run build` only rewrites `dist/index.js`, so the server never sees it. After building, confirm with something like `af ls --help` showing the new options.
- **File locations**: credentials live in `~/.config/akiflow/auth.json`, the HTTP Bearer token in `~/.config/akiflow/mcp-http-token`. Deleting the token file makes the next start generate a new one, so run `af setup claude-code --http` again.
- **Log level**: the unit sets `LOG_LEVEL=info` so the startup line reaches the journal. To debug, change it to `Environment=LOG_LEVEL=debug`, then `daemon-reload` and restart.
- **CLI auth and browser login are separate.** Re-running `af auth` does not log in any other browser session (for example, a browser automation tool).

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
#    af setup claude-code (or --http), restart Claude Code, then ask
#    "show me today's tasks".
```

**If something fails**, read [`docs/akiflow-token-acquisition.en.md`](./docs/akiflow-token-acquisition.en.md) — it walks through the dual auth scheme (Laravel session cookie vs OAuth JWT), the 4-tier extraction cascade (IndexedDB → Cookie → Safari → Manual), the `withAuth` recovery sequence, and six known failure modes with concrete fixes.

Most common remedy when `auth_status` shows `source: cookie` but API calls throw `fetch failed` / `Header has invalid value`:

```bash
osascript -e 'tell application "Google Chrome" to quit'   # release leveldb LOCK
bun run src/index.ts auth logout
bun run src/index.ts auth                                 # re-scan IndexedDB
bun run src/index.ts auth status                          # expect source: indexeddb
```

## Documentation

- [Authentication & token acquisition](./docs/akiflow-token-acquisition.en.md)
- [Architecture Decisions](./docs/adr/README.md)
- Platform notes: [Linux](./docs/tasks/linux-support.en.md), [Windows](./docs/tasks/windows-support.en.md)
- CLI reference: `af --help`, `af <command> --help`

## Development

### Prerequisites

- [Bun](https://bun.sh) >= 1.1.0
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
bun run dev          # hot-reload dev mode
bun test             # run tests
bun run lint         # Biome lint
bun run build        # build dist/ for npm
bun run build:binary # build cross-platform binaries
```

<a id="stacked-pr-workflow"></a>

### Contributing: commit messages and stacked PRs

Every merge to `main` runs semantic-release, which reads the commit messages, bumps the version and publishes to npm.
So commit messages and the merge method decide what gets released.

- Commits follow [Conventional Commits](https://www.conventionalcommits.org) (`fix:` → patch, `feat:` → minor). commitlint checks them in pre-commit.
- When one PR mixes different kinds of change, split them into separate `fix`/`feat`/`docs` commits.
- **Merge with a merge commit. Never squash.** Squashing collapses the headers into one and semantic-release only sees the first type. A squashed `fix` + `feat` once shipped as a patch (1.6.1) instead of a minor.

```bash
gh pr merge <PR number> --merge
```

For a stack, retarget the top PR to `main` right before merging it.

```bash
gh pr edit <top PR> --base main
gh pr merge <top PR> --merge
```

When several changes depend on each other, split them into stacked PRs. Each PR uses the branch directly below it as its base.

```text
main ← fix/auth-refresh-expired-token (#98)
         ← feat/auth-proactive-refresh (#99)
           ← feat/mcp-auth-keep-alive (#100)
             ← feat/mcp-http-shared-server (#101)
               ← docs/readme-refresh (#103)
```

1. Review from the bottom PR up. Each diff is against the branch directly below, so it stays small.
2. If a lower branch changes, rebase each branch above it in order and push.
3. Once everything is approved, retarget the top PR to `main` and merge it once, with a merge commit (commands above). In this repo #98–#101 were marked merged by the same merge commit. If a lower PR stays open, close it by hand.
4. Every commit is preserved, so semantic-release counts all of them. The stack above became 1.7.0 (2 fixes, 5 features) from a single merge.

### Local binary registration

To run an unreleased build from Claude Code / Cursor / Claude Desktop, build a standalone binary and symlink it into your `PATH` (it takes precedence over a global `bun install -g` copy when `~/.local/bin` comes first). `af setup` performs an atomic merge-write on the editor config, so any existing `mcpServers` entries are preserved.

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
af setup claude-code         # → ~/.claude.json (stdio)
# af setup claude-code --http  # → shared HTTP server (run `af --mcp --http` or the systemd unit)
# af setup cursor            # → ~/.cursor/mcp.json
# af setup claude-desktop    # → ~/Library/Application Support/Claude/... (macOS only)

# 6. Restart the editor, then try a tool call (e.g. "show me today's inbox")
```

When you edit source code later, only step 1 needs to run again — the symlink keeps pointing at the fresh binary. If you run the shared HTTP server, restart it too (`systemctl --user restart akiflow-mcp`).

#### Uninstall

```bash
# 1. Remove the akiflow entry from every editor config where it was registered
jq 'del(.mcpServers.akiflow)' ~/.claude.json > ~/.claude.json.new && mv ~/.claude.json.new ~/.claude.json
[ -f ~/.cursor/mcp.json ] && jq 'del(.mcpServers.akiflow)' ~/.cursor/mcp.json > ~/.cursor/mcp.json.new && mv ~/.cursor/mcp.json.new ~/.cursor/mcp.json
# Claude Desktop (macOS):
#   CONFIG=~/Library/Application\ Support/Claude/claude_desktop_config.json
#   jq 'del(.mcpServers.akiflow)' "$CONFIG" > "$CONFIG".new && mv "$CONFIG".new "$CONFIG"

# 1b. If you used the shared HTTP server
systemctl --user disable --now akiflow-mcp
rm -f ~/.config/systemd/user/akiflow-mcp.service ~/.config/akiflow/mcp-http-token
systemctl --user daemon-reload

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
