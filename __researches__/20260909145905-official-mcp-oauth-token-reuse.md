---
title: "공식 Akiflow MCP의 OAuth 토큰을 우리 인증에 재사용할 수 있는가"
createdAt: 2026-09-09T14:59:05+09:00
updatedAt: 2026-09-09T14:59:05+09:00
version: "1.0.0"
type: research
tags:
  - mcp
  - oauth
  - akiflow
  - authentication
---

## 1. 질문 (Why)

Discord에서 사용자가 제기: "공식 Akiflow MCP가 생겼는데, 이걸로 OAuth token을 획득해서
(우리 toolkit에) 쓸 수 있을지 검토해달라."

현재 `akiflow-toolkit`은 공식 API가 없어([ADR-0003](../docs/adr/ADR-0003-akiflow-authentication-strategy.md))
브라우저 쿠키/IndexedDB 역공학 + CDP 인터랙티브 로그인으로 토큰을 획득한다. 공식 MCP가
"진짜 OAuth"를 쓴다면 이 fragile한 경로를 표준 OAuth(PKCE + refresh_token)로 대체할 수
있지 않을까 하는 질문.

## 2. 조사 방법

로그인 불필요한 공개 discovery 엔드포인트만 조회(HTTP GET, 부작용 없음). 계정 로그인이
필요한 실제 토큰 발급·검증은 브라우저가 필요해 이번 세션(webhook, `claude-in-chrome`
미연결 확인됨 — `list_connected_browsers` → `[]`)에서는 진행하지 않음.

## 3. 발견 사실

### 3.1 공식 안내 (product.akiflow.com)

> "Your AI tool will prompt you to sign in with your Akiflow account when you connect."
> MCP 서버 URL: `https://mcp.akiflow.com/mcp`
> "You can also find this URL inside the Akiflow desktop app under Settings → MCP."
> 지원 클라이언트: Claude, ChatGPT, Cursor, Windsurf

URL 자체엔 토큰이 없고(모든 사용자 공통 고정 URL), "연결 시 로그인 프롬프트"라는
설명은 MCP Authorization spec(2025-06-18)의 표준 흐름(401 + `WWW-Authenticate` →
`.well-known/oauth-protected-resource` 탐색 → OAuth 2.1 인가)과 부합.

### 3.2 `GET https://mcp.akiflow.com/.well-known/oauth-protected-resource`

```
resource: "https://mcp.akiflow.com/mcp"
authorization_servers: ["https://web.akiflow.com"]
bearer_methods_supported: ["header"]
scopes_supported: ["mcp:read", "mcp:write"]
resource_name: "Akiflow MCP"
```

### 3.3 `GET https://web.akiflow.com/.well-known/oauth-authorization-server`

```
issuer: "https://web.akiflow.com"
authorization_endpoint: "https://web.akiflow.com/oauth/authorize"
token_endpoint: "https://web.akiflow.com/oauth/token"
registration_endpoint: "https://web.akiflow.com/oauth/register"
response_types_supported: ["code"]
grant_types_supported: ["authorization_code", "refresh_token"]
code_challenge_methods_supported: ["S256"]
scopes_supported: ["mcp:read", "mcp:write"]
jwks_uri: "https://web.akiflow.com/.well-known/jwks.json"
token_endpoint_auth_methods_supported: ["none"]
resource_indicators_supported: false
```

→ **Dynamic Client Registration(RFC 7591) + PKCE(S256) + `refresh_token` grant를 지원하는
정식 OAuth 2.1 서버**. Public client(`token_endpoint_auth_methods_supported: ["none"]`)라
client secret 없이 CLI/데스크톱 앱이 스스로 등록해 붙을 수 있음.

### 3.4 우리가 이미 쓰고 있는 legacy 경로와 비교

`src/adapters/http/token-refresh.ts`:

```
TOKEN_URL = "https://web.akiflow.com/oauth/refreshToken"   // 주의: /oauth/token 아님
CLIENT_ID = "10"
```

