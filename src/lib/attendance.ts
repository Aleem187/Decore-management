import { addDays, endOfMonth, startOfMonth, startOfWeek } from "@/lib/calendar";
import type { AttendanceStatus } from "@/lib/salary";

export const ATTENDANCE_STATUSES: AttendanceStatus[] = ["present", "half_day", "absent", "leave"];

export const ATTENDANCE_META: Record<
  AttendanceStatus,
  { label: string; short: string; chip: string }
> = {
  present: { label: "Present", short: "P", chip: "border-success/40 bg-success/20 text-success" },
  half_day: {
    label: "Half day",
    short: "H",
    chip: "border-warning/40 bg-warning/25 text-accent-foreground",
  },
  absent: {
    label: "Absent",
    short: "A",
    chip: "border-destructive/40 bg-destructive/15 text-destructive",
  },
  leave: { label: "Leave", short: "L", chip: "border-primary/30 bg-primary/10 text-primary" },
};

export type Mark = {
  staff_id: string;
  work_date: string;
  status: AttendanceStatus;
  event_id?: string | null;
  note?: string | null;
};

const keyOf = (m: Pick<Mark, "staff_id" | "work_date">) => `${m.staff_id}|${m.work_date}`;

/** Put a mark into a list. A person has one mark per date, so a new mark replaces the old one. */
export function applyMark(marks: Mark[], mark: Mark): Mark[] {
  return [...marks.filter((m) => keyOf(m) !== keyOf(mark)), mark];
}

/** Keys ("staff|date") that appear more than once; the database refuses these. */
export function findDuplicates(marks: Mark[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const m of marks) {
    const k = keyOf(m);
    if (seen.has(k)) dup.add(k);
    seen.add(k);
  }
  return [...dup];
}

export function monthSummary(marks: Pick<Mark, "status">[]) {
  const count = (s: AttendanceStatus) => marks.filter((m) => m.status === s).length;
  const present = count("present");
  const half = count("half_day");
  return {
    present,
    half_day: half,
    absent: count("absent"),
    leave: count("leave"),
    daysWorked: present + half / 2,
    marked: marks.length,
  };
}

/** Weeks (Monday first) covering a month, as in the calendar, with the day of month and whether it is inside the month. */
export function monthWeeks(month: string): { day: string; inMonth: boolean }[][] {
  const start = startOfMonth(month);
  const end = endOfMonth(month);
  const weeks: { day: string; inMonth: boolean }[][] = [];
  for (let d = startOfWeek(start); d <= end; d = addDays(d, 7)) {
    weeks.push(
      Array.from({ length: 7 }, (_, i) => ({
        day: addDays(d, i),
        inMonth: addDays(d, i) >= start && addDays(d, i) <= end,
      })),
    );
  }
  return weeks;
}
