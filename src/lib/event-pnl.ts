import { clientBalance } from "@/lib/clients";
import type { CsvCell } from "@/lib/csv";

/** invoiced / received for any set of invoices with their payments (void invoices and voided payments ignored). */
export const invoiceTotals = clientBalance;

/** One event as returned by the admin-only database function event_pnl(). */
export type EventPnlRow = {
  event_id: string;
  event_name: string;
  event_date: string;
  client_name: string;
  hotel_name: string | null;
  invoiced: number | string;
  received: number | string;
  expenses: number | string;
};

export type EventPnl = {
  eventId: string;
  eventName: string;
  eventDate: string;
  client: string;
  hotel: string;
  invoiced: number;
  received: number;
  expenses: number;
  /** Cash basis: received minus expenses. Negative is a loss. */
  profit: number;
  /** profit / received, as a percentage. null while nothing has been received. */
  margin: number | null;
};

const cents = (v: number | string | null | undefined) => Math.round((Number(v) || 0) * 100);
const money = (c: number) => c / 100;
const pct = (profit: number, received: number) =>
  received > 0 ? Math.round((profit / received) * 1000) / 10 : null;

/** Profit and margin for one set of totals (all amounts in PKR). */
export function profitOf(received: number | string, expenses: number | string) {
  const r = cents(received);
  const profit = r - cents(expenses);
  return { profit: money(profit), margin: pct(profit, r) };
}

export type PnlReport = {
  events: EventPnl[];
  totals: {
    invoiced: number;
    received: number;
    expenses: number;
    profit: number;
    margin: number | null;
  };
  /** Expenses not linked to any event in the period. They never count toward an event's profit. */
  general: number;
  /** Event profit minus general expenses. */
  netAfterGeneral: number;
};

/** Turns the database rows (plus the general-expense total) into the figures shown on the report page. */
export function buildReport(rows: EventPnlRow[], general: number | string = 0): PnlReport {
  const events: EventPnl[] = rows.map((r) => {
    const { profit, margin } = profitOf(r.received, r.expenses);
    return {
      eventId: r.event_id,
      eventName: r.event_name,
      eventDate: r.event_date,
      client: r.client_name,
      hotel: r.hotel_name ?? "Unassigned",
      invoiced: money(cents(r.invoiced)),
      received: money(cents(r.received)),
      expenses: money(cents(r.expenses)),
      profit,
      margin,
    };
  });
  const invoiced = events.reduce((s, e) => s + cents(e.invoiced), 0);
  const received = events.reduce((s, e) => s + cents(e.received), 0);
  const expenses = events.reduce((s, e) => s + cents(e.expenses), 0);
  const profit = received - expenses;
  const generalCents = cents(general);
  return {
    events,
    totals: {
      invoiced: money(invoiced),
      received: money(received),
      expenses: money(expenses),
      profit: money(profit),
      margin: pct(profit, received),
    },
    general: money(generalCents),
    netAfterGeneral: money(profit - generalCents),
  };
}

export const REPORT_HEADERS = [
  "Event",
  "Event date",
  "Client",
  "Hotel",
  "Invoiced (PKR)",
  "Received (PKR)",
  "Expenses (PKR)",
  "Profit (PKR)",
  "Margin (%)",
];

/** Report rows for CSV: events, then the totals, general expenses and net lines. */
export function reportCsvRows(report: PnlReport): CsvCell[][] {
  const rows: CsvCell[][] = report.events.map((e) => [
    e.eventName,
    e.eventDate,
    e.client,
    e.hotel,
    e.invoiced,
    e.received,
    e.expenses,
    e.profit,
    e.margin,
  ]);
  const t = report.totals;
  rows.push(["TOTAL (events)", "", "", "", t.invoiced, t.received, t.expenses, t.profit, t.margin]);
  rows.push([
    "General expenses (no event)",
    "",
    "",
    "",
    "",
    "",
    report.general,
    -report.general,
    "",
  ]);
  rows.push([
    "NET after general expenses",
    "",
    "",
    "",
    "",
    "",
    t.expenses + report.general,
    report.netAfterGeneral,
    "",
  ]);
  return rows;
}
