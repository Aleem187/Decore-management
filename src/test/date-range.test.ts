import { describe, expect, it } from "vitest";
import { bucketsFor, customRange, inRange, karachiDate, rangeFor } from "@/lib/date-range";
import { compactNumber } from "@/lib/format";
import { displayName } from "@/lib/auth";

describe("karachiDate", () => {
  it("rolls to the next day at 19:00 UTC (00:00 PKT)", () => {
    expect(karachiDate(new Date("2026-10-19T18:59:00Z"))).toBe("2026-10-19");
    expect(karachiDate(new Date("2026-10-19T19:00:00Z"))).toBe("2026-10-20");
  });
  it("converts timestamps near month and year ends", () => {
    expect(karachiDate("2026-12-31T20:00:00Z")).toBe("2027-01-01");
    expect(karachiDate("2026-02-28T19:30:00Z")).toBe("2026-03-01");
  });
});

describe("rangeFor", () => {
  const now = new Date("2026-10-19T10:00:00Z");
  it("this month", () =>
    expect(rangeFor("this_month", now)).toEqual({ from: "2026-10-01", to: "2026-10-31" }));
  it("last month", () =>
    expect(rangeFor("last_month", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" }));
  it("this year", () =>
    expect(rangeFor("this_year", now)).toEqual({ from: "2026-01-01", to: "2026-12-31" }));
  it("last month in January is December of the previous year", () =>
    expect(rangeFor("last_month", new Date("2026-01-15T10:00:00Z"))).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    }));
  it("handles February in a leap year", () =>
    expect(rangeFor("this_month", new Date("2028-02-10T10:00:00Z"))).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    }));
  it("uses the Karachi month, not the UTC month", () => {
    // 2026-09-30 20:00 UTC is already 1 October in Karachi
    expect(rangeFor("this_month", new Date("2026-09-30T20:00:00Z"))).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });
});

describe("customRange / inRange", () => {
  it("accepts a valid range, rejects bad ones", () => {
    expect(customRange("2026-10-01", "2026-10-15")).toEqual({
      from: "2026-10-01",
      to: "2026-10-15",
    });
    expect(customRange("2026-10-15", "2026-10-01")).toBeNull();
    expect(customRange("", "2026-10-01")).toBeNull();
    expect(customRange("2026-13-01", "2026-13-02")).toBeNull();
  });
  it("is inclusive on both ends", () => {
    const r = { from: "2026-10-01", to: "2026-10-31" };
    expect(inRange("2026-10-01", r) && inRange("2026-10-31", r)).toBe(true);
    expect(inRange("2026-09-30", r) || inRange("2026-11-01", r)).toBe(false);
  });
});

describe("bucketsFor", () => {
  it("uses days for a month", () => {
    const b = bucketsFor({ from: "2026-10-01", to: "2026-10-31" });
    expect(b).toHaveLength(31);
    expect(b[0]?.label).toBe("1 Oct");
  });
  it("uses months for a year", () => {
    const b = bucketsFor({ from: "2026-01-01", to: "2026-12-31" });
    expect(b.map((x) => x.label).join(",")).toBe("Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec");
    expect(b[1]).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("clips partial months at the edges and adds the year when crossing years", () => {
    const b = bucketsFor({ from: "2026-11-15", to: "2027-02-10" });
    expect(b.map((x) => x.label)).toEqual(["Nov 26", "Dec 26", "Jan 27", "Feb 27"]);
    expect(b[0]?.from).toBe("2026-11-15");
    expect(b[3]?.to).toBe("2027-02-10");
  });
});

describe("compactNumber", () => {
  it.each([
    [0, "0"],
    [500, "500"],
    [1500, "1.5k"],
    [250000, "250k"],
    [2400000, "2.4M"],
    [-3000, "-3k"],
  ])("%s -> %s", (n, s) => expect(compactNumber(n)).toBe(s));
});

describe("displayName", () => {
  it("prefers the profile name", () =>
    expect(displayName({ name: " Aleem Khan ", email: "a@b.com" })).toBe("Aleem Khan"));
  it("falls back to the e-mail prefix", () =>
    expect(displayName({ name: "", email: "hafiz.yahya.pk@gmail.com" })).toBe("hafiz.yahya.pk"));
  it("falls back to 'there'", () => expect(displayName({ name: null, email: "" })).toBe("there"));
});