같은 `web.akiflow.com` 호스트지만 **경로도, client_id 체계도 다른 별개의 OAuth
"앱"**이다. 이쪽은 Akiflow 데스크톱/웹 클라이언트 자신의 내부 client(`10`)를 CDP/
브라우저 스토리지에서 역공학으로 뽑아 쓰는 것이고([ADR-0003](../docs/adr/ADR-0003-akiflow-authentication-strategy.md)),
공식 문서화된 등록 경로가 없다.

## 4. 분석

질문을 두 갈래로 분리해야 정확하다.

### (A) "MCP OAuth로 받은 토큰을 우리 REST 어댑터(`/v5/tasks`, `/v3/events` 등)에
꽂아 쓸 수 있는가?"

**가능성 낮음, 실증 전 결론.** 근거:

- `scopes_supported`가 `mcp:read`/`mcp:write` **둘뿐**이다. 우리가 지금 호출하는
  reverse-engineered API가 요구하는 것으로 보이는 넓은 범위(임의 필드 read/write)와
  스코프 체계 자체가 다르다.
- 같은 issuer(`web.akiflow.com`)라도 §3.4처럼 legacy 클라이언트(`client_id=10`,
  `/oauth/refreshToken`)와 신규 MCP 전용 앱(`/oauth/register`+`/oauth/token`)이
  경로·등록 방식 모두 분리되어 있다 — 별도 OAuth 애플리케이션으로 설계됐다는 신호.
  일반적으로 이런 구성에서는 발급되는 access token의 `scope`(및 종종 `aud`) 클레임이
  발급 근거가 된 앱/스코프로 제한되고, 백엔드 API가 엔드포인트별로 스코프를 검사하면
  `mcp:read`/`mcp:write` 토큰은 `/v5/*` 원본 REST 엔드포인트에서 거부될 공산이 크다.
- `resource_indicators_supported: false`는 "audience를 세분화해서 좁힌다"가 아니라
  "RFC 8707 `resource` 파라미터 자체를 안 받는다"는 뜻이라, 이 서버가 MCP 리소스
  전용으로 별도 운영되고 있다는 정황과 모순되지 않는다(오히려 이 AS가 MCP 하나만을
  위해 만들어졌다면 애초에 resource indicator가 필요 없다).
- **단, 확정하려면 실제 토큰을 까봐야 한다.** `jwks_uri`가 공개돼 있어 로그인 후 받은
  JWT의 `aud`/`scope` 클레임은 서명 검증 없이도 디코드해 확인 가능하고, 최종 확인은
  그 토큰으로 `GET /v5/tasks?limit=1` 1회 read-only 호출을 시도해보는 것뿐이다. 이건
  사람이 브라우저에서 최초 1회 로그인해야 하는 단계라 이번 세션에서는 못 함(§5).

### (B) "그 표준 OAuth 흐름 자체를 우리 인증 방식으로 채택해서, toolkit이 REST를 직접
치는 대신 `mcp.akiflow.com`의 MCP client가 되면 어떤가?"

이건 (A)와 완전히 다른, 오히려 더 유망할 수 있는 방향이다.

- 장점: PKCE + DCR + `refresh_token` grant는 표준 라이브러리로 구현 가능한 정식
  플로우다. CDP로 로컬 Chrome을 띄우고 사람이 5분 안에 로그인하길 폴링 대기하는
  현재 방식([ADR-0003](../docs/adr/ADR-0003-akiflow-authentication-strategy.md) Tier
  3b, `cdp-launcher.ts`)이나, IndexedDB LevelDB를 정규식으로 파싱하는 방식보다
  근본적으로 덜 취약하고, headless 서버 환경에서도 "브라우저로 인가 코드 발급 URL
  열기 → 로컬 콜백 리스너로 code 수신"만 가능하면 동작한다.
