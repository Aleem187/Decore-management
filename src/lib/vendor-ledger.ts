export type LedgerExpense = { amount: number | string; paid: boolean };
export type LedgerPayment = { amount: number | string };

/**
 * Payable = every bill (expense) linked to the vendor.
 * Paid = bills already marked paid at purchase + recorded ledger payments.
 * Pending = payable - paid (negative means the vendor holds an advance).
 */
export function vendorTotals(expenses: LedgerExpense[] = [], payments: LedgerPayment[] = []) {
  const payable = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const settledOnBill = expenses.filter((e) => e.paid).reduce((s, e) => s + Number(e.amount), 0);
  const paid = settledOnBill + payments.reduce((s, p) => s + Number(p.amount), 0);
  return { payable, paid, pending: payable - paid };
}
