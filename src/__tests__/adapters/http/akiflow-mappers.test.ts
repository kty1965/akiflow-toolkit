import { describe, expect, test } from "bun:test";
import {
  asDataArray,
  eventOccursOnDate,
  mapCalendar,
  mapCalendarEvent,
  mapMeetingBrief,
  mapRecording,
} from "@adapters/http/akiflow-mappers.ts";

describe("akiflow-mappers", () => {
  describe("mapCalendarEvent", () => {
    test("maps v5-style start_datetime/end_datetime/calendar_id (raw API shape)", () => {
      // Given: a raw event using the v5-documented field names
      const raw = {
        id: "evt-1",
        title: "Standup",
        start_datetime: "2026-04-20T09:00:00Z",
        end_datetime: "2026-04-20T09:30:00Z",
        calendar_id: "cal-1",
      };

      // When: mapping to the domain CalendarEvent
      const event = mapCalendarEvent(raw);

      // Then: fields are mapped to the camelCase domain shape
      expect(event).toEqual({
        id: "evt-1",
        title: "Standup",
        start: "2026-04-20T09:00:00Z",
        end: "2026-04-20T09:30:00Z",
        calendarId: "cal-1",
      });
    });

    test("falls back to start_time/end_time (v3 write-payload field names) when start_datetime is absent", () => {
      // Given: a raw event using the v3 write-payload field names instead
      const raw = {
        id: "evt-2",
        title: "1:1",
        start_time: "2026-04-20T10:00:00Z",
        end_time: "2026-04-20T10:30:00Z",
        calendar_id: "cal-1",
      };

      // When: mapping to the domain CalendarEvent
      const event = mapCalendarEvent(raw);

      // Then: start/end fall back to start_time/end_time
      expect(event.start).toBe("2026-04-20T10:00:00Z");
      expect(event.end).toBe("2026-04-20T10:30:00Z");
    });

    test("falls back to start_date/end_date for all-day events", () => {
      // Given: an all-day event with only date fields set
      const raw = {
        id: "evt-3",
        title: "Holiday",
        start_date: "2026-04-20",
        end_date: "2026-04-20",
        calendar_id: "cal-1",
      };

      // When: mapping to the domain CalendarEvent
      const event = mapCalendarEvent(raw);

      // Then: start/end are derived from the date-only fields
      expect(event.start).toBe("2026-04-20T00:00:00Z");
      expect(event.end).toBe("2026-04-20T23:59:59Z");
    });

    test("degrades gracefully instead of throwing when fields are entirely missing", () => {
      // Given: a malformed/unexpected raw event (this is the exact shape of the
      // regression this mapper fixes — previously `.start` was `undefined` and
      // callers crashed on `undefined.localeCompare(...)`)
      const raw = { id: "evt-4" };

      // When: mapping to the domain CalendarEvent
      const event = mapCalendarEvent(raw);

      // Then: start/end are empty strings, not undefined — callers can safely call string methods
      expect(event.start).toBe("");
      expect(event.end).toBe("");
      expect(typeof event.start).toBe("string");
    });
  });

  describe("eventOccursOnDate", () => {
    test("matches a single-day timed event on its own date", () => {
      // Given: an event mapped from a single-day timed raw event
      const event = mapCalendarEvent({ start_time: "2026-04-20T09:00:00Z", end_time: "2026-04-20T09:30:00Z" });

      // Then: it occurs on that date and no other
      expect(eventOccursOnDate(event, "2026-04-20")).toBe(true);
      expect(eventOccursOnDate(event, "2026-04-19")).toBe(false);
      expect(eventOccursOnDate(event, "2026-04-21")).toBe(false);
    });

    test("matches every day of a multi-day span", () => {
      // Given: an event spanning three days (e.g. an all-day multi-day event)
      const event = mapCalendarEvent({ start_date: "2026-04-20", end_date: "2026-04-22" });

      // Then: it occurs on the start day, an in-between day, and the end day
      expect(eventOccursOnDate(event, "2026-04-20")).toBe(true);
      expect(eventOccursOnDate(event, "2026-04-21")).toBe(true);
      expect(eventOccursOnDate(event, "2026-04-22")).toBe(true);
      expect(eventOccursOnDate(event, "2026-04-23")).toBe(false);
    });

    test("excludes an event with no start info at all", () => {
      // Given: a malformed raw event with neither timed nor all-day fields
      const event = mapCalendarEvent({ id: "evt-4" });

      // Then: it matches no date (empty start, not "every date")
      expect(eventOccursOnDate(event, "2026-04-20")).toBe(false);
    });
  });

  describe("mapCalendar", () => {
    test("maps raw snake_case identity fields to the camelCase domain Calendar", () => {
      // Given: a raw calendar object with Akiflow's real (verified) field names
      const raw = {
        id: "cal-1",
        title: "Work",
        connector_id: "google",
        timezone: "Asia/Seoul",
        color: "#00ff00",
        origin_id: "origin-abc",
        akiflow_account_id: "aki-acc-1",
        origin_account_id: "origin-acc-1",
        read_only: false,
      };

      // When: mapping to the domain Calendar
      const calendar = mapCalendar(raw);

      // Then: every identity field needed by createEvent's write envelope is present
      expect(calendar).toEqual({
        id: "cal-1",
        name: "Work",
        provider: "google",
        timezone: "Asia/Seoul",
        color: "#00ff00",
        originId: "origin-abc",
        akiflowAccountId: "aki-acc-1",
        originAccountId: "origin-acc-1",
        readOnly: false,
      });
    });

    test("read_only:true maps to readOnly:true (createEvent must reject these)", () => {
      // Given: a read-only calendar
      const raw = { id: "cal-2", title: "Holidays", read_only: true };

      // When: mapping to the domain Calendar
      const calendar = mapCalendar(raw);

      // Then: readOnly is true
      expect(calendar.readOnly).toBe(true);
    });
  });

  describe("mapRecording", () => {
    test("flattens nested data.* fields and transcript entries into the domain Recording", () => {
      // Given: a raw recording matching aki.akiflow.com/api/v1/recordings shape
      const raw = {
        id: "rec-1",
        data: {
          title: "Planning meeting",
          startTime: "2026-04-20T09:00:00Z",
          endTime: "2026-04-20T09:30:00Z",
          summary: "Discussed roadmap",
          actionItems: [{ id: "ai-1", title: "Write doc", dueDate: "2026-04-25" }],
          transcript: [
            {
              speakerName: "Alice",
              paragraph: "Let's start.",
              startTimestamp: { absolute: "2026-04-20T09:00:05Z", relative: 5 },
            },
          ],
        },
      };

      // When: mapping to the domain Recording
      const recording = mapRecording(raw);

      // Then: nested fields are flattened to the top level
      expect(recording.id).toBe("rec-1");
      expect(recording.title).toBe("Planning meeting");
      expect(recording.summary).toBe("Discussed roadmap");
      expect(recording.actionItems).toEqual([{ id: "ai-1", title: "Write doc", dueDate: "2026-04-25" }]);
      expect(recording.transcript).toEqual([{ speakerName: "Alice", paragraph: "Let's start.", startTimeSec: 5 }]);
    });

    test("degrades gracefully when data/actionItems/transcript are missing", () => {
      // Given: a bare recording with no `data` payload
      const raw = { id: "rec-2" };

      // When: mapping to the domain Recording
      const recording = mapRecording(raw);

      // Then: empty collections instead of throwing
      expect(recording.actionItems).toEqual([]);
      expect(recording.transcript).toEqual([]);
      expect(recording.summary).toBeNull();
    });
  });

  describe("mapMeetingBrief", () => {
    test("maps id/originEventId/data", () => {
      // Given: a raw meeting brief
      const raw = { id: "brief-1", originEventId: "evt-9", data: { attendees: ["a@x.com"] } };

      // When: mapping to the domain MeetingBrief
      const brief = mapMeetingBrief(raw);

      // Then: fields map through, opaque data is preserved
      expect(brief.id).toBe("brief-1");
      expect(brief.originEventId).toBe("evt-9");
      expect(brief.data).toEqual({ attendees: ["a@x.com"] });
    });
  });

  describe("asDataArray", () => {
    test("passes through a bare array unchanged", () => {
      // Given/When
      const result = asDataArray([{ id: "a" }, { id: "b" }]);
      // Then
      expect(result).toEqual([{ id: "a" }, { id: "b" }]);
    });

    test("unwraps a { data: [...] } envelope", () => {
      // Given/When
      const result = asDataArray({ data: [{ id: "a" }] });
      // Then
      expect(result).toEqual([{ id: "a" }]);
    });

    test("wraps a single bare object with an id into a one-element array", () => {
      // Given/When
      const result = asDataArray({ id: "a" });
      // Then
      expect(result).toEqual([{ id: "a" }]);
    });

    test("returns an empty array for unrecognized shapes", () => {
      // Given/When/Then
      expect(asDataArray(null)).toEqual([]);
      expect(asDataArray(undefined)).toEqual([]);
      expect(asDataArray("unexpected")).toEqual([]);
    });
  });
});
