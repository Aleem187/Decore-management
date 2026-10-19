export type InvoiceStatus = "unpaid" | "partial" | "paid" | "overdue";

/**
 * Mirrors public.compute_invoice_status in the database. The database value is
 * recalculated on every write and daily; this keeps the screen correct in between
 * (an invoice becomes overdue the day after its due date, with no write).
 */
export function invoiceStatus(
  amount: number | string,
  paid: number | string,
  due: string | null | undefined,
  today = new Date(),
): InvoiceStatus {
  const a = Number(amount) || 0;
  const p = Number(paid) || 0;
  if (a > 0 && p >= a) return "paid";
  if (due && due < today.toISOString().slice(0, 10)) return "overdue";
  return p > 0 ? "partial" : "unpaid";
}
