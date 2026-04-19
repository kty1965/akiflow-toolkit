import { describe, expect, test } from "bun:test";
import {
  AkiflowError,
  ApiSchemaError,
  AuthError,
  AuthExpiredError,
  AuthSourceMissingError,
  BrowserDataError,
  NetworkError,
  NotFoundError,
  ValidationError,
} from "@core/errors/index.ts";

describe("core/errors", () => {
  describe("AkiflowError", () => {
    test("is abstract and cannot be instantiated directly", () => {
      // Given: AkiflowError is abstract
      // Then: it has no concrete constructor usable directly
      expect(AkiflowError.prototype).toBeDefined();
    });
  });

  describe("AuthError", () => {
    test("has correct code and userMessage", () => {
      // Given: an AuthError
      const err = new AuthError("auth failed");

      // Then: code and userMessage are set
      expect(err.code).toBe("AUTH_GENERIC");
      expect(err.userMessage).toBe("인증이 필요합니다.");
      expect(err.hint).toBe("터미널에서 'af auth'를 실행하세요.");
    });

    test("instanceof chain: AuthError → AkiflowError → Error", () => {
      // Given: an AuthError
      const err = new AuthError("test");

      // Then: instanceof chain is correct
      expect(err instanceof AuthError).toBe(true);
      expect(err instanceof AkiflowError).toBe(true);
      expect(err instanceof Error).toBe(true);
    });

    test("preserves cause chain", () => {
      // Given: an AuthError with a cause
      const cause = new Error("original problem");
      const err = new AuthError("auth failed", cause);

      // Then: cause is accessible
      expect(err.cause).toBe(cause);
      expect(err.cause?.message).toBe("original problem");
    });

    test("name is set to constructor name", () => {
      // Given: an AuthError
      const err = new AuthError("test");

      // Then: name matches class name
      expect(err.name).toBe("AuthError");
    });
  });

  describe("AuthExpiredError", () => {
    test("extends AuthError with overridden code", () => {
      // Given: an AuthExpiredError
      const err = new AuthExpiredError("token expired");

      // Then: has overridden code and is still an AuthError
      expect(err.code).toBe("AUTH_EXPIRED");
      expect(err.userMessage).toBe("인증이 만료되었습니다.");
      expect(err instanceof AuthError).toBe(true);
      expect(err instanceof AkiflowError).toBe(true);
    });
  });

  describe("AuthSourceMissingError", () => {
    test("extends AuthError with correct code", () => {
      // Given: an AuthSourceMissingError
      const err = new AuthSourceMissingError("no source found");

      // Then
      expect(err.code).toBe("AUTH_SOURCE_MISSING");
      expect(err instanceof AuthError).toBe(true);
    });
  });

  describe("NetworkError", () => {
    test("has status field", () => {
      // Given: a NetworkError with status
      const err = new NetworkError("server error", 500);

      // Then
      expect(err.code).toBe("NETWORK_GENERIC");
      expect(err.status).toBe(500);
      expect(err instanceof AkiflowError).toBe(true);
    });

    test("status is optional", () => {
      // Given: a NetworkError without status
      const err = new NetworkError("connection refused");

      // Then
      expect(err.status).toBeUndefined();
    });
  });

  describe("ApiSchemaError", () => {
    test("extends NetworkError with overridden code", () => {
      // Given: an ApiSchemaError
      const err = new ApiSchemaError("unexpected response shape", 200);

      // Then
      expect(err.code).toBe("API_SCHEMA_MISMATCH");
      expect(err.status).toBe(200);
      expect(err instanceof NetworkError).toBe(true);
      expect(err instanceof AkiflowError).toBe(true);
    });
  });

  describe("ValidationError", () => {
    test("has field property", () => {
      // Given: a ValidationError with field
      const err = new ValidationError("invalid date format", "date");

      // Then
      expect(err.code).toBe("VALIDATION");
      expect(err.field).toBe("date");
      expect(err instanceof AkiflowError).toBe(true);
    });
  });

  describe("NotFoundError", () => {
    test("has resourceType property", () => {
      // Given: a NotFoundError with resource type
      const err = new NotFoundError("task not found", "task");

      // Then
      expect(err.code).toBe("NOT_FOUND");
      expect(err.resourceType).toBe("task");
      expect(err instanceof AkiflowError).toBe(true);
    });
  });

  describe("BrowserDataError", () => {
    test("has correct code and userMessage", () => {
      // Given: a BrowserDataError
      const err = new BrowserDataError("could not read IndexedDB");

      // Then
      expect(err.code).toBe("BROWSER_DATA");
      expect(err.userMessage).toBe("브라우저 데이터에서 토큰을 추출하지 못했습니다.");
      expect(err instanceof AkiflowError).toBe(true);
    });
  });

  describe("error code uniqueness", () => {
    test("all error classes have distinct codes", () => {
      // Given: instances of all error types
      const errors = [
        new AuthError("a"),
        new AuthExpiredError("b"),
        new AuthSourceMissingError("c"),
        new NetworkError("d"),
        new ApiSchemaError("e"),
        new ValidationError("f"),
        new NotFoundError("g"),
        new BrowserDataError("h"),
      ];

      // When: collecting codes
      const codes = errors.map((e) => e.code);

      // Then: all codes are unique
      expect(new Set(codes).size).toBe(codes.length);
    });
  });
});
