import { invoiceStatus, type InvoiceStatus } from "@/lib/invoice-status";

export const PAYMENT_METHODS = ["cash", "bank", "jazzcash", "easypaisa", "cheque"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  bank: "Bank transfer",
  jazzcash: "JazzCash",
  easypaisa: "Easypaisa",
  cheque: "Cheque",
};

export type PaymentLike = {
  id?: string;
  amount: number | string;
  paid_at?: string;
  created_at?: string;
  voided_at: string | null;
};

const cents = (n: number | string) => Math.round((Number(n) || 0) * 100);

/** Sum of payments that have not been voided. Works in whole cents to avoid float drift. */
export function paidTotal(payments: PaymentLike[]): number {
  return payments.filter((p) => !p.voided_at).reduce((s, p) => s + cents(p.amount), 0) / 100;
}

/** What is still owed on an invoice (never negative). */
export function remainingBalance(total: number | string, payments: PaymentLike[]): number {
  return Math.max(cents(total) - Math.round(paidTotal(payments) * 100), 0) / 100;
}

/** Same rule the database enforces: a payment must be above zero and not exceed the remaining balance. */
export function validatePaymentAmount(amount: number, remaining: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return "Enter an amount greater than zero";
  if (cents(amount) > cents(remaining)) return "Amount is more than the remaining balance";
  return null;
}

/** Invoice status derived from its payments (mirrors compute_invoice_status in the database). */
export function statusFromPayments(
  total: number | string,
  payments: PaymentLike[],
  due: string | null | undefined,
  today = new Date(),
): InvoiceStatus {
  return invoiceStatus(total, paidTotal(payments), due, today);
}

/**
 * Totals as they stood right after one payment: every non-voided payment up to and
 * including it, ordered by payment date then entry time. Used for single-payment receipts.
 */
export function totalsAfterPayment(
  total: number | string,
  payments: PaymentLike[],
  paymentId: string,
) {
  const ordered = [...payments]
    .filter((p) => !p.voided_at)
    .sort(
      (a, b) =>
        (a.paid_at ?? "").localeCompare(b.paid_at ?? "") ||
        (a.created_at ?? "").localeCompare(b.created_at ?? ""),
    );
  const idx = ordered.findIndex((p) => p.id === paymentId);
  if (idx === -1) return null;
  const paidToDate = paidTotal(ordered.slice(0, idx + 1));
  return { paidToDate, balanceAfter: remainingBalance(total, ordered.slice(0, idx + 1)) };
}
