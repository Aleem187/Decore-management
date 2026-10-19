// Salary calculation. The database function staff_salary_calc() follows the same rules and
// record_salary_payment() refuses to save a payout whose net pay differs from what was reviewed.
// All money is handled in whole paisa (cents) and rounded once, at the end.

import { endOfMonth, startOfMonth } from "@/lib/calendar";

export type SalaryType = "monthly" | "daily_wage";
export type AttendanceStatus = "present" | "absent" | "half_day" | "leave";

export const SALARY_RULES = [
  "Present counts as 1 day, half day as 0.5; absent and leave count as 0 (all leave is unpaid).",
  "Daily wage: earned = days worked × daily rate.",
  "Monthly: earned = monthly rate − (absent days + leave days + 0.5 × half days + days before joining) × rate ÷ 30, never below 0. Days with no attendance mark are not deducted.",
  "A person who joins after the month ends earns nothing for it; one who joins during the month is paid from the joining date.",
  "Advances: what is still owed from advances given up to the end of the month is recovered from the pay. Net pay is never negative; any rest carries forward.",
  "Net pay = earned + bonus − advance recovered.",
] as const;

export type SalaryInput = {
  salaryType: SalaryType;
  rate: number | string;
  joiningDate: string | null;
  /** Any day in the month being paid. */
  month: string;
  /** Marks for this person; marks outside the month are ignored. */
  attendance: { work_date: string; status: AttendanceStatus }[];
  /** Advances given on or before the end of the month (not deleted). */
  advancesGiven: number | string;
  /** Advances already recovered by earlier, non-voided payouts. */
  advancesRecovered: number | string;
  bonus?: number | string;
};

export type SalaryResult = {
  salaryType: SalaryType;
  rate: number;
  present: number;
  halfDays: number;
  absent: number;
  leave: number;
  /** Days worked, counting a half day as 0.5. */
  daysWorked: number;
  /** Absent + leave + half-day shortfall, in days. */
  unpaidDays: number;
  preJoinDays: number;
  /** Salary earned for the month before bonus and advances. */
  gross: number;
  bonus: number;
  outstandingAdvance: number;
  advanceDeducted: number;
  net: number;
  advanceCarriedForward: number;
};

const cents = (v: number | string | null | undefined) => Math.round((Number(v) || 0) * 100);
const money = (c: number) => c / 100;

export function calculateSalary(input: SalaryInput): SalaryResult {
  const start = startOfMonth(input.month);
  const end = endOfMonth(input.month);
  const rate = cents(input.rate);
  const bonus = cents(input.bonus);
  if (bonus < 0) throw new Error("Bonus cannot be negative");

  const marks = input.attendance.filter((a) => a.work_date >= start && a.work_date <= end);
  const count = (s: AttendanceStatus) => marks.filter((m) => m.status === s).length;
  const present = count("present");
  const halfDays = count("half_day");
  const absent = count("absent");
  const leave = count("leave");

  const days2 = 2 * present + halfDays; // days worked × 2
  const unpaid2 = 2 * absent + 2 * leave + halfDays; // unpaid days × 2

  let preJoinDays = 0;
  let gross: number;
  if (input.salaryType === "daily_wage") {
    gross = Math.round((days2 * rate) / 2);
  } else if (input.joiningDate && input.joiningDate > end) {
    gross = 0;
  } else {
    if (input.joiningDate && input.joiningDate >= start)
      preJoinDays = Math.min(Number(input.joiningDate.slice(8)) - 1, 30);
    const deduction = Math.min(rate, Math.round(((2 * preJoinDays + unpaid2) * rate) / 60));
    gross = rate - deduction;
  }

  const outstanding = Math.max(cents(input.advancesGiven) - cents(input.advancesRecovered), 0);
  const recovered = Math.min(outstanding, gross + bonus);
  const net = gross + bonus - recovered;

  return {
    salaryType: input.salaryType,
    rate: money(rate),
    present,
    halfDays,
    absent,
    leave,
    daysWorked: days2 / 2,
    unpaidDays: unpaid2 / 2,
    preJoinDays,
    gross: money(gross),
    bonus: money(bonus),
    outstandingAdvance: money(outstanding),
    advanceDeducted: money(recovered),
    net: money(net),
    advanceCarriedForward: money(outstanding - recovered),
  };
}

/** The calc object saved with a payout (snake_case, written by the database) as a SalaryResult. */
export function fromStoredCalc(c: Record<string, unknown>): SalaryResult {
  const n = (k: string) => Number(c[k]) || 0;
  return {
    salaryType: c["salary_type"] === "daily_wage" ? "daily_wage" : "monthly",
    rate: n("rate"),
    present: n("present"),
    halfDays: n("half_days"),
    absent: n("absent"),
    leave: n("leave"),
    daysWorked: n("days_worked"),
    unpaidDays: n("unpaid_days"),
    preJoinDays: n("pre_join_days"),
    gross: n("gross"),
    bonus: n("bonus"),
    outstandingAdvance: n("outstanding_advance"),
    advanceDeducted: n("advance_deducted"),
    net: n("net"),
    advanceCarriedForward: n("advance_carried_forward"),
  };
}