- 단점: 이렇게 전환하면 toolkit이 낼 수 있는 기능의 상한이 **공식 MCP가 노출하는
  tool 목록**으로 제한된다. 기존 조사
  ([`__suggestions__/20260816153713-mcp-tool-coverage-vs-official-community.md`](../__suggestions__/20260816153713-mcp-tool-coverage-vs-official-community.md)
  §2)에 따르면 공식 MCP가 우리보다 앞서는 영역(update/delete_event, Meeting
  Assistant, someday)도 있지만, 우리가 이미 reverse-engineering으로 확보한 영역
  (Time Slot 4종, Project/Tag 일부 CRUD, `links`/`deadline`/`tags` 필드, subtask
  원샷 생성 등)이 공식 MCP tool로 노출된다는 언급은 없다 — 전면 전환은 기능 후퇴
  리스크가 크다. "REST 어댑터를 완전히 대체"가 아니라 "REST 실패 시 보완 경로" 정도로
  검토하는 게 현실적이다.

### ToS/윤리 메모

DCR로 임시 client를 등록하고 본인 계정으로 PKCE 로그인하는 것 자체는 Akiflow가 공식
문서에서 Claude/ChatGPT/Cursor/Windsurf를 위해 명시적으로 공개한 의도된 사용이라
문제없다. 다만 그렇게 받은 `mcp:read`/`mcp:write` 토큰을 의도된 리소스
(`mcp.akiflow.com`) 밖의 미문서화 REST 엔드포인트에 상시적으로 사용하는 것은, 설령
기술적으로 통과되더라도 resource indicator 스펙의 취지(발급 근거가 된 리소스 밖에서
쓰지 않기)에 반하는 재사용이다. 1회성 read-only 실증(§5 절차)까지는 리스크가 낮지만,
이걸 정식 운영 방식으로 채택하는 것은 권장하지 않는다.

## 5. 다음 단계 (브라우저 세션 필요 — 사람이 1회 로그인)

1. `POST https://web.akiflow.com/oauth/register`로 임시 public client 등록.
2. PKCE(S256)로 `authorization_endpoint`에 브라우저를 열어 사람이 로그인/동의.
3. 로컬 콜백으로 받은 `code`를 `token_endpoint`에 교환 → `access_token`/`refresh_token`.
4. `jwks_uri`로 JWT 디코드해 `aud`/`scope` 클레임 확인.
5. 그 토큰으로 `GET /v5/tasks?limit=1` 1회 read-only 호출 → 200/401 여부로 (A) 확정.
6. 결과에 따라 `docs/adr/ADR-0003-akiflow-authentication-strategy.md`의 Revisit
   Trigger("Akiflow가 공식 API 출시 시") 해당 여부 판단 — 이 MCP가 "공식 API"의
   조건을 충족하는지는 애매하므로(범용 API가 아니라 AI-tool 전용 좁은 표면), 트리거
   충족으로 단정하지 말고 (A)/(B) 실증 결과를 보고 별도로 결정.

## 6. 결론 요약

- **"만능 API 토큰을 얻어 REST 어댑터에 재사용"**: 가능성 낮음. 별도 스코프 전용 앱으로
  보이며, 최종 확인은 로그인 1회 필요(다음 브라우저 세션 과제).
- **"toolkit을 공식 MCP의 정식 OAuth client로 만들어 CDP/쿠키 스크래핑을 보완·대체"**:
  기술적으로 유망하나 기능 커버리지 트레이드오프가 있어 전면 대체보다는 보완 경로로
  검토 권장.

## 7. 근거 자료

- https://product.akiflow.com/en/help/articles/4302815-akiflow-mcp
- https://mcp.akiflow.com/.well-known/oauth-protected-resource
- https://web.akiflow.com/.well-known/oauth-authorization-server
- `src/adapters/http/token-refresh.ts` (legacy client_id=10 refresh 경로)
- [ADR-0003: Akiflow 인증 전략](../docs/adr/ADR-0003-akiflow-authentication-strategy.md)
- [`__suggestions__/20260816153713-mcp-tool-coverage-vs-official-community.md`](../__suggestions__/20260816153713-mcp-tool-coverage-vs-official-community.md)
