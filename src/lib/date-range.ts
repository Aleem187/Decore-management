// Dashboard date ranges. All "days" are calendar dates in Asia/Karachi (UTC+5, no daylight saving),
// written as YYYY-MM-DD. Ranges are inclusive on both ends.

export const TIME_ZONE = "Asia/Karachi";
export type RangePreset = "this_month" | "last_month" | "this_year" | "custom";
export type DateRange = { from: string; to: string };

export const PRESET_LABEL: Record<RangePreset, string> = {
  this_month: "This month",
  last_month: "Last month",
  this_year: "This year",
  custom: "Custom",
};

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Karachi calendar date of an instant (a Date or an ISO timestamp). */
export function karachiDate(at: Date | string = new Date()): string {
  return dayFormat.format(typeof at === "string" ? new Date(at) : at);
}

const pad = (n: number) => String(n).padStart(2, "0");
const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate(); // month is 1-12

export const isDay = (s: string | null | undefined): s is string =>
  !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export function rangeFor(
  preset: Exclude<RangePreset, "custom">,
  now: Date = new Date(),
): DateRange {
  const [y, m] = karachiDate(now).split("-").map(Number) as [number, number];
  if (preset === "this_year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (preset === "this_month")
    return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDayOf(y, m))}` };
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(lastDayOf(py, pm))}` };
}

/** A usable custom range, or null when either date is missing/invalid or the order is wrong. */
export function customRange(from: string, to: string): DateRange | null {
  return isDay(from) && isDay(to) && from <= to ? { from, to } : null;
}

export const inRange = (day: string, r: DateRange) => day >= r.from && day <= r.to;

export type Bucket = { key: string; label: string; from: string; to: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Chart buckets: one per day for ranges up to 62 days, otherwise one per calendar month. */
export function bucketsFor(r: DateRange): Bucket[] {
  const start = new Date(`${r.from}T00:00:00Z`);
  const end = new Date(`${r.to}T00:00:00Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const out: Bucket[] = [];
  if (days <= 62) {
    for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
      const d = new Date(t);
      const key = d.toISOString().slice(0, 10);
      out.push({ key, label: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`, from: key, to: key });
    }
    return out;
  }
  const crossesYears = start.getUTCFullYear() !== end.getUTCFullYear();
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth() + 1;
  while (`${y}-${pad(m)}` <= r.to.slice(0, 7)) {
    const from = `${y}-${pad(m)}-01`;
    out.push({
      key: `${y}-${pad(m)}`,
      label: crossesYears ? `${MONTHS[m - 1]} ${String(y).slice(2)}` : (MONTHS[m - 1] as string),
      from: from < r.from ? r.from : from,
      to:
        `${y}-${pad(m)}-${pad(lastDayOf(y, m))}` > r.to
          ? r.to
          : `${y}-${pad(m)}-${pad(lastDayOf(y, m))}`,
    });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function describeRange(r: DateRange): string {
  const f = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  return r.from === r.to ? f(r.from) : `${f(r.from)} – ${f(r.to)}`;
}
