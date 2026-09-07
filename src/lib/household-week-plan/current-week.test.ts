import { describe, expect, it } from "vitest";

import { isWithinWeekWindow, resolveCurrentWeekWindow, selectCurrentWeekRows } from "./current-week";

describe("current household week selection", () => {
  it("resolves the Monday-to-Monday window containing today (BST)", () => {
    const window = resolveCurrentWeekWindow("2026-09-07T14:05:00.000Z");
    expect(window.startIso).toBe("2026-09-06T23:00:00.000Z"); // Mon 7 Sep 00:00 London
    expect(window.endIso).toBe("2026-09-13T23:00:00.000Z"); // Mon 14 Sep 00:00 London
    expect(window.timeZone).toBe("Europe/London");
  });

  it("uses the same week for any instant inside it", () => {
    const monday = resolveCurrentWeekWindow("2026-09-07T06:00:00.000Z");
    const sunday = resolveCurrentWeekWindow("2026-09-13T21:00:00.000Z");
    expect(sunday).toEqual(monday);
  });

  it("resolves a GMT (winter) week correctly", () => {
    const window = resolveCurrentWeekWindow("2026-01-14T12:00:00.000Z");
    expect(window.startIso).toBe("2026-01-12T00:00:00.000Z");
    expect(window.endIso).toBe("2026-01-19T00:00:00.000Z");
  });

  it("includes date-only rows in the week and excludes ones outside it", () => {
    const window = resolveCurrentWeekWindow("2026-09-07T14:05:00.000Z");
    expect(isWithinWeekWindow("2026-09-07", window)).toBe(true);
    expect(isWithinWeekWindow("2026-09-13", window)).toBe(true);
    expect(isWithinWeekWindow("2026-09-14", window)).toBe(false);
    expect(isWithinWeekWindow("2026-08-31", window)).toBe(false);
    expect(isWithinWeekWindow(undefined, window)).toBe(false);
    expect(isWithinWeekWindow("not a date", window)).toBe(false);
  });

  it("excludes stale August plans instead of filling the current week", () => {
    const window = resolveCurrentWeekWindow("2026-09-07T14:05:00.000Z");
    const rows = [
      { id: "aug-1", date: "2026-08-24" },
      { id: "aug-2", date: "2026-08-25" },
      { id: "sep-wed", date: "2026-09-09" },
      { id: "sep-mon", date: "2026-09-07" },
      { id: "next-week", date: "2026-09-15" },
      { id: "undated", date: null },
    ];

    const selection = selectCurrentWeekRows(rows, window, (row) => row.date);

    expect(selection.current.map((row) => row.id)).toEqual(["sep-mon", "sep-wed"]);
    expect(selection.excludedCount).toBe(4);
  });

  it("returns an empty current week rather than borrowing older plans", () => {
    const window = resolveCurrentWeekWindow("2026-09-07T14:05:00.000Z");
    const rows = Array.from({ length: 7 }, (_, index) => ({ id: `old-${index}`, date: `2026-08-0${index + 1}` }));

    const selection = selectCurrentWeekRows(rows, window, (row) => row.date);

    expect(selection.current).toEqual([]);
    expect(selection.excludedCount).toBe(7);
  });
});
