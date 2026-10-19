import { describe, expect, it } from "vitest";
import {
  buildReport,
  invoiceTotals,
  profitOf,
  reportCsvRows,
  type EventPnlRow,
} from "@/lib/event-pnl";
import { buildCsv } from "@/lib/csv";

const row = (o: Partial<EventPnlRow>): EventPnlRow => ({
  event_id: "e1",
  event_name: "Wedding",
  event_date: "2026-10-12",
  client_name: "Ayesha",
  hotel_name: "Pearl Continental",
  invoiced: 0,
  received: 0,
  expenses: 0,
  ...o,
});

describe("profitOf", () => {
  it("profit is received minus expenses; margin is profit over received", () => {
    expect(profitOf(100000, 60000)).toEqual({ profit: 40000, margin: 40 });
  });
  it("a loss is negative", () =>
    expect(profitOf(50000, 80000)).toEqual({ profit: -30000, margin: -60 }));
  it("event with no invoices and no payments: nothing received, expenses are a loss, margin undefined", () =>
    expect(profitOf(0, 2000)).toEqual({ profit: -2000, margin: null }));
  it("no income and no expenses is zero, not NaN", () =>
    expect(profitOf(0, 0)).toEqual({ profit: 0, margin: null }));
  it("accepts numeric strings from the database and avoids float drift", () => {
    expect(profitOf("0.30", "0.10")).toEqual({ profit: 0.2, margin: 66.7 });
    expect(profitOf("1000.10", "0.20").profit).toBe(999.9);
  });
});

describe("buildReport", () => {
  const rows = [
    row({ event_id: "e1", invoiced: 100000, received: 60000, expenses: 30000 }),
    row({
      event_id: "e2",
      event_name: "Mehndi",
      hotel_name: null,
      invoiced: 0,
      received: 0,
      expenses: 2000,
    }), // no invoices
    row({
      event_id: "e3",
      event_name: "Corporate",
      invoiced: 80000,
      received: 80000,
      expenses: 20000,
    }),
  ];
  const r = buildReport(rows, 7000);

  it("derives profit and margin per event", () => {
    expect(r.events.map((e) => [e.profit, e.margin])).toEqual([
      [30000, 50],
      [-2000, null],
      [60000, 75],
    ]);
  });
  it("shows a missing hotel as Unassigned", () => expect(r.events[1]?.hotel).toBe("Unassigned"));
  it("totals add up", () => {
    expect(r.totals).toEqual({
      invoiced: 180000,
      received: 140000,
      expenses: 52000,
      profit: 88000,
      margin: 62.9,
    });
  });
  it("general expenses (no event) stay out of every event and out of the event totals, but reduce the net", () => {
    expect(r.general).toBe(7000);
    expect(r.totals.expenses).toBe(52000);
    expect(r.netAfterGeneral).toBe(81000);
  });
  it("handles no events at all, with only general expenses", () => {
    const empty = buildReport([], 4500);
    expect(empty.events).toEqual([]);
    expect(empty.totals).toEqual({
      invoiced: 0,
      received: 0,
      expenses: 0,
      profit: 0,
      margin: null,
    });
    expect(empty.netAfterGeneral).toBe(-4500);
  });
  it("defaults general expenses to zero", () =>
    expect(buildReport([row({ received: 10 })]).netAfterGeneral).toBe(10));
});

// Mirrors what the database function counts: void invoices and voided payments never count.
describe("invoiceTotals (event invoiced / received from invoices and payments)", () => {
  const p = (amount: number, voided = false) => ({
    amount,
    voided_at: voided ? "2026-10-01T00:00:00Z" : null,
  });

  it("an event with no invoices is all zeros", () =>
    expect(invoiceTotals([])).toMatchObject({ invoiced: 0, received: 0, outstanding: 0 }));
  it("ignores voided payments", () => {
    const t = invoiceTotals([
      { amount: 100000, voided_at: null, payments: [p(60000), p(5000, true)] },
    ]);
    expect(t).toMatchObject({ invoiced: 100000, received: 60000, outstanding: 40000 });
  });
  it("ignores void invoices and the payments made on them", () => {
    const t = invoiceTotals([
      { amount: 100000, voided_at: null, payments: [p(60000)] },
      { amount: 50000, voided_at: "2026-10-02T00:00:00Z", payments: [p(20000)] },
    ]);
    expect(t).toMatchObject({ invoiced: 100000, received: 60000 });
  });
  it("then profit = received - expenses (the fixture used by the SQL tests: 60000 - 30000)", () => {
    const t = invoiceTotals([
      { amount: 100000, voided_at: null, payments: [p(60000), p(5000, true)] },
    ]);
    expect(profitOf(t.received, 30000).profit).toBe(30000);
  });
});

describe("report CSV", () => {
  const report = buildReport(
    [
      row({
        event_name: '=HYPERLINK("x")',
        client_name: "+92 Client",
        hotel_name: "@Hotel",
        invoiced: 1000,
        received: 500,
        expenses: 800,
      }),
    ],
    100,
  );
  const csv = buildCsv(
    ["Event", "Client"],
    reportCsvRows(report).map((r) => [r[0], r[2]]),
  );

  it("protects hostile text from the database (event, client, hotel)", () => {
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(`"'+92 Client"`);
    const full = buildCsv(
      ["h"],
      reportCsvRows(report).map((r) => [r[3]]),
    );
    expect(full).toContain(`"'@Hotel"`);
  });
  it("writes a loss as a real negative number, not text", () => {
    const line =
      buildCsv([], reportCsvRows(report))
        .split("\r\n")
        .find((l) => l.includes("HYPERLINK")) ?? "";
    expect(line.endsWith(",-300,-60")).toBe(true);
  });
  it("ends with totals, general expenses and net lines", () => {
    const rows = reportCsvRows(report);
    expect(rows.slice(-3).map((r) => r[0])).toEqual([
      "TOTAL (events)",
      "General expenses (no event)",
      "NET after general expenses",
    ]);
    expect(rows.at(-1)?.[7]).toBe(-400);
  });
});
