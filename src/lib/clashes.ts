// Clash detection for the events calendar. Pure functions, no database access.
// All dates are Asia/Karachi calendar days (YYYY-MM-DD) and times are wall-clock "HH:MM[:SS]".

export type ClashEvent = {
  id: string;
  name?: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  status: string;
  hotel_id: string | null;
  deleted_at?: string | null;
};

export type Assignment = { event_id: string; staff_id: string };

const MINUTES_PER_DAY = 24 * 60;

export const toMinutes = (t: string): number => {
  const [h = "0", m = "0"] = t.split(":");
  return Number(h) * 60 + Number(m);
};

/** An event still on the books: not deleted and not cancelled. Only active events can clash. */
export const isActive = (e: Pick<ClashEvent, "status" | "deleted_at">): boolean =>
  !e.deleted_at && e.status !== "cancelled";

/**
 * The span an event covers on its own date, in minutes, or null when no times are set.
 * An end time at or before the start time means the event runs past midnight, so it ends
 * "tomorrow" (19:00 to 01:00 covers 1140 to 1500).
 */
export function span(e: Pick<ClashEvent, "start_time" | "end_time">): [number, number] | null {
  if (!e.start_time || !e.end_time) return null;
  const start = toMinutes(e.start_time);
  let end = toMinutes(e.end_time);
  if (end <= start) end += MINUTES_PER_DAY;
  return [start, end];
}

/** Same-day check. An event with no times is treated as all day, so it clashes with anything that day. */
export function timesOverlap(a: ClashEvent, b: ClashEvent): boolean {
  const sa = span(a);
  const sb = span(b);
  if (!sa || !sb) return true;
  return sa[0] < sb[1] && sb[0] < sa[1]; // touching ends (11:00 and 11:00) do not overlap
}

/** True when two different, active events fall on the same date with overlapping times. */
export function eventsClash(a: ClashEvent, b: ClashEvent): boolean {
  return (
    a.id !== b.id &&
    isActive(a) &&
    isActive(b) &&
    a.event_date === b.event_date &&
    timesOverlap(a, b)
  );
}

/**
 * Other events this person is already assigned to that clash with `target`.
 * `events` may include any events (other dates, cancelled, deleted); only real clashes are returned.
 */
export function findStaffClashes(
  staffId: string,
  target: ClashEvent,
  events: ClashEvent[],
  assignments: Assignment[],
): ClashEvent[] {
  const mine = new Set(assignments.filter((a) => a.staff_id === staffId).map((a) => a.event_id));
  return events.filter((e) => mine.has(e.id) && eventsClash(target, e));
}

/** Other events at the same venue that clash with `target`. A target with no venue never clashes. */
export function findVenueClashes(target: ClashEvent, events: ClashEvent[]): ClashEvent[] {
  if (!target.hotel_id) return [];
  return events.filter((e) => e.hotel_id === target.hotel_id && eventsClash(target, e));
}

const clock = (t: string) => {
  const [h = "0", m = "0"] = t.split(":");
  const hour = Number(h);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${m.padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
};

/** "7:00 pm – 11:00 pm", or "time not set" for an event without times. */
export function describeTimes(e: Pick<ClashEvent, "start_time" | "end_time">): string {
  return e.start_time && e.end_time
    ? `${clock(e.start_time)} – ${clock(e.end_time)}`
    : "time not set";
}
