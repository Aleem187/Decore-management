import { bucketsFor, inRange, karachiDate, type DateRange } from "@/lib/date-range";

export type InvoiceRow = {
  amount: number | string;
  amount_paid: number | string;
  due_date: string | null;
  created_at: string;
};
export type PaymentRow = { amount: number | string; paid_at: string };
export type ExpenseRow = { amount: number | string; expense_date: string; event_id: string | null };
export type EventRow = {
  id: string;
  event_date: string;
  hotel: string | null;
  package_price: number | string | null;
};

const n = (v: number | string | null | undefined) => Number(v) || 0;
const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);

export type DashboardStats = {
  invoiced: number;
  received: number;
  expenses: number;
  outstanding: number;
  overdue: number;
  flow: { label: string; In: number; Out: number }[];
  hasFlow: boolean;
  /** Profit figures exist only when `includeProfit` is true (admin). */
  profit?: {
    net: number;
    hotels: { hotel: string; Revenue: number; Cost: number; bookings: number }[];
  };
};

/**
 * Everything on the dashboard for one date range (inclusive Karachi days).
 * - Invoiced: invoices issued in the range.
 * - Received: payments dated in the range (cash basis).
 * - Outstanding / Overdue: the ALL-TIME unpaid balance on every non-void invoice, ignoring the range;
 *   overdue = the part of it whose due date is before `today`. The caller passes only non-void invoices.
 * - Profit (net, hotel table) is only computed when `includeProfit` is set, so an accountant's data never contains it.
 */
export function summarize(
  input: {
    invoices: InvoiceRow[];
    payments: PaymentRow[];
    expenses: ExpenseRow[];
    events: EventRow[];
  },
  range: DateRange,
  today: string,
  includeProfit: boolean,
): DashboardStats {
  const issued = input.invoices.filter((i) => inRange(karachiDate(i.created_at), range));
  const pays = input.payments.filter((p) => inRange(p.paid_at, range));
  const exps = input.expenses.filter((e) => inRange(e.expense_date, range));

  const received = sum(pays, (p) => n(p.amount));
  const expenses = sum(exps, (e) => n(e.amount));
  const open = input.invoices
    .map((i) => ({ due: i.due_date, balance: Math.max(0, n(i.amount) - n(i.amount_paid)) }))
    .filter((i) => i.balance > 0);

  const flow = bucketsFor(range).map((b) => ({
    label: b.label,
    In: sum(
      pays.filter((p) => p.paid_at >= b.from && p.paid_at <= b.to),
      (p) => n(p.amount),
    ),
    Out: sum(
      exps.filter((e) => e.expense_date >= b.from && e.expense_date <= b.to),
      (e) => n(e.amount),
    ),
  }));

  const stats: DashboardStats = {
    invoiced: sum(issued, (i) => n(i.amount)),
    received,
    expenses,
    outstanding: sum(open, (i) => i.balance),
    overdue: sum(
      open.filter((i) => i.due && i.due < today),
      (i) => i.balance,
    ),
    flow,
    hasFlow: flow.some((f) => f.In > 0 || f.Out > 0),
  };

  if (includeProfit) {
    const evs = input.events.filter((e) => inRange(e.event_date, range));
    const byHotel = new Map<
      string,
      { hotel: string; Revenue: number; Cost: number; bookings: number }
    >();
    for (const ev of evs) {
      const name = ev.hotel ?? "Unassigned";
      const row = byHotel.get(name) ?? { hotel: name, Revenue: 0, Cost: 0, bookings: 0 };
      row.Revenue += n(ev.package_price);
      row.Cost += sum(
        input.expenses.filter((x) => x.event_id === ev.id),
        (x) => n(x.amount),
      );
      row.bookings += 1;
      byHotel.set(name, row);
    }
    stats.profit = {
      net: received - expenses,
      hotels: [...byHotel.values()].sort((a, b) => b.bookings - a.bookings),
    };
  }
  return stats;
}
