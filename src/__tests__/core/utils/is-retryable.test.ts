import { describe, expect, test } from "bun:test";
import { AuthError, AuthExpiredError, NetworkError, ValidationError } from "@core/errors/index.ts";
import { isRetryable } from "@core/utils/is-retryable.ts";

describe("core/utils/is-retryable", () => {
  describe("NetworkError", () => {
    test("500 status is retryable", () => {
      // Given: a NetworkError with 500 status
      const err = new NetworkError("server error", 500);

      // Then: it is retryable
      expect(isRetryable(err)).toBe(true);
    });

    test("503 status is retryable", () => {
      // Given: a NetworkError with 503 status
      const err = new NetworkError("service unavailable", 503);

      // Then: it is retryable
      expect(isRetryable(err)).toBe(true);
    });

    test("429 status is retryable", () => {
      // Given: a NetworkError with 429 status (rate limited)
      const err = new NetworkError("too many requests", 429);

      // Then: it is retryable
      expect(isRetryable(err)).toBe(true);
    });

    test("no status (connection error) is retryable", () => {
      // Given: a NetworkError with no status (e.g., DNS failure)
      const err = new NetworkError("connection refused");

      // Then: it is retryable (conservative: assume transient)
      expect(isRetryable(err)).toBe(true);
    });

    test("400 status is not retryable", () => {
      // Given: a NetworkError with 400 status (client error)
      const err = new NetworkError("bad request", 400);

      // Then: it is not retryable
      expect(isRetryable(err)).toBe(false);
    });

    test("404 status is not retryable", () => {
      // Given: a NetworkError with 404 status
      const err = new NetworkError("not found", 404);

      // Then: it is not retryable
      expect(isRetryable(err)).toBe(false);
    });
  });

  describe("AuthError", () => {
    test("AuthError is never retryable", () => {
      // Given: an AuthError
      const err = new AuthError("auth failed");

      // Then: not retryable
      expect(isRetryable(err)).toBe(false);
    });

    test("AuthExpiredError is never retryable", () => {
      // Given: an AuthExpiredError
      const err = new AuthExpiredError("token expired");

      // Then: not retryable (subclass of AuthError)
      expect(isRetryable(err)).toBe(false);
    });
  });

  describe("ValidationError", () => {
    test("ValidationError is never retryable", () => {
      // Given: a ValidationError
      const err = new ValidationError("invalid date", "date");

      // Then: not retryable
      expect(isRetryable(err)).toBe(false);
    });
  });

  describe("unknown errors", () => {
    test("plain Error is not retryable (conservative)", () => {
      // Given: a generic Error
      const err = new Error("something went wrong");

      // Then: not retryable (conservative default)
      expect(isRetryable(err)).toBe(false);
    });

    test("non-Error value is not retryable", () => {
      // Given: a thrown string (unusual but possible)
      // Then: not retryable
      expect(isRetryable("string error")).toBe(false);
    });
  });
});
