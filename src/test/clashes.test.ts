import { describe, expect, it } from "vitest";
import {
  eventsClash,
  findStaffClashes,
  findVenueClashes,
  describeTimes,
  timesOverlap,
  type Assignment,
  type ClashEvent,
} from "@/lib/clashes";

const ev = (o: Partial<ClashEvent> & { id: string }): ClashEvent => ({
  event_date: "2026-11-14",
  start_time: "19:00",
  end_time: "23:00",
  status: "upcoming",
  hotel_id: "h1",
  deleted_at: null,
  ...o,
});

describe("eventsClash: dates", () => {
  it("same day with overlapping times clashes", () => {
    expect(
      eventsClash(
        ev({ id: "a", start_time: "18:00", end_time: "22:00" }),
        ev({ id: "b", start_time: "20:00", end_time: "23:59" }),
      ),
    ).toBe(true);
  });
  it("different days never clash, even at the same time", () => {
    expect(eventsClash(ev({ id: "a" }), ev({ id: "b", event_date: "2026-11-15" }))).toBe(false);
  });
  it("an event does not clash with itself", () =>
    expect(eventsClash(ev({ id: "a" }), ev({ id: "a" }))).toBe(false));
});

describe("eventsClash: times", () => {
  it("same day, separate times do not clash", () => {
    expect(
      eventsClash(
        ev({ id: "a", start_time: "10:00", end_time: "14:00" }),
        ev({ id: "b", start_time: "19:00", end_time: "23:00" }),
      ),
    ).toBe(false);
  });
  it("back-to-back events (one ends when the next starts) do not clash", () => {
    expect(
      eventsClash(
        ev({ id: "a", start_time: "10:00", end_time: "14:00" }),
        ev({ id: "b", start_time: "14:00", end_time: "18:00" }),
      ),
    ).toBe(false);
  });
  it("one minute of overlap is a clash", () => {
    expect(
      eventsClash(
        ev({ id: "a", start_time: "10:00", end_time: "14:01" }),
        ev({ id: "b", start_time: "14:00", end_time: "18:00" }),
      ),
    ).toBe(true);
  });
  it("an event inside another clashes", () => {
    expect(
      eventsClash(
        ev({ id: "a", start_time: "09:00", end_time: "23:00" }),
        ev({ id: "b", start_time: "12:00", end_time: "13:00" }),
      ),
    ).toBe(true);
  });
  it("an event with no times counts as all day and clashes with any event that day", () => {
    const allDay = ev({ id: "a", start_time: null, end_time: null });
    expect(eventsClash(allDay, ev({ id: "b", start_time: "06:00", end_time: "07:00" }))).toBe(true);
    expect(eventsClash(allDay, ev({ id: "c", start_time: null, end_time: null }))).toBe(true);
  });
  it("a late event that ends after midnight still overlaps the evening", () => {
    const late = ev({ id: "a", start_time: "19:00", end_time: "01:00" });
    expect(eventsClash(late, ev({ id: "b", start_time: "23:30", end_time: "23:59" }))).toBe(true);
    expect(eventsClash(late, ev({ id: "c", start_time: "10:00", end_time: "18:00" }))).toBe(false);
  });
  it("accepts HH:MM:SS from the database", () => {
    expect(
      timesOverlap(
        ev({ id: "a", start_time: "19:00:00", end_time: "23:00:00" }),
        ev({ id: "b", start_time: "22:00:00", end_time: "23:30:00" }),
      ),
    ).toBe(true);
  });
});

describe("eventsClash: cancelled and deleted events are ignored", () => {
  it("a cancelled event never clashes, in either direction", () => {
    expect(eventsClash(ev({ id: "a" }), ev({ id: "b", status: "cancelled" }))).toBe(false);
    expect(eventsClash(ev({ id: "b", status: "cancelled" }), ev({ id: "a" }))).toBe(false);
  });
  it("a soft-deleted event never clashes", () => {
    expect(eventsClash(ev({ id: "a" }), ev({ id: "b", deleted_at: "2026-10-01T00:00:00Z" }))).toBe(
      false,
    );
  });
  it("completed and paid events still count (they happened, the venue and crew were busy)", () => {
    expect(eventsClash(ev({ id: "a" }), ev({ id: "b", status: "completed" }))).toBe(true);
    expect(eventsClash(ev({ id: "a" }), ev({ id: "c", status: "paid" }))).toBe(true);
  });
});

