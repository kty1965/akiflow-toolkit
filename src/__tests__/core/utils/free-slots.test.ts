import { describe, expect, test } from "bun:test";
import type { CalendarEvent } from "@core/types.ts";
import {
  computeFreeSlots,
  computeFreeSlotsByDate,
  extractLocalMinutes,
  hhmmToMinutes,
  minutesToHhmm,
} from "@core/utils/free-slots.ts";

function ev(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "ev",
    title: "Meeting",
    start: "2026-04-16T10:00:00",
    end: "2026-04-16T11:00:00",
    calendarId: "cal",
    ...overrides,
  };
}

describe("core/utils/free-slots", () => {
  describe("computeFreeSlots", () => {
    test("empty events → single full-window slot", () => {
      // Given: no events
      // When: computing with 09:00-18:00 window
      const slots = computeFreeSlots([], "2026-04-16", "09:00", "18:00");

      // Then: one slot covering the entire window
      expect(slots).toEqual([{ start: "09:00", end: "18:00" }]);
    });

    test("one mid-window event → two slots around it", () => {
      // Given: a lunch event at 12-13
      const events = [ev({ start: "2026-04-16T12:00:00", end: "2026-04-16T13:00:00" })];

      // When: computing
      const slots = computeFreeSlots(events, "2026-04-16", "09:00", "18:00");

      // Then: gaps before and after the event
      expect(slots).toEqual([
        { start: "09:00", end: "12:00" },
        { start: "13:00", end: "18:00" },
      ]);
    });

    test("overlapping events are merged before computing gaps", () => {
      // Given: two overlapping events (10-11, 10:30-12)
      const events = [
        ev({ id: "a", start: "2026-04-16T10:00:00", end: "2026-04-16T11:00:00" }),
        ev({ id: "b", start: "2026-04-16T10:30:00", end: "2026-04-16T12:00:00" }),
      ];

      // When: computing
      const slots = computeFreeSlots(events, "2026-04-16", "09:00", "18:00");

      // Then: single merged busy block 10-12 splits window into 09-10 and 12-18
      expect(slots).toEqual([
        { start: "09:00", end: "10:00" },
        { start: "12:00", end: "18:00" },
      ]);
    });

    test("events outside the window are clamped/ignored", () => {
      // Given: an early event 07-08 and a late event 19-20 outside 09-18
      const events = [
        ev({ id: "early", start: "2026-04-16T07:00:00", end: "2026-04-16T08:00:00" }),
        ev({ id: "late", start: "2026-04-16T19:00:00", end: "2026-04-16T20:00:00" }),
      ];

      // When: computing
      const slots = computeFreeSlots(events, "2026-04-16", "09:00", "18:00");

      // Then: the full window remains free
      expect(slots).toEqual([{ start: "09:00", end: "18:00" }]);
    });

    test("event on a different date is clamped to window edge and ignored", () => {
      // Given: event dated one day earlier (ymd < fallbackDate path)
      const events = [ev({ start: "2026-04-15T23:00:00", end: "2026-04-15T23:30:00" })];

      // When: computing on 2026-04-16
      const slots = computeFreeSlots(events, "2026-04-16", "09:00", "18:00");

      // Then: the full window remains free
      expect(slots).toEqual([{ start: "09:00", end: "18:00" }]);
    });

    test("inverted window (end <= start) → empty slots", () => {
      // Given: 18:00-09:00 (inverted)
      // When: computing
      const slots = computeFreeSlots([], "2026-04-16", "18:00", "09:00");

      // Then: no slots produced
      expect(slots).toEqual([]);
    });
  });

  describe("computeFreeSlotsByDate", () => {
    test("applies computeFreeSlots independently per date", () => {
      // Given: two dates with different event loads
      const byDate = {
        "2026-04-16": [ev({ start: "2026-04-16T12:00:00", end: "2026-04-16T13:00:00" })],
        "2026-04-17": [] as CalendarEvent[],
      };

      // When: computing
      const out = computeFreeSlotsByDate(byDate, "09:00", "18:00");

      // Then: each date gets its own slots
      expect(out["2026-04-16"]).toEqual([
        { start: "09:00", end: "12:00" },
        { start: "13:00", end: "18:00" },
      ]);
      expect(out["2026-04-17"]).toEqual([{ start: "09:00", end: "18:00" }]);
    });
  });

  describe("low-level helpers", () => {
    test("hhmmToMinutes / minutesToHhmm round-trip", () => {
      // Given/When/Then: round-trip preserves value with zero-padding
      expect(hhmmToMinutes("09:30")).toBe(570);
      expect(minutesToHhmm(570)).toBe("09:30");
      expect(minutesToHhmm(0)).toBe("00:00");
      expect(minutesToHhmm(1439)).toBe("23:59");
    });

    test("extractLocalMinutes ignores timezone and clamps by date", () => {
      // Same day → parsed HH:MM returned as minutes
      expect(extractLocalMinutes("2026-04-16T13:45:00Z", "2026-04-16")).toBe(13 * 60 + 45);
      // Earlier day → 0 (clamp to window start)
      expect(extractLocalMinutes("2026-04-15T23:00:00", "2026-04-16")).toBe(0);
      // Later day → 24*60 (clamp to window end)
      expect(extractLocalMinutes("2026-04-17T01:00:00", "2026-04-16")).toBe(24 * 60);
      // Garbage ISO → 0
      expect(extractLocalMinutes("not-an-iso", "2026-04-16")).toBe(0);
    });
  });
});
