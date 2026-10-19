import { describe, expect, it } from "vitest";
import {
  calculateSalary,
  fromStoredCalc,
  type AttendanceStatus,
  type SalaryInput,
} from "@/lib/salary";

// Build a month of marks: [status, how many], one per day starting on the 1st.
function marks(month: string, spec: [AttendanceStatus, number][]) {
  const out: SalaryInput["attendance"] = [];
  let day = 1;
  for (const [status, n] of spec)
    for (let i = 0; i < n; i++)
      out.push({ work_date: `${month}-${String(day++).padStart(2, "0")}`, status });
  return out;
}
const base = {
  joiningDate: "2025-01-01",
  month: "2026-03-15",
  advancesGiven: 0,
  advancesRecovered: 0,
} as const;

// These cases are the same fixtures used in supabase/tests/rls_security_tests.sql.
describe("monthly salary", () => {
  const attendance = marks("2026-03", [
    ["present", 20],
    ["absent", 2],
    ["leave", 1],
    ["half_day", 2],
  ]);

  it("deducts absent, leave and half days at rate ÷ 30", () => {
    const r = calculateSalary({ ...base, salaryType: "monthly", rate: 30000, attendance });
    expect(r).toMatchObject({
      present: 20,
      absent: 2,
      leave: 1,
      halfDays: 2,
      daysWorked: 21,
      unpaidDays: 4,
      gross: 26000,
      net: 26000,
    });
  });
  it("recovers advances and adds a bonus", () => {
    const r = calculateSalary({
      ...base,
      salaryType: "monthly",
      rate: 30000,
      attendance,
      advancesGiven: 5000,
      bonus: 500,
    });
    expect(r).toMatchObject({
      gross: 26000,
      bonus: 500,
      outstandingAdvance: 5000,
      advanceDeducted: 5000,
      net: 21500,
      advanceCarriedForward: 0,
    });
  });
  it("pays the full rate when nothing is marked (unmarked days are not deducted)", () => {
    expect(
      calculateSalary({ ...base, salaryType: "monthly", rate: 30000, attendance: [] }),
    ).toMatchObject({ gross: 30000, daysWorked: 0, net: 30000 });
  });
  it("never deducts more than the rate", () => {
    const r = calculateSalary({
      ...base,
      salaryType: "monthly",
      rate: 30000,
      attendance: marks("2026-03", [["absent", 31]]),
    });
    expect(r.gross).toBe(0);
    expect(r.net).toBe(0);
  });
  it("rounds once, to the paisa", () => {
    // 1 absent day of a 10,000 salary: 10000 ÷ 30 = 333.333… -> 9666.67
    expect(
      calculateSalary({
        ...base,
        salaryType: "monthly",
        rate: 10000,
        attendance: marks("2026-03", [["absent", 1]]),
      }).gross,
    ).toBe(9666.67);
  });
  it("ignores marks from other months", () => {
    const r = calculateSalary({
      ...base,
      salaryType: "monthly",
      rate: 30000,
      attendance: [
        { work_date: "2026-02-10", status: "absent" },
        { work_date: "2026-04-01", status: "leave" },
      ],
    });
    expect(r.gross).toBe(30000);
  });
});

describe("monthly salary: joining dates", () => {
  it("pays from the joining date: 20 days before 21 March are not paid", () => {
    const r = calculateSalary({
      ...base,
      salaryType: "monthly",
      rate: 31000,
      joiningDate: "2026-03-21",
      attendance: [],
    });
    expect(r).toMatchObject({ preJoinDays: 20, gross: 10333.33 });
  });
  it("a person who joins on the 1st loses nothing", () => {
    expect(
      calculateSalary({
        ...base,
        salaryType: "monthly",
        rate: 30000,
        joiningDate: "2026-03-01",
        attendance: [],
      }).gross,
    ).toBe(30000);
  });
  it("earns nothing in a month before joining", () => {
    expect(
      calculateSalary({
        ...base,
        salaryType: "monthly",
        rate: 31000,
        joiningDate: "2026-03-21",
        month: "2026-02-10",
        attendance: [],
      }).gross,
    ).toBe(0);
  });
  it("joining late in a long month is capped at 30 days", () => {
    expect(
      calculateSalary({
        ...base,
        salaryType: "monthly",
        rate: 30000,
        joiningDate: "2026-03-31",
        attendance: [],
      }).preJoinDays,
    ).toBe(30);
  });
  it("a missing joining date means no proration", () => {
    expect(
      calculateSalary({
        ...base,
        salaryType: "monthly",
        rate: 30000,
        joiningDate: null,
        attendance: [],
      }).gross,
    ).toBe(30000);
  });
});