describe("findStaffClashes", () => {
  const target = ev({ id: "t" });
  const events = [
    ev({ id: "same", name: "Same night" }),
    ev({ id: "morning", start_time: "08:00", end_time: "12:00" }),
    ev({ id: "otherDay", event_date: "2026-11-15" }),
    ev({ id: "cancelled", status: "cancelled" }),
    ev({ id: "deleted", deleted_at: "2026-10-01T00:00:00Z" }),
    ev({ id: "notMine" }),
  ];
  const assignments: Assignment[] = [
    { event_id: "same", staff_id: "ali" },
    { event_id: "morning", staff_id: "ali" },
    { event_id: "otherDay", staff_id: "ali" },
    { event_id: "cancelled", staff_id: "ali" },
    { event_id: "deleted", staff_id: "ali" },
    { event_id: "notMine", staff_id: "sara" },
  ];

  it("returns only active, same-day, overlapping events the person is assigned to", () => {
    expect(findStaffClashes("ali", target, events, assignments).map((e) => e.id)).toEqual(["same"]);
  });
  it("is empty for someone with no other assignments", () =>
    expect(findStaffClashes("nobody", target, events, assignments)).toEqual([]));
  it("ignores the event being assigned to", () => {
    expect(findStaffClashes("ali", ev({ id: "same" }), events, assignments)).toEqual([]);
  });
  it("is empty when the target event is itself cancelled", () => {
    expect(
      findStaffClashes("ali", ev({ id: "t", status: "cancelled" }), events, assignments),
    ).toEqual([]);
  });
  it("when the target has no times, every active same-day assignment clashes", () => {
    const allDay = ev({ id: "t", start_time: null, end_time: null });
    expect(
      findStaffClashes("ali", allDay, events, assignments)
        .map((e) => e.id)
        .sort(),
    ).toEqual(["morning", "same"]);
  });
});

describe("findVenueClashes", () => {
  const target = ev({ id: "t", hotel_id: "pc" });
  it("flags another active event at the same hotel, date and time", () => {
    expect(findVenueClashes(target, [ev({ id: "x", hotel_id: "pc" })]).map((e) => e.id)).toEqual([
      "x",
    ]);
  });
  it("ignores other hotels, other days, cancelled and deleted events", () => {
    const others = [
      ev({ id: "otherHotel", hotel_id: "marriott" }),
      ev({ id: "otherDay", hotel_id: "pc", event_date: "2026-11-20" }),
      ev({ id: "cancelled", hotel_id: "pc", status: "cancelled" }),
      ev({ id: "deleted", hotel_id: "pc", deleted_at: "2026-10-01T00:00:00Z" }),
      ev({ id: "morning", hotel_id: "pc", start_time: "08:00", end_time: "12:00" }),
    ];
    expect(findVenueClashes(target, others)).toEqual([]);
  });
  it("an event with no hotel never clashes on venue", () => {
    expect(
      findVenueClashes(ev({ id: "t", hotel_id: null }), [ev({ id: "x", hotel_id: null })]),
    ).toEqual([]);
  });
});

describe("describeTimes", () => {
  it("formats 12-hour times", () =>
    expect(describeTimes({ start_time: "19:00:00", end_time: "23:30:00" })).toBe(
      "7:00 pm – 11:30 pm",
    ));
  it("handles noon and midnight", () =>
    expect(describeTimes({ start_time: "00:15", end_time: "12:00" })).toBe("12:15 am – 12:00 pm"));
  it("says when no time is set", () =>
    expect(describeTimes({ start_time: null, end_time: null })).toBe("time not set"));
});
