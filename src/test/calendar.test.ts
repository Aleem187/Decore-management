import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  endOfMonth,
  formatTime,
  groupByDay,
  monthGrid,
  startOfWeek,
  timeRange,
  visibleRange,
  weekDays,
} from "@/lib/calendar";
import { karachiDate } from "@/lib/date-range";

describe("calendar dates (Karachi days)", () => {
  it("weeks start on Monday", () => {
    expect(startOfWeek("2026-10-19")).toBe("2026-10-19"); // a Monday
    expect(startOfWeek("2026-10-25")).toBe("2026-10-19"); // Sunday belongs to the week that started Monday
    expect(weekDays("2026-10-21")[0]).toBe("2026-10-19");
    expect(weekDays("2026-10-21")[6]).toBe("2026-10-25");
  });
  it("month grid is whole weeks that contain the month", () => {
    const grid = monthGrid("2026-10-15");
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid[0]?.[0]).toBe("2026-09-28");
    expect(grid.at(-1)?.[6]).toBe("2026-11-01");
    expect(grid.flat()).toContain("2026-10-01");
    expect(grid.flat()).toContain("2026-10-31");
  });
  it("handles a February that fits exactly four weeks, and leap years", () => {
    expect(monthGrid("2027-02-10")).toHaveLength(4); // 1 Feb 2027 is a Monday, 28 days
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
  });
  it("moves across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-31", -1)).toBe("2025-12-01");
  });
  it("visible range matches the view", () => {
    expect(visibleRange("week", "2026-10-21")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(visibleRange("list", "2026-10-21")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(visibleRange("month", "2026-10-21")).toEqual({ from: "2026-09-28", to: "2026-11-01" });
  });
  it("today is the Karachi day, not the UTC day", () => {
    expect(karachiDate(new Date("2026-10-19T19:30:00Z"))).toBe("2026-10-20");
  });
});

describe("groupByDay", () => {
  it("groups by date with all-day events first, then by start time and name", () => {
    const g = groupByDay([
      { event_date: "2026-10-20", start_time: "19:00", name: "Evening" },
      { event_date: "2026-10-20", start_time: null, name: "All day" },
      { event_date: "2026-10-20", start_time: "10:00", name: "Morning" },
      { event_date: "2026-10-21", start_time: null, name: "Next" },
    ]);
    expect(g.get("2026-10-20")?.map((e) => e.name)).toEqual(["All day", "Morning", "Evening"]);
    expect(g.get("2026-10-21")).toHaveLength(1);
  });
});

describe("time formatting", () => {
  it("formats and falls back to All day", () => {
    expect(formatTime("19:05:00")).toBe("7:05 pm");
    expect(timeRange("09:00", "11:30")).toBe("9:00 am – 11:30 am");
    expect(timeRange(null, null)).toBe("All day");
  });
});