describe("daily wage", () => {
  it("days worked × rate, a half day counting 0.5", () => {
    const r = calculateSalary({
      ...base,
      salaryType: "daily_wage",
      rate: 1500,
      attendance: marks("2026-03", [
        ["present", 10],
        ["half_day", 4],
      ]),
    });
    expect(r).toMatchObject({ daysWorked: 12, gross: 18000 });
  });
  it("absent and leave earn nothing", () => {
    const r = calculateSalary({
      ...base,
      salaryType: "daily_wage",
      rate: 1500,
      attendance: marks("2026-03", [
        ["present", 2],
        ["absent", 3],
        ["leave", 2],
      ]),
    });
    expect(r.gross).toBe(3000);
  });
  it("zero attendance earns zero", () => {
    expect(
      calculateSalary({ ...base, salaryType: "daily_wage", rate: 1500, attendance: [] }),
    ).toMatchObject({ daysWorked: 0, gross: 0, net: 0 });
  });
  it("a half day at an odd rate rounds to the paisa", () => {
    expect(
      calculateSalary({
        ...base,
        salaryType: "daily_wage",
        rate: 100.01,
        attendance: [{ work_date: "2026-03-02", status: "half_day" }],
      }).gross,
    ).toBe(50.01);
  });
});

describe("advances", () => {
  const daily = {
    ...base,
    salaryType: "daily_wage" as const,
    rate: 1500,
    attendance: marks("2026-03", [
      ["present", 10],
      ["half_day", 4],
    ]),
  };

  it("advances above the salary: pay is 0 and the rest carries forward", () => {
    const r = calculateSalary({ ...daily, advancesGiven: 25000, bonus: 1000 });
    expect(r).toMatchObject({
      gross: 18000,
      bonus: 1000,
      outstandingAdvance: 25000,
      advanceDeducted: 19000,
      net: 0,
      advanceCarriedForward: 6000,
    });
  });
  it("net pay is never negative", () => {
    expect(calculateSalary({ ...daily, advancesGiven: 1_000_000 }).net).toBe(0);
  });
  it("earlier recoveries reduce what is still owed", () => {
    const r = calculateSalary({ ...daily, advancesGiven: 25000, advancesRecovered: 20000 });
    expect(r).toMatchObject({ outstandingAdvance: 5000, advanceDeducted: 5000, net: 13000 });
  });
  it("more recovered than given never goes negative", () => {
    expect(calculateSalary({ ...daily, advancesGiven: 100, advancesRecovered: 500 })).toMatchObject(
      { outstandingAdvance: 0, advanceDeducted: 0, net: 18000 },
    );
  });
  it("a bonus cannot be negative", () => {
    expect(() => calculateSalary({ ...daily, bonus: -1 })).toThrow();
  });
  it("accepts numeric strings from the database", () => {
    expect(
      calculateSalary({ ...daily, rate: "1500.00", advancesGiven: "2000.50", bonus: "0.50" }),
    ).toMatchObject({ advanceDeducted: 2000.5, net: 16000 });
  });
});

describe("stored calc", () => {
  it("reads the calc saved with a payout", () => {
    const r = fromStoredCalc({
      salary_type: "daily_wage",
      rate: 1500,
      present: 10,
      half_days: 4,
      absent: 0,
      leave: 0,
      days_worked: 12,
      unpaid_days: 2,
      pre_join_days: 0,
      gross: 18000,
      bonus: 1000,
      outstanding_advance: 25000,
      advance_deducted: 19000,
      net: 0,
      advance_carried_forward: 6000,
    });
    expect(r).toMatchObject({
      salaryType: "daily_wage",
      halfDays: 4,
      advanceDeducted: 19000,
      advanceCarriedForward: 6000,
    });
  });
});
