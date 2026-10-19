import { describe, expect, it } from "vitest";
import { applyMark, findDuplicates, monthSummary, monthWeeks, type Mark } from "@/lib/attendance";
import { normalizeCnic, validateStaff, maskCnic, type StaffFormValues } from "@/lib/staff";

const mark = (staff_id: string, work_date: string, status: Mark["status"]): Mark => ({
  staff_id,
  work_date,
  status,
});

describe("attendance: one mark per person per day", () => {
  it("a new mark for the same person and date replaces the old one", () => {
    const after = applyMark(
      [mark("ali", "2026-03-02", "present")],
      mark("ali", "2026-03-02", "absent"),
    );
    expect(after).toEqual([mark("ali", "2026-03-02", "absent")]);
  });
  it("different people or different dates are kept side by side", () => {
    let list: Mark[] = [];
    for (const m of [
      mark("ali", "2026-03-02", "present"),
      mark("sara", "2026-03-02", "present"),
      mark("ali", "2026-03-03", "leave"),
    ])
      list = applyMark(list, m);
    expect(list).toHaveLength(3);
    expect(findDuplicates(list)).toEqual([]);
  });
  it("finds duplicate marks in raw data", () => {
    const dup = findDuplicates([
      mark("ali", "2026-03-02", "present"),
      mark("ali", "2026-03-02", "absent"),
      mark("sara", "2026-03-02", "present"),
    ]);
    expect(dup).toEqual(["ali|2026-03-02"]);
  });
  it("applyMark never creates a duplicate however often it is used", () => {
    let list: Mark[] = [];
    for (const s of ["present", "absent", "half_day", "leave", "present"] as const)
      list = applyMark(list, mark("ali", "2026-03-02", s));
    expect(list).toHaveLength(1);
    expect(list[0]?.status).toBe("present");
  });
});

describe("monthSummary / monthWeeks", () => {
  it("counts each status and days worked", () => {
    const s = monthSummary([
      { status: "present" },
      { status: "present" },
      { status: "half_day" },
      { status: "absent" },
      { status: "leave" },
    ]);
    expect(s).toEqual({ present: 2, half_day: 1, absent: 1, leave: 1, daysWorked: 2.5, marked: 5 });
  });
  it("lays a month out in whole Monday-first weeks and flags days outside the month", () => {
    const weeks = monthWeeks("2026-03-15");
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0]?.[0]?.day).toBe("2026-02-23");
    expect(weeks[0]?.[6]).toEqual({ day: "2026-03-01", inMonth: true });
    expect(weeks[0]?.[0]?.inMonth).toBe(false);
    expect(weeks.flat().filter((d) => d.inMonth)).toHaveLength(31);
  });
});

describe("staff form", () => {
  const ok: StaffFormValues = {
    name: "Imran Ali",
    job_title: "Driver",
    phone: "",
    cnic: "",
    salary_type: "daily_wage",
    rate: "1500",
    joining_date: "",
    active: true,
    notes: "",
  };

  it("accepts a minimal staff member", () => {
    expect(validateStaff(ok)).toEqual({
      data: {
        name: "Imran Ali",
        job_title: "Driver",
        phone: null,
        cnic: null,
        salary_type: "daily_wage",
        rate: 1500,
        joining_date: null,
        active: true,
        notes: null,
      },
    });
  });
  it("cleans the phone to 92xxxxxxxxxx and the CNIC to 5-7-1 digits", () => {
    const r = validateStaff({
      ...ok,
      phone: "0300-1234567",
      cnic: "3520212345671",
      joining_date: "2026-01-05",
    });
    expect(r).toMatchObject({
      data: { phone: "923001234567", cnic: "35202-1234567-1", joining_date: "2026-01-05" },
    });
  });
  it("reports every problem against its field", () => {
    const r = validateStaff({
      ...ok,
      name: " ",
      job_title: "",
      phone: "12",
      cnic: "123",
      rate: "-5",
      salary_type: "weekly",
    });
    expect("errors" in r && Object.keys(r.errors).sort()).toEqual([
      "cnic",
      "job_title",
      "name",
      "phone",
      "rate",
      "salary_type",
    ]);
  });
  it("needs a rate", () => expect("errors" in validateStaff({ ...ok, rate: "" })).toBe(true));
  it("normalizeCnic and maskCnic", () => {
    expect(normalizeCnic("35202 1234567 1")).toBe("35202-1234567-1");
    expect(normalizeCnic("352021234567")).toBeNull();
    expect(maskCnic("35202-1234567-1")).toBe("xxxxx-xxxxxxx-1");
    expect(maskCnic(null)).toBe("—");
  });
});
