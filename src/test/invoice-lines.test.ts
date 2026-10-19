import { describe, expect, it } from "vitest";
import { FALLBACK_DESCRIPTION, resolveLines } from "@/lib/invoice-lines";
import { invoiceStatus } from "@/lib/invoice-status";

describe("resolveLines", () => {
  it("falls back to one line for the whole total when there are no items", () => {
    expect(resolveLines(250000, [])).toEqual([
      { description: FALLBACK_DESCRIPTION, quantity: 1, unitPrice: 250000, amount: 250000 },
    ]);
  });

  it("uses the real items and multiplies quantity by unit price", () => {
    const lines = resolveLines(0, [
      { description: "Stage Decor", quantity: 1, unit_price: "120000" },
      { description: "Chair covers", quantity: 2.5, unit_price: 100 },
    ]);
    expect(lines.map((l) => l.amount)).toEqual([120000, 250]);
    expect(lines[0]?.description).toBe("Stage Decor");
  });
});

describe("invoiceStatus", () => {
  const today = new Date("2026-10-19T10:00:00Z");
  it("is paid when fully paid", () => expect(invoiceStatus(100, 100, "2020-01-01", today)).toBe("paid"));
  it("is overdue after the due date with a balance", () => expect(invoiceStatus(100, 40, "2026-10-18", today)).toBe("overdue"));
  it("is partial before the due date", () => expect(invoiceStatus(100, 40, "2026-10-30", today)).toBe("partial"));
  it("is unpaid with nothing paid and no due date", () => expect(invoiceStatus(100, 0, null, today)).toBe("unpaid"));
});
