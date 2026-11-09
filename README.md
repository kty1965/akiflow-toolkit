# akiflow-toolkit

**한국어** | [English](./README.en.md)

> **비공식 프로젝트입니다.** Akiflow Inc. 와 관계가 없습니다.
> 리버스 엔지니어링한 내부 API 를 쓰므로 예고 없이 깨질 수 있습니다.
> [DISCLAIMER.md](./DISCLAIMER.md) 를 참고하세요.

[Akiflow](https://akiflow.com) 용 비공식 CLI 와 MCP 서버입니다. 터미널에서 할 일을 관리하고, AI 에이전트(Claude Code, Cursor, Claude Desktop)와 연동합니다.

## 상태

**Alpha** — npm 에 `akiflow-toolkit` 으로 배포되어 있습니다. **[Bun](https://bun.sh) 1.1+** 런타임이 필요합니다.

## 기능

- **CLI** (`af`): 터미널에서 할 일 관리 — 추가, 조회, 완료, 일정 지정, 프로젝트, 캘린더
- **MCP 서버**: Model Context Protocol 로 AI 에이전트와 연동
  - `af --mcp` — stdio, 에디터 세션마다 서버 하나
  - `af --mcp --http` — 모든 세션이 함께 쓰는 Streamable HTTP 서버 하나 ([자세히](#shared-mcp-server-http))
- **자동 인증**: macOS 에서는 브라우저 데이터(IndexedDB, 쿠키)에서 토큰을 추출하고, 그 외에는 CDP 로 Chrome 로그인 창을 엽니다. DevTools 에서 직접 복사할 필요가 없습니다.
- **토큰 자동 복구**: access token 만료 2분 전에 갱신하고, 오래 떠 있는 MCP 서버가 유휴 상태여도 인증을 유지하며, 401 이 나면 refresh → 디스크 재로드 → 브라우저 재추출 순으로 복구합니다. 갱신은 프로세스 간에 직렬화(`auth.json.lock`)되어 CLI 와 MCP 서버가 동시에 갱신하지 않습니다.
- **여러 브라우저 지원**: Chrome, Arc, Brave, Edge, Safari (macOS)

## 아키텍처

주요 결정은 Architecture Decision Record(ADR)로 남겨 두었습니다.

- [ADR 목록](./docs/adr/README.md) — ADR 16개 전체
- 핵심: Bun 런타임, Hexagonal (Ports & Adapters), 결과 중심 MCP 도구, semantic-release, Test Diamond

## 런타임 요구사항 — **Bun 전용**

`akiflow-toolkit` 은 [Bun](https://bun.sh) 런타임 전용 CLI 입니다. Node.js 로는 실행할 수 없습니다.

- 배포 번들이 `bun:sqlite` 등 Bun 네이티브 모듈을 직접 사용합니다 (Chrome cookie DB 파싱 용도).
- shebang 이 `#!/usr/bin/env bun` 으로 고정되어 있습니다.
- Bun 은 Node.js 호환 API 를 대부분 지원하므로 기능상 제약은 거의 없습니다.

> Node.js 지원이 필요하면 `better-sqlite3` 로 교체하는 별도 마이그레이션이 필요합니다 ([docs/tasks/](./docs/tasks/) 참고).

## 설치

### 사전 준비

Bun 1.1+ 설치:
```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

### CLI 설치

```bash
bun install -g akiflow-toolkit
af --help
```

## 플랫폼 지원

| 플랫폼 | 런타임 | CLI | MCP 서버 | 자동 인증 (브라우저) | 상태 |
|--------|--------|-----|----------|---------------------|------|
| **macOS** (arm64/x64) | Bun 1.1+ | ✅ | ✅ | ✅ Chrome/Arc/Brave/Edge/Safari | **전체 지원** |
| **Linux** (x64/arm64) | Bun 1.1+ | ✅ | ✅ | ⚠️ CDP 로그인 창 (쿠키 추출 없음) | **부분 지원** — [docs/tasks/linux-support.md](./docs/tasks/linux-support.md) 참고 |
| **Windows** (x64) | Bun 1.1+ | ✅ | ✅ | ❌ (`af auth --manual` 만 가능) | **부분 지원** — [docs/tasks/windows-support.md](./docs/tasks/windows-support.md) 참고 |

### macOS

자동 인증을 포함해 모든 기능이 동작합니다.

```bash
bun install -g akiflow-toolkit
af auth        # Chrome/Arc/Brave/Edge/Safari에서 자동 토큰 추출
af ls
```

### Linux

CLI 와 MCP 는 정상 동작합니다. Chrome cookie 자동 추출은 미구현(libsecret 미연동)이지만, `af auth` 가
Chrome/Chromium 을 CDP 모드로 띄워 로그인 창을 열고 토큰을 가져옵니다. 이후 갱신은 refresh token 으로 자동 처리됩니다.

```bash
bun install -g akiflow-toolkit

# Chrome/Chromium 로그인 창이 열림 → Akiflow 로그인 → 토큰 저장
af auth
# 브라우저를 띄울 수 없는 환경(SSH 등)에서는 refresh token 을 직접 입력
# af auth --manual < refresh-token.txt   # refresh token 을 stdin 으로 전달

af ls
```

제약 사항:
- Chrome cookie 기반 자동 인증 미지원 (CDP 로그인 창 또는 `af auth --manual`)
- CDP 로그인에는 데스크톱 세션과 `google-chrome`/`chromium` 이 필요
- Safari 관련 기능 없음 (Apple 전용 브라우저)

### Windows

CLI 와 MCP 는 동작합니다. DPAPI(Windows 쿠키 암호화) 미연동으로 Chrome cookie 자동 추출은 불가능합니다.

PowerShell 에서:
```powershell
bun install -g akiflow-toolkit
Get-Content refresh-token.txt | af auth --manual   # refresh token 을 stdin 으로 전달
af ls
```

제약 사항:
- Bun Windows arm64 는 실험 단계 (x64 권장)
- PowerShell 용 completion 스크립트 미제공 (bash/zsh/fish 만 지원)
- Chrome cookie 기반 자동 인증 미지원

### 소스에서 실행 (개발용)

```bash
git clone https://github.com/kty1965/akiflow-toolkit.git
cd akiflow-toolkit
bun install
bun run dev
```

## 빠른 시작

```bash
# 인증 (브라우저에서 자동 추출)
af auth

# CLI 사용
af ls
af add "New task" --today

# Claude Code 에 MCP 등록 (stdio)
af setup claude-code
# 여러 세션이 서버 하나를 같이 쓰려면: 아래 참고
```

<a id="shared-mcp-server-http"></a>

### 공유 MCP 서버 (HTTP)

`af --mcp` (stdio) 는 Claude Code 세션마다 서버를 따로 띄웁니다. 모든 세션이 서버 하나를 —
인증 keep-alive 하나, 토큰 갱신 하나를 — 같이 쓰게 하려면 HTTP 모드로 실행합니다.

```bash
# 1. 서버 실행 (127.0.0.1:7823/mcp, 포트는 AF_MCP_HTTP_PORT 로 변경)
af --mcp --http

# 2. Claude Code 가 이 서버를 보게 설정 (~/.claude.json 에 { type: "http", url, headers } 기록)
af setup claude-code --http
```

요청에는 `Authorization: Bearer <token>` 이 필요합니다. 토큰은 첫 실행 때
`~/.config/akiflow/mcp-http-token` (권한 0600)에 생성되고, `setup --http` 가 Claude Code 설정에 복사합니다.

Linux 에서 서버를 계속 띄워 두려면 systemd user unit 을 설치합니다.

```bash
mkdir -p ~/.config/systemd/user
cp contrib/systemd/akiflow-mcp.service ~/.config/systemd/user/
# af 가 ~/.local/bin/af 에 없으면 ExecStart 수정
systemctl --user daemon-reload
systemctl --user enable --now akiflow-mcp
journalctl --user -u akiflow-mcp -f      # 로그
```

user 서비스는 로그아웃하면 멈춥니다. 계속 띄우려면 lingering 을 켭니다(`loginctl enable-linger $USER`).

<a id="operating-tips"></a>

### 운영 팁

공유 HTTP 서버를 systemd 로 돌릴 때 자주 쓰는 명령입니다.

| 하고 싶은 것 | 명령 |
|-------------|------|
| 살아 있는지 확인 | `systemctl --user is-active akiflow-mcp` |
| 시작 로그 확인 (`MCP server listening` 줄) | `journalctl --user -u akiflow-mcp -n 20 --no-pager` |
| 인증 상태 확인 | `af auth status` |
| 새 버전 반영 (npm 설치) | `bun install -g akiflow-toolkit@latest && systemctl --user restart akiflow-mcp` |
| 소스 변경 반영 (로컬 바이너리, Linux x64) | `bun run build:linux-x64 && systemctl --user restart akiflow-mcp` |
| 로그아웃 후에도 유지 | `loginctl enable-linger $USER` |

- **로컬 바이너리로 돌린다면 재배포는 바이너리를 다시 빌드해야 합니다.** [로컬 바이너리 등록](#로컬-바이너리-등록)을 따랐다면 unit 은 `~/.local/bin/af` → `dist/af-<platform>` (compiled binary)를 실행합니다. `bun run build` 는 `dist/index.js` 만 바꾸므로 서버에 반영되지 않습니다. 빌드 후 `af ls --help` 처럼 새 옵션이 보이는지로 확인하세요.
- **파일 위치**: 인증 정보는 `~/.config/akiflow/auth.json`, HTTP Bearer 토큰은 `~/.config/akiflow/mcp-http-token` 입니다. 토큰 파일을 지우면 다음 시작 때 새로 만들어지므로 `af setup claude-code --http` 를 다시 실행해야 합니다.
- **로그 레벨**: unit 은 `LOG_LEVEL=info` 로 시작 줄을 journal 에 남깁니다. 디버깅할 때는 unit 의 `Environment=LOG_LEVEL=debug` 로 바꾸고 `daemon-reload` 후 재시작합니다.
- **CLI 인증과 브라우저 로그인은 별개입니다.** `af auth` 로 다시 인증해도 다른 브라우저 세션(예: 브라우저 자동화 도구)이 로그인되지는 않습니다.

### 인증 확인

`af auth` 후 CLI 가 실제 Akiflow API 와 통신하는지 네 단계 깊이로 확인할 수 있습니다.

```bash
# 1. 자격 증명이 저장되어 있는가?
af auth status
# → Authenticated: active
#     source: indexeddb
#     expiresAt: 2026-04-19T13:28:30.768Z

# 2. 저장된 토큰이 실제로 Akiflow API 에 닿는가? (진단 probe)
bun run scripts/mcp-api-probe.ts
# → ✓ Akiflow API reachable AND token accepted.
#   status 200 OK, body length 5MB+

# 3. 실제 MCP 클라이언트가 서버를 띄우고 할 일을 왕복 처리하는가?
bun run scripts/mcp-live-demo.ts
# → 9단계 실행: spawn → tools/list → auth_status → READ precheck
#   → create_task → verify inbox → complete_task → verify done
# 정상이면 "✓ All Tier 2 E2E checks passed." 로 끝남

# 4. 에디터에서 직접 시도
#    af setup claude-code (또는 --http), Claude Code 재시작 후
#    "오늘 할 일 보여줘" 라고 물어보기
```

**문제가 생기면** [`docs/akiflow-token-acquisition.md`](./docs/akiflow-token-acquisition.md) 를 읽어 보세요. 이중 인증 방식(Laravel 세션 쿠키 vs OAuth JWT), 4단계 추출 순서(IndexedDB → Cookie → Safari → Manual), `withAuth` 복구 순서, 알려진 실패 사례 6가지와 해결책을 다룹니다.

`auth_status` 가 `source: cookie` 인데 API 호출이 `fetch failed` / `Header has invalid value` 로 실패할 때 가장 흔한 해결책:

```bash
osascript -e 'tell application "Google Chrome" to quit'   # leveldb LOCK 해제
bun run src/index.ts auth logout
bun run src/index.ts auth                                 # IndexedDB 다시 스캔
bun run src/index.ts auth status                          # source: indexeddb 기대
```

## 문서

- [인증과 토큰 획득](./docs/akiflow-token-acquisition.md)
- [아키텍처 결정](./docs/adr/README.md)
- 플랫폼 노트: [Linux](./docs/tasks/linux-support.md), [Windows](./docs/tasks/windows-support.md)
- CLI 레퍼런스: `af --help`, `af <command> --help`

## 개발

### 사전 준비

- [Bun](https://bun.sh) >= 1.1.0
- [pre-commit](https://pre-commit.com) (`brew install pre-commit` 또는 `pip install pre-commit`)

### 설정

```bash
git clone https://github.com/kty1965/akiflow-toolkit.git
cd akiflow-toolkit
bun install
pre-commit install --install-hooks
```

### 명령

```bash
bun run dev          # Hot reload 개발 모드
bun test             # 테스트 실행
bun run lint         # Biome 린트
bun run build        # npm 배포용 dist/ 빌드
bun run build:binary # 크로스 플랫폼 바이너리 빌드
```

<a id="stacked-pr-workflow"></a>

### 기여 흐름: 커밋 메시지와 stacked PR

`main` 에 머지되면 semantic-release 가 커밋 메시지를 읽어 버전을 올리고 npm 에 배포합니다.
그래서 커밋 메시지와 머지 방식이 곧 릴리즈 결과입니다.

- 커밋은 [Conventional Commits](https://www.conventionalcommits.org) 를 따릅니다(`fix:` → patch, `feat:` → minor). pre-commit 의 commitlint 가 검사합니다.
- 한 PR 에 성격이 다른 변경이 섞이면 `fix`/`feat`/`docs` 커밋으로 나눕니다.
- **머지는 merge commit 으로 합니다. squash 하지 않습니다.** squash 하면 커밋 헤더가 하나로 합쳐져 semantic-release 가 첫 타입만 봅니다. 실제로 `fix` + `feat` 를 squash 했다가 minor 대신 patch(1.6.1)가 나온 적이 있습니다.

```bash
gh pr merge <PR번호> --merge
```

스택의 맨 위 PR 은 머지 직전에 base 를 `main` 으로 바꿉니다.

```bash
gh pr edit <맨 위 PR> --base main
gh pr merge <맨 위 PR> --merge
```

의존하는 변경이 여러 개면 stacked PR 로 나눕니다. 각 PR 은 바로 아래 브랜치를 base 로 삼습니다.

```text
main ← fix/auth-refresh-expired-token (#98)
         ← feat/auth-proactive-refresh (#99)
           ← feat/mcp-auth-keep-alive (#100)
             ← feat/mcp-http-shared-server (#101)
               ← docs/readme-refresh (#103)
```

1. 아래 PR 부터 차례로 리뷰합니다. 각 PR 의 diff 는 바로 아래 브랜치 대비라 작게 유지됩니다.
2. 아래 브랜치를 고치면 위 브랜치들을 차례로 rebase 하고 push 합니다.
3. 전부 승인되면 맨 위 PR 의 base 를 `main` 으로 바꾸고 merge commit 으로 한 번 머지합니다(위 명령). 이 저장소에서는 #98~#101 도 같은 머지 커밋으로 merged 처리됐습니다. 아래 PR 이 열린 채로 남으면 손으로 닫습니다.
4. 커밋이 하나하나 보존되므로 semantic-release 가 전부 반영합니다. 위 스택은 머지 한 번으로 1.7.0 (fix 2개, feat 5개)이 되었습니다.

### 로컬 바이너리 등록

배포 전 빌드를 Claude Code / Cursor / Claude Desktop 에서 쓰려면 독립 실행 바이너리를 빌드해 `PATH` 에 심볼릭 링크합니다(`~/.local/bin` 이 앞에 있으면 `bun install -g` 로 설치한 것보다 우선합니다). `af setup` 은 에디터 설정을 원자적으로 병합해 쓰므로 기존 `mcpServers` 항목은 유지됩니다.

#### 설치

```bash
# 1. 플랫폼용 독립 실행 바이너리 빌드 (Bun 런타임 내장)
bun run build:darwin-arm64   # Apple Silicon
# bun run build:darwin-x64   # Intel Mac
# bun run build:linux-x64    # Linux x64
# bun run build:linux-arm64  # Linux arm64

# 2. PATH 디렉터리에 심볼릭 링크 (sudo 불필요)
mkdir -p ~/.local/bin
ln -sf "$PWD/dist/af-darwin-arm64" ~/.local/bin/af

# 3. ~/.local/bin 이 PATH 에 있는지 확인
echo "$PATH" | tr ':' '\n' | grep -q "$HOME/.local/bin" \
  || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
# 새 셸을 열거나: source ~/.zshrc

# 4. 동작 확인
af --help
af auth status               # 기대값: source: indexeddb, active

# 5. AI 에디터에 MCP 서버 등록
af setup claude-code         # → ~/.claude.json (stdio)
# af setup claude-code --http  # → 공유 HTTP 서버 (`af --mcp --http` 또는 systemd unit 실행)
# af setup cursor            # → ~/.cursor/mcp.json
# af setup claude-desktop    # → ~/Library/Application Support/Claude/... (macOS 전용)

# 6. 에디터 재시작 후 도구 호출 시도 (예: "오늘 inbox 보여줘")
```

나중에 소스를 고치면 1단계만 다시 실행하면 됩니다. 심볼릭 링크는 새 바이너리를 계속 가리킵니다. 공유 HTTP 서버를 쓰고 있다면 서버도 재시작하세요(`systemctl --user restart akiflow-mcp`).

#### 제거

```bash
# 1. 등록한 모든 에디터 설정에서 akiflow 항목 제거
jq 'del(.mcpServers.akiflow)' ~/.claude.json > ~/.claude.json.new && mv ~/.claude.json.new ~/.claude.json
[ -f ~/.cursor/mcp.json ] && jq 'del(.mcpServers.akiflow)' ~/.cursor/mcp.json > ~/.cursor/mcp.json.new && mv ~/.cursor/mcp.json.new ~/.cursor/mcp.json
# Claude Desktop (macOS):
#   CONFIG=~/Library/Application\ Support/Claude/claude_desktop_config.json
#   jq 'del(.mcpServers.akiflow)' "$CONFIG" > "$CONFIG".new && mv "$CONFIG".new "$CONFIG"

# 1b. 공유 HTTP 서버를 썼다면
systemctl --user disable --now akiflow-mcp
rm -f ~/.config/systemd/user/akiflow-mcp.service ~/.config/akiflow/mcp-http-token
systemctl --user daemon-reload

# 2. PATH 링크 제거
rm -f ~/.local/bin/af

# 3. (선택) 컴파일된 바이너리 삭제
rm -rf dist/

# 4. (선택) 저장된 인증 정보 폐기
bun run src/index.ts auth logout    # 또는: rm ~/.config/akiflow/auth.json

# 5. 에디터 재시작
```

## 면책

[DISCLAIMER.md](./DISCLAIMER.md) 를 참고하세요.

## 라이선스

MIT © kty1965
