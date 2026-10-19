import { describe, expect, it } from "vitest";
import {
  paidTotal,
  remainingBalance,
  statusFromPayments,
  totalsAfterPayment,
  validatePaymentAmount,
} from "@/lib/payments";

const pay = (id: string, amount: number, paid_at: string, voided = false) => ({
  id,
  amount,
  paid_at,
  created_at: `${paid_at}T10:00:00Z`,
  voided_at: voided ? "2026-10-01T00:00:00Z" : null,
});
const today = new Date("2026-10-19T09:00:00Z");

describe("paidTotal / remainingBalance", () => {
  it("ignores voided payments", () => {
    const ps = [pay("a", 40000, "2026-09-01"), pay("b", 10000, "2026-09-02", true)];
    expect(paidTotal(ps)).toBe(40000);
    expect(remainingBalance(100000, ps)).toBe(60000);
  });
  it("voiding a payment restores the balance", () => {
    const before = [pay("a", 40000, "2026-09-01"), pay("b", 10000, "2026-09-02")];
    const after = [pay("a", 40000, "2026-09-01"), pay("b", 10000, "2026-09-02", true)];
    expect(remainingBalance(100000, before)).toBe(50000);
    expect(remainingBalance(100000, after)).toBe(60000);
  });
  it("handles decimals without float drift", () => {
    const ps = [pay("a", 0.1, "2026-09-01"), pay("b", 0.2, "2026-09-02")];
    expect(paidTotal(ps)).toBe(0.3);
    expect(remainingBalance(1, ps)).toBe(0.7);
  });
  it("never goes negative", () =>
    expect(remainingBalance(100, [pay("a", 150, "2026-09-01")])).toBe(0));
  it("is the full total with no payments", () => expect(remainingBalance(2500.5, [])).toBe(2500.5));
});

describe("validatePaymentAmount", () => {
  it("rejects zero, negative and NaN", () => {
    expect(validatePaymentAmount(0, 100)).not.toBeNull();
    expect(validatePaymentAmount(-5, 100)).not.toBeNull();
    expect(validatePaymentAmount(Number.NaN, 100)).not.toBeNull();
  });
  it("rejects more than the remaining balance but allows exactly the balance", () => {
    expect(validatePaymentAmount(100.01, 100)).not.toBeNull();
    expect(validatePaymentAmount(100, 100)).toBeNull();
  });
});

describe("statusFromPayments", () => {
  it("unpaid with no payments and no due date", () =>
    expect(statusFromPayments(1000, [], null, today)).toBe("unpaid"));
  it("partial after a part payment", () =>
    expect(statusFromPayments(1000, [pay("a", 400, "2026-10-01")], "2026-12-01", today)).toBe(
      "partial",
    ));
  it("paid once fully covered", () =>
    expect(
      statusFromPayments(
        1000,
        [pay("a", 400, "2026-10-01"), pay("b", 600, "2026-10-05")],
        "2026-12-01",
        today,
      ),
    ).toBe("paid"));
  it("overdue when past due with a balance", () =>
    expect(statusFromPayments(1000, [pay("a", 400, "2026-10-01")], "2026-10-10", today)).toBe(
      "overdue",
    ));
  it("a voided payment moves the status back", () =>
    expect(
      statusFromPayments(
        1000,
        [pay("a", 400, "2026-10-01"), pay("b", 600, "2026-10-05", true)],
        "2026-12-01",
        today,
      ),
    ).toBe("partial"));
  it("paid invoices are never overdue", () =>
    expect(statusFromPayments(1000, [pay("a", 1000, "2026-10-01")], "2026-01-01", today)).toBe(
      "paid",
    ));
});

describe("totalsAfterPayment (single-payment receipts)", () => {
  const ps = [
    pay("b", 30000, "2026-09-10"),
    pay("a", 50000, "2026-09-01"),
    pay("x", 5000, "2026-09-05", true),
  ];
  it("counts only payments up to and including this one, in date order", () => {
    expect(totalsAfterPayment(100000, ps, "a")).toEqual({ paidToDate: 50000, balanceAfter: 50000 });
    expect(totalsAfterPayment(100000, ps, "b")).toEqual({ paidToDate: 80000, balanceAfter: 20000 });
  });
  it("returns null for a voided or unknown payment", () => {
    expect(totalsAfterPayment(100000, ps, "x")).toBeNull();
    expect(totalsAfterPayment(100000, ps, "nope")).toBeNull();
  });
});
