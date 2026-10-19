// Calendar date helpers. Days are Asia/Karachi calendar dates written YYYY-MM-DD; they are never
// converted through the browser's own time zone (arithmetic is done in UTC on the date alone).

export type CalendarView = "month" | "week" | "list";

const MS_PER_DAY = 86_400_000;
const parse = (day: string) => new Date(`${day}T00:00:00Z`);
const format = (d: Date) => d.toISOString().slice(0, 10);

export const addDays = (day: string, n: number): string =>
  format(new Date(parse(day).getTime() + n * MS_PER_DAY));

export const startOfMonth = (day: string): string => `${day.slice(0, 7)}-01`;

export function endOfMonth(day: string): string {
  const d = parse(startOfMonth(day));
  return format(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

/** First day of the month `n` months away from `day`'s month. */
export function addMonths(day: string, n: number): string {
  const d = parse(startOfMonth(day));
  return format(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
}

/** Weeks start on Monday. */
export function startOfWeek(day: string): string {
  const dow = (parse(day).getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  return addDays(day, -dow);
}

export const weekDays = (day: string): string[] =>
  Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(day), i));

/** Rows of 7 days covering the month, padded with the neighbouring months' days. */
export function monthGrid(day: string): string[][] {
  const first = startOfWeek(startOfMonth(day));
  const last = addDays(startOfWeek(endOfMonth(day)), 6);
  const weeks: string[][] = [];
  for (let d = first; d <= last; d = addDays(d, 7)) weeks.push(weekDays(d));
  return weeks;
}

/** The date range the visible view needs to load. */
export function visibleRange(view: CalendarView, day: string): { from: string; to: string } {
  if (view === "week") {
    const days = weekDays(day);
    return { from: days[0] as string, to: days[6] as string };
  }
  if (view === "list") return { from: startOfMonth(day), to: endOfMonth(day) };
  const weeks = monthGrid(day);
  return {
    from: (weeks[0] as string[])[0] as string,
    to: (weeks[weeks.length - 1] as string[])[6] as string,
  };
}

export const monthTitle = (day: string) =>
  parse(day).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
export const dayLabel = (day: string) =>
  parse(day).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
export const weekTitle = (day: string) => {
  const d = weekDays(day);
  const f = (x: string) =>
    parse(x).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${f(d[0] as string)} – ${f(d[6] as string)} ${(d[6] as string).slice(0, 4)}`;
};

/** Events grouped by date; within a day, all-day events first, then by start time, then name. */
export function groupByDay<
  T extends { event_date: string; start_time: string | null; name: string },
>(events: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const e of events) map.set(e.event_date, [...(map.get(e.event_date) ?? []), e]);
  for (const list of map.values()) {
    list.sort(
      (a, b) =>
        (a.start_time ?? "").localeCompare(b.start_time ?? "") || a.name.localeCompare(b.name),
    );
  }
  return map;
}

/** Calendar colours by status. Status is also written out wherever there is room, so colour is never the only cue. */
export const STATUS_STYLE: Record<string, { chip: string; dot: string; label: string }> = {
  upcoming: {
    chip: "border-primary/30 bg-primary/10 text-primary",
    dot: "bg-primary",
    label: "Upcoming",
  },
  in_progress: {
    chip: "border-warning/40 bg-warning/20 text-accent-foreground",
    dot: "bg-warning",
    label: "In progress",
  },
  completed: {
    chip: "border-success/30 bg-success/15 text-success",
    dot: "bg-success",
    label: "Completed",
  },
  paid: { chip: "border-gold/40 bg-gold/15 text-gold", dot: "bg-gold", label: "Paid" },
  cancelled: {
    chip: "border-border bg-muted text-muted-foreground line-through",
    dot: "bg-muted-foreground/50",
    label: "Cancelled",
  },
};
export const styleFor = (status: string) => STATUS_STYLE[status] ?? STATUS_STYLE["upcoming"]!;

/** "19:00:00" -> "7:00 pm" */
export function formatTime(t: string | null | undefined): string {
  if (!t) return "";
  const [h = "0", m = "0"] = t.split(":");
  const hour = Number(h);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${m.padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
}

export const timeRange = (start: string | null, end: string | null): string =>
  start && end ? `${formatTime(start)} – ${formatTime(end)}` : "All day";
