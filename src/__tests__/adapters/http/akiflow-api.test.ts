import { afterEach, describe, expect, test } from "bun:test";
import { AkiflowHttpAdapter } from "@adapters/http/akiflow-api.ts";
import { ApiSchemaError, NetworkError } from "@core/errors/index.ts";
import type { LoggerPort } from "@core/ports/logger-port.ts";
import type { ApiResponse, Task } from "@core/types.ts";

const originalFetch = globalThis.fetch;

function mockFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

function createLogger(): LoggerPort {
  return {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function makeTaskResponse(): ApiResponse<Task[]> {
  return {
    success: true,
    message: null,
    data: [],
  };
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers as Record<string, string>) ?? {};
}

describe("adapters/http/AkiflowHttpAdapter", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("request (generic)", () => {
    test("sends auth, client id, platform, version headers", async () => {
      // Given: a mock that captures the request
      let captured: { url: string; init?: RequestInit } | undefined;
      mockFetch(async (input, init) => {
        captured = { url: String(input), init };
        return new Response(JSON.stringify(makeTaskResponse()), { status: 200 });
      });
      const adapter = new AkiflowHttpAdapter("client-abc", createLogger());

      // When: request is made
      await adapter.getTasks("token-xyz");

      // Then: headers include all required tokens
      const headers = headersOf(captured?.init);
      expect(headers.Authorization).toBe("Bearer token-xyz");
      expect(headers["Akiflow-Client-Id"]).toBe("client-abc");
      expect(headers["Akiflow-Platform"]).toBe("mac");
      expect(headers["Akiflow-Version"]).toBe("3");
      expect(headers["Content-Type"]).toBe("application/json");
      expect(captured?.url).toBe("https://api.akiflow.com/v5/tasks");
      expect(captured?.init?.method).toBe("GET");
    });

    test("401 → NetworkError with status=401 (for withAuth refresh hook)", async () => {
      // Given: a server that returns 401
      mockFetch(async () => new Response("no", { status: 401 }));
      const adapter = new AkiflowHttpAdapter("c", createLogger());

      // When/Then: getTasks rejects with NetworkError status 401
      try {
        await adapter.getTasks("bad");
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(NetworkError);
        expect((err as NetworkError).status).toBe(401);
      }
    });

    test("5xx → NetworkError with status", async () => {
      // Given: the server returns 503
      mockFetch(async () => new Response("down", { status: 503 }));
      const adapter = new AkiflowHttpAdapter("c", createLogger());

      // When/Then: rejects with NetworkError carrying status
      try {
        await adapter.getTasks("t");
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(NetworkError);
        expect((err as NetworkError).status).toBe(503);
      }
    });

    test("invalid JSON body → ApiSchemaError", async () => {
      // Given: 200 OK but body is not JSON
      mockFetch(async () => new Response("not-json", { status: 200 }));
      const adapter = new AkiflowHttpAdapter("c", createLogger());

      // When/Then: rejects with ApiSchemaError
      await expect(adapter.getTasks("t")).rejects.toBeInstanceOf(ApiSchemaError);
    });

    test("missing data array → ApiSchemaError", async () => {
      // Given: valid JSON but no data array
      mockFetch(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
      const adapter = new AkiflowHttpAdapter("c", createLogger());

      // When/Then: schema validation rejects
      await expect(adapter.getTasks("t")).rejects.toBeInstanceOf(ApiSchemaError);
    });

    test("fetch throw → NetworkError (no status)", async () => {
      // Given: fetch itself throws (network down)
      mockFetch(async () => {
        throw new TypeError("network down");
      });
      const adapter = new AkiflowHttpAdapter("c", createLogger());

      // When/Then: wrapped as NetworkError without status
      try {
        await adapter.getTasks("t");
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(NetworkError);
        expect((err as NetworkError).status).toBeUndefined();
      }
    });
  });

  describe("getTasks", () => {
    test("no params → no query string", async () => {
      // Given: adapter with default base URL
      let capturedUrl = "";
      mockFetch(async (input) => {
        capturedUrl = String(input);
        return new Response(JSON.stringify(makeTaskResponse()), { status: 200 });
      });
      const adapter = new AkiflowHttpAdapter("c", createLogger());

      // When: getTasks called with no params
      await adapter.getTasks("t");

      // Then: URL has no query string
      expect(capturedUrl).toBe("https://api.akiflow.com/v5/tasks");
    });

    test("limit and sync_token → query string", async () => {
      // Given: params including sync_token
      let capturedUrl = "";
      mockFetch(async (input) => {
        capturedUrl = String(input);
        return new Response(JSON.stringify(makeTaskResponse()), { status: 200 });
      });
      const adapter = new AkiflowHttpAdapter("c", createLogger());

      // When: listed with both params
      await adapter.getTasks("t", { limit: 2500, sync_token: "tok1" });

      // Then: both appear in query
      expect(capturedUrl).toContain("limit=2500");
      expect(capturedUrl).toContain("sync_token=tok1");
    });

    test("maps raw `tags_ids` field to domain `tags` (live-probed: Akiflow has no `tags` field on tasks)", async () => {
      // Given: a raw /v5/tasks response shaped like the real API (tags_ids, no tags)
      mockFetch(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              message: null,
              data: [{ id: "t-1", title: "Sample", tags_ids: ["tag-a", "tag-b"] }],
            }),
            { status: 200 },
          ),
      );
      const adapter = new AkiflowHttpAdapter("c", createLogger());

      // When: getTasks is called
      const res = await adapter.getTasks("t");

      // Then: tags is populated from raw tags_ids
      expect(res.data[0]?.tags).toEqual(["tag-a", "tag-b"]);
    });

    test("maps missing `tags_ids` to an empty array, not undefined", async () => {
      // Given: a raw response with no tags_ids at all
      mockFetch(
        async () =>
          new Response(JSON.stringify({ success: true, message: null, data: [{ id: "t-1", title: "Sample" }] }), {
            status: 200,
          }),
      );
      const adapter = new AkiflowHttpAdapter("c", createLogger());

      // When: getTasks is called
      const res = await adapter.getTasks("t");

      // Then: tags defaults to [] so Array.isArray checks downstream stay safe
      expect(res.data[0]?.tags).toEqual([]);
    });
  });

  describe("getLabels", () => {
    test("maps raw `title` field to domain `name` (live-probed: Akiflow returns title, not name)", async () => {
      // Given: a raw /v5/labels response shaped like the real API (title, no name)
      mockFetch(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              message: null,
              data: [{ id: "lbl-1", title: "Sync", color: "palette-red", user_id: 1 }],
            }),
            { status: 200 },
          ),
      );
      const adapter = new AkiflowHttpAdapter("c", createLogger());

      // When: getLabels is called
      const res = await adapter.getLabels("t");

      // Then: the mapped Label has `name` populated from raw `title`
      expect(res.data).toEqual([{ id: "lbl-1", name: "Sync", color: "palette-red" }]);
    });
  });

  describe("getTags", () => {
    test("maps raw `title` field to domain `name`", async () => {
      // Given: a raw /v5/tags response shaped like the real API (title, no name)
      mockFetch(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              message: null,
              data: [{ id: "tag-1", title: "GovSaaS", user_id: 1 }],
            }),
            { status: 200 },
          ),
      );
      const adapter = new AkiflowHttpAdapter("c", createLogger());

      // When: getTags is called
      const res = await adapter.getTags("t");

      // Then: the mapped Tag has `name` populated from raw `title`
      expect(res.data).toEqual([{ id: "tag-1", name: "GovSaaS" }]);
    });
  });

  describe("time slots", () => {
    function rawSlot(overrides: Record<string, unknown> = {}) {
      return {
        id: "slot-1",
        calendar_id: "cal-primary",
        title: "Deep work",
        description: null,
        start_time: "2026-04-16T09:00:00.000Z",
        end_time: "2026-04-16T10:00:00.000Z",
        status: "confirmed",
        recurrence: null,
        ...overrides,
      };
    }

    test("getTimeSlots maps start_time/end_time/calendar_id to start/end/calendarId", async () => {
      // Given: a raw /v5/time_slots response shaped like the real API
      mockFetch(
        async () => new Response(JSON.stringify({ success: true, message: null, data: [rawSlot()] }), { status: 200 }),
      );
      const adapter = new AkiflowHttpAdapter("c", createLogger());

      // When: getTimeSlots is called
      const res = await adapter.getTimeSlots("t", "2026-04-16");

      // Then: the mapped TimeSlot uses the domain field names
      expect(res.data).toEqual([
        {
          id: "slot-1",
          calendarId: "cal-primary",
          title: "Deep work",
          description: null,
          start: "2026-04-16T09:00:00.000Z",
          end: "2026-04-16T10:00:00.000Z",
          status: "confirmed",
          recurrence: null,
        },
      ]);
    });

    test("createTimeSlot sends a PATCH /v5/time_slots upsert (task-style, no calendar-identity envelope)", async () => {
      // Given: a mock that captures method/url/body and echoes a slot back
      let captured: { method?: string; url?: string; body?: string } = {};
      mockFetch(async (input, init) => {
        captured = { method: init?.method, url: String(input), body: init?.body as string };
        return new Response(JSON.stringify({ success: true, message: null, data: [rawSlot()] }), { status: 200 });
      });
      const adapter = new AkiflowHttpAdapter("c", createLogger());

      // When: createTimeSlot is called
      const res = await adapter.createTimeSlot("t", {
        calendarId: "cal-primary",
        title: "Deep work",
        startDatetime: "2026-04-16T09:00:00+09:00",
        endDatetime: "2026-04-16T10:00:00+09:00",
      });

      // Then: PATCH to /v5/time_slots (not the v3 events envelope), and the response is mapped
      expect(captured.method).toBe("PATCH");
      expect(captured.url).toBe("https://api.akiflow.com/v5/time_slots");
      const sent = JSON.parse(captured.body ?? "[]")[0];
      expect(sent.calendar_id).toBe("cal-primary");
      expect(sent.title).toBe("Deep work");
      expect(res.data[0]?.title).toBe("Deep work");
    });

    test("updateTimeSlot sends only id/global_updated_at plus provided fields (true partial update)", async () => {
      // Given: a mock that captures the request body
      let capturedBody = "";
      mockFetch(async (_input, init) => {
        capturedBody = init?.body as string;
        return new Response(JSON.stringify({ success: true, message: null, data: [rawSlot({ title: "Renamed" })] }), {
          status: 200,
        });
      });
      const adapter = new AkiflowHttpAdapter("c", createLogger());

      // When: updateTimeSlot is called with only a title change
      await adapter.updateTimeSlot("t", { timeSlotId: "slot-1", title: "Renamed" });

      // Then: the payload has no start_time/end_time/calendar_id — only what changed
      const sent = JSON.parse(capturedBody)[0];
      expect(sent).toEqual({ id: "slot-1", global_updated_at: expect.any(String), title: "Renamed" });
    });

    test("deleteTimeSlot sends id + deleted_at (soft delete)", async () => {
      // Given: a mock that captures the request body
      let capturedBody = "";
      mockFetch(async (_input, init) => {
        capturedBody = init?.body as string;
        return new Response(JSON.stringify({ success: true, message: null, data: [rawSlot({ deleted_at: "now" })] }), {
          status: 200,
        });
      });
      const adapter = new AkiflowHttpAdapter("c", createLogger());

      // When: deleteTimeSlot is called
      await adapter.deleteTimeSlot("t", "slot-1");

      // Then: the payload sets deleted_at
      const sent = JSON.parse(capturedBody)[0];
      expect(sent.id).toBe("slot-1");
      expect(typeof sent.deleted_at).toBe("string");
    });
  });

  describe("patchTasks", () => {
    test("sends array body with method PATCH", async () => {
      // Given: a mock that captures method and body
      let captured: { method?: string; body?: string } = {};
      mockFetch(async (_input, init) => {
        captured = { method: init?.method, body: init?.body as string };
        return new Response(JSON.stringify({ success: true, message: null, data: [{ id: "x" }] }), { status: 200 });
      });
      const adapter = new AkiflowHttpAdapter("c", createLogger());

      // When: patch called with one task
      await adapter.patchTasks("t", [
        {
          id: "id1",
          title: "hello",
          global_created_at: "2026-04-16T00:00:00.000Z",
          global_updated_at: "2026-04-16T00:00:00.000Z",
        },
      ]);

      // Then: body is an array with the task
      expect(captured.method).toBe("PATCH");
      const parsed = JSON.parse(captured.body ?? "null");
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe("id1");
    });
  });

  describe("v3 endpoints", () => {
    test("getEvents uses /v3/events with date query", async () => {
      // Given: event fetch
      let capturedUrl = "";
      mockFetch(async (input) => {
        capturedUrl = String(input);
        return new Response(JSON.stringify({ success: true, message: null, data: [] }), { status: 200 });
      });
      const adapter = new AkiflowHttpAdapter("c", createLogger());

      // When: getEvents called
      await adapter.getEvents("t", "2026-04-16");

      // Then: v3 endpoint is used with encoded date
      expect(capturedUrl).toContain("/v3/events");
      expect(capturedUrl).toContain("date=2026-04-16");
    });

    test("getCalendars uses /v3/calendars", async () => {
      // Given: calendars fetch
      let capturedUrl = "";
      mockFetch(async (input) => {
        capturedUrl = String(input);
        return new Response(JSON.stringify({ success: true, message: null, data: [] }), { status: 200 });
      });
      const adapter = new AkiflowHttpAdapter("c", createLogger());

      // When: getCalendars called
      await adapter.getCalendars("t");

      // Then: v3 endpoint
      expect(capturedUrl).toBe("https://api.akiflow.com/v3/calendars");
    });
  });

  describe("custom base URL", () => {
    test("uses injected baseUrl", async () => {
      // Given: adapter configured with a staging URL
      let capturedUrl = "";
      mockFetch(async (input) => {
        capturedUrl = String(input);
        return new Response(JSON.stringify(makeTaskResponse()), { status: 200 });
      });
      const adapter = new AkiflowHttpAdapter("c", createLogger(), "https://staging.example");

      // When: getTasks is called
      await adapter.getTasks("t");

      // Then: request hits the injected base
      expect(capturedUrl).toBe("https://staging.example/v5/tasks");
    });
  });
});
