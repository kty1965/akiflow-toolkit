import { afterEach, describe, expect, test } from "bun:test";
import { refreshAccessToken } from "../../../adapters/http/token-refresh.ts";
import { AuthExpiredError, NetworkError } from "../../../core/errors/index.ts";
import type { TokenRefreshResponse } from "../../../core/types.ts";

const originalFetch = globalThis.fetch;

const validResponse: TokenRefreshResponse = {
  token_type: "Bearer",
  expires_in: 3600,
  access_token: "new_access_token_abc",
  refresh_token: "original_refresh_token",
};

function mockFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

describe("adapters/http/token-refresh", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("successful refresh", () => {
    test("returns TokenRefreshResponse on 200", async () => {
      // Given: the server responds with valid token data
      mockFetch(async () => new Response(JSON.stringify(validResponse), { status: 200 }));

      // When: refreshing with a valid refresh token
      const result = await refreshAccessToken("my_refresh_token");

      // Then: returns the parsed response
      expect(result.access_token).toBe("new_access_token_abc");
      expect(result.token_type).toBe("Bearer");
      expect(result.expires_in).toBe(3600);
    });

    test("sends correct request body", async () => {
      // Given: a fetch mock that captures the request body
      let capturedBody: string | undefined;
      mockFetch(async (_input, init) => {
        capturedBody = init?.body as string;
        return new Response(JSON.stringify(validResponse), { status: 200 });
      });

      // When: refreshing
      await refreshAccessToken("test_token_123");

      // Then: request body contains client_id and refresh_token
      const parsed = JSON.parse(capturedBody as string);
      expect(parsed.client_id).toBe("10");
      expect(parsed.refresh_token).toBe("test_token_123");
    });
  });

  describe("auth errors", () => {
    test("401 throws AuthExpiredError", async () => {
      // Given: the server responds with 401
      mockFetch(async () => new Response("Unauthorized", { status: 401 }));

      // When/Then: throws AuthExpiredError
      await expect(refreshAccessToken("expired_token")).rejects.toBeInstanceOf(AuthExpiredError);
    });

    test("403 throws AuthExpiredError", async () => {
      // Given: the server responds with 403
      mockFetch(async () => new Response("Forbidden", { status: 403 }));

      // When/Then: throws AuthExpiredError
      await expect(refreshAccessToken("revoked_token")).rejects.toBeInstanceOf(AuthExpiredError);
    });
  });

  describe("server errors with retry", () => {
    test("503 retries then succeeds", async () => {
      // Given: the server fails once with 503, then succeeds
      let attempts = 0;
      mockFetch(async () => {
        attempts++;
        if (attempts === 1) {
          return new Response("Service Unavailable", { status: 503 });
        }
        return new Response(JSON.stringify(validResponse), { status: 200 });
      });

      // When: refreshing (policy allows 2 attempts)
      const result = await refreshAccessToken("my_token");

      // Then: retried and succeeded
      expect(attempts).toBe(2);
      expect(result.access_token).toBe("new_access_token_abc");
    });

    test("persistent 500 throws NetworkError after max retries", async () => {
      // Given: the server always returns 500
      mockFetch(async () => new Response("Internal Server Error", { status: 500 }));

      // When/Then: throws NetworkError after exhausting retries
      await expect(refreshAccessToken("my_token")).rejects.toBeInstanceOf(NetworkError);
    });
  });

  describe("rotation detection", () => {
    test("returns new refresh_token when rotated", async () => {
      // Given: the server responds with a different refresh_token
      const rotatedResponse: TokenRefreshResponse = {
        ...validResponse,
        refresh_token: "new_rotated_refresh_token",
      };
      mockFetch(async () => new Response(JSON.stringify(rotatedResponse), { status: 200 }));

      // When: refreshing with the original token
      const result = await refreshAccessToken("original_refresh_token");

      // Then: the response contains the new refresh_token (caller decides whether to save)
      expect(result.refresh_token).toBe("new_rotated_refresh_token");
      expect(result.refresh_token).not.toBe("original_refresh_token");
    });

    test("returns same refresh_token when not rotated", async () => {
      // Given: the server responds with the same refresh_token
      mockFetch(async () => new Response(JSON.stringify(validResponse), { status: 200 }));

      // When: refreshing
      const result = await refreshAccessToken("original_refresh_token");

      // Then: refresh_token unchanged
      expect(result.refresh_token).toBe("original_refresh_token");
    });
  });
});
