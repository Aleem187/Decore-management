import { useState } from "react";
import {
  customRange,
  describeRange,
  karachiDate,
  rangeFor,
  type DateRange,
  type RangePreset,
} from "@/lib/date-range";

/** Date-range state shared by the dashboard and reports (Asia/Karachi days, inclusive). */
export function useDateRange(initial: Exclude<RangePreset, "custom"> = "this_month") {
  const [preset, setPreset] = useState<RangePreset>(initial);
  const [from, setFrom] = useState(() => rangeFor(initial).from);
  const [to, setTo] = useState(() => karachiDate());
  const [lastValid, setLastValid] = useState<DateRange>(() => rangeFor(initial));

  const custom = customRange(from, to);
  const range: DateRange = preset === "custom" ? (custom ?? lastValid) : rangeFor(preset);
  const invalid = preset === "custom" && !custom;

  function pick(p: RangePreset) {
    if (p === "custom") {
      setFrom(range.from);
      setTo(range.to);
    } else {
      setLastValid(rangeFor(p));
    }
    setPreset(p);
  }

  function setDate(which: "from" | "to", v: string) {
    const nextFrom = which === "from" ? v : from;
    const nextTo = which === "to" ? v : to;
    if (which === "from") setFrom(v);
    else setTo(v);
    const ok = customRange(nextFrom, nextTo);
    if (ok) setLastValid(ok);
  }

  return { preset, pick, from, to, setDate, range, invalid, label: describeRange(range) };
}

export type DateRangeState = ReturnType<typeof useDateRange>;
