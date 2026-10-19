import { describe, expect, it } from "vitest";
import { summarize } from "@/lib/dashboard-stats";

const range = { from: "2026-10-01", to: "2026-10-31" };
const today = "2026-10-19";
const input = {
  invoices: [
    {
      amount: 100000,
      amount_paid: 40000,
      due_date: "2026-10-10",
      created_at: "2026-10-02T08:00:00Z",
    }, // overdue, 60k open
    {
      amount: 50000,
      amount_paid: 50000,
      due_date: "2026-10-05",
      created_at: "2026-10-03T08:00:00Z",
    }, // paid
    { amount: 30000, amount_paid: 0, due_date: "2026-11-30", created_at: "2026-10-04T08:00:00Z" }, // open, not due
    { amount: 70000, amount_paid: 0, due_date: null, created_at: "2026-09-30T19:30:00Z" }, // 00:30 on 1 Oct in Karachi => in range
    {
      amount: 90000,
      amount_paid: 10000,
      due_date: "2026-09-01",
      created_at: "2026-09-10T08:00:00Z",
    }, // last month
  ],
  payments: [
    { amount: 40000, paid_at: "2026-10-02" },
    { amount: 50000, paid_at: "2026-10-03" },
    { amount: 10000, paid_at: "2026-09-15" }, // outside
  ],
  expenses: [
    { amount: 25000, expense_date: "2026-10-05", event_id: "e1" },
    { amount: 5000, expense_date: "2026-09-28", event_id: "e1" }, // outside the range, still a cost of event e1
  ],
  events: [
    { id: "e1", event_date: "2026-10-12", hotel: "Pearl Continental", package_price: 300000 },
    { id: "e2", event_date: "2026-10-20", hotel: null, package_price: 80000 },
    { id: "e3", event_date: "2026-08-01", hotel: "Royal Palm", package_price: 999 },
  ],
};

describe("summarize", () => {
  const s = summarize(input, range, today, true);

  it("separates invoiced from received", () => {
    expect(s.invoiced).toBe(250000); // 100k + 50k + 30k + 70k (the 1 Oct Karachi invoice)
    expect(s.received).toBe(90000);
  });
  it("outstanding and overdue", () => {
    expect(s.outstanding).toBe(60000 + 30000 + 70000);
    expect(s.overdue).toBe(60000);
  });
  it("expenses and net profit use the range only", () => {
    expect(s.expenses).toBe(25000);
    expect(s.profit?.net).toBe(65000);
  });
  it("hotel performance covers events in range, unassigned included, cost from all linked expenses", () => {
    expect(s.profit?.hotels).toEqual([
      { hotel: "Pearl Continental", Revenue: 300000, Cost: 30000, bookings: 1 },
      { hotel: "Unassigned", Revenue: 80000, Cost: 0, bookings: 1 },
    ]);
  });
  it("flow buckets add up to the totals", () => {
    expect(s.flow).toHaveLength(31);
    expect(s.flow.reduce((a, f) => a + f.In, 0)).toBe(s.received);
    expect(s.flow.reduce((a, f) => a + f.Out, 0)).toBe(s.expenses);
    expect(s.hasFlow).toBe(true);
  });
});

describe("summarize without profit access", () => {
  it("contains no profit data at all, whatever the range", () => {
    for (const r of [
      range,
      { from: "2026-01-01", to: "2026-12-31" },
      { from: "2026-10-19", to: "2026-10-19" },
    ]) {
      const s = summarize(input, r, today, false);
      expect(s.profit).toBeUndefined();
      expect(JSON.stringify(s)).not.toMatch(/profit|Revenue|Cost/);
    }
  });
});

describe("summarize with nothing in range", () => {
  it("is all zeros and flags an empty chart", () => {
    const s = summarize(input, { from: "2025-01-01", to: "2025-01-31" }, today, true);
    expect([s.invoiced, s.received, s.expenses, s.outstanding, s.overdue]).toEqual([0, 0, 0, 0, 0]);
    expect(s.hasFlow).toBe(false);
  });
});
