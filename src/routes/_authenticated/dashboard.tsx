import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { displayName, requireRole, useMe } from "@/lib/auth";
import { downloadCsv, stamp } from "@/lib/csv";
import { summarize } from "@/lib/dashboard-stats";
import { karachiDate } from "@/lib/date-range";
import { compactNumber, fmtDate, pkr } from "@/lib/format";
import { vendorTotals } from "@/lib/vendor-ledger";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/CrudPage";
import { RangeFilter } from "@/components/RangeFilter";
import { useDateRange } from "@/hooks/use-date-range";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Décor Studio" },
      { name: "description", content: "Revenue, expenses and event overview." },
      { property: "og:title", content: "Dashboard — Décor Studio" },
      { property: "og:description", content: "Revenue, expenses and event overview." },
    ],
  }),
  beforeLoad: ({ context }) => requireRole(context.queryClient, ["admin", "accountant"]),
  component: Dashboard,
});

function useData() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [inv, pay, exp, ev, vp] = await Promise.all([
        supabase
          .from("invoices")
          .select("amount, amount_paid, due_date, created_at")
          .is("deleted_at", null)
          .is("voided_at", null),
        supabase.from("payments").select("amount, paid_at").is("voided_at", null),
        supabase.from("expenses").select("*").is("deleted_at", null),
        supabase
          .from("events")
          .select("*, hotels(name), event_financials(package_price)")
          .is("deleted_at", null)
          .order("event_date"),
        supabase.from("vendor_payments").select("vendor_id, amount").is("deleted_at", null),
      ]);
      return {
        invoices: inv.data ?? [],
        payments: pay.data ?? [],
        expenses: exp.data ?? [],
        events: ev.data ?? [],
        vendorPayments: vp.data ?? [],
      };
    },
  });
}

function Stat({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  value: string;
  tone?: string;
  note?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-card p-5 shadow-soft">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div
        className={`mt-1 break-words font-display text-2xl font-semibold sm:text-3xl ${tone ?? ""}`}
      >
        {value}
      </div>
      {note && <div className="mt-1 text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

function Dashboard() {
  const { data: me } = useMe();
  const { data } = useData();
  const dateRange = useDateRange();
  const { range } = dateRange;
  const today = karachiDate();
  const isAdmin = me?.role === "admin";

  const stats = data
    ? summarize(
        {
          invoices: data.invoices,
          payments: data.payments,
          expenses: data.expenses,
          events: data.events.filter((e) => e.status !== "cancelled").map((e) => ({
            id: e.id,
            event_date: e.event_date,
            hotel: (e.hotels as { name: string } | null)?.name ?? null,
            package_price:
              (e.event_financials as { package_price: number } | null)?.package_price ?? 0,
          })),
        },
        range,
        today,
        isAdmin,
      )
    : null;

  if (!data || !me || !stats) return <p className="text-muted-foreground">Loading…</p>;
  const { expenses, events, vendorPayments } = data;

  // Pending vendor bills = what each vendor is still owed (bills minus payments), as of today.
  const pendingVendorBills =
    [...new Set(expenses.map((e) => e.vendor_id).filter((v): v is string => !!v))].reduce(
      (sum, id) =>
        sum +
        Math.max(
          0,
          vendorTotals(
            expenses.filter((e) => e.vendor_id === id),
            vendorPayments.filter((p) => p.vendor_id === id),
          ).pending,
        ),
      0,
    ) + expenses.filter((e) => !e.vendor_id && !e.paid).reduce((s, e) => s + Number(e.amount), 0);

  const upcoming = events.filter((e) => e.event_date >= today && e.status !== "paid" && e.status !== "cancelled").slice(0, 6);
  const hotels = stats.profit?.hotels ?? [];
  const period = dateRange.label;
  const outstandingNote = `All unpaid invoices · ${stats.overdue > 0 ? `${pkr(stats.overdue)} overdue` : "nothing overdue"}`;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm uppercase tracking-[0.25em] text-gold">
            {isAdmin ? "Owner overview" : "Accounts desk"}
          </p>
          <h1 className="break-words text-3xl font-semibold sm:text-4xl">
            Hello, {displayName(me)}
          </h1>
        </div>
        <RangeFilter range={dateRange} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Invoiced" value={pkr(stats.invoiced)} note="Invoices issued in this period" />
        <Stat
          label="Received"
          value={pkr(stats.received)}
          tone="text-success"
          note="Payments received in this period"
        />
        <Stat
          label="Outstanding"
          value={pkr(stats.outstanding)}
          tone="text-warning"
          note={outstandingNote}
        />
        {isAdmin && stats.profit ? (
          <>
            <Stat label="Total expenses" value={pkr(stats.expenses)} />
            <Stat
              label="Net profit"
              value={pkr(stats.profit.net)}
              tone={stats.profit.net >= 0 ? "text-success" : "text-destructive"}
              note="Received minus expenses"
            />
          </>
        ) : (
          <>
            <Stat label="Cash out" value={pkr(stats.expenses)} note="Expenses in this period" />
            <Stat
              label="Pending vendor bills"
              value={pkr(pendingVendorBills)}
              tone="text-destructive"
              note="Owed to vendors as of today"
            />
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 rounded-lg border bg-card p-5">
          <h2 className="mb-4 text-2xl font-semibold">Cash flow</h2>
          {stats.hasFlow ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={stats.flow}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" fontSize={12} interval="preserveStartEnd" minTickGap={16} />
                <YAxis
                  fontSize={12}
                  allowDecimals={false}
                  domain={[0, "auto"]}
                  tickCount={5}
                  tickFormatter={compactNumber}
                  width={48}
                />
                <Tooltip formatter={(v: number) => pkr(v)} />
                <Legend />
                <Bar dataKey="In" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Out" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[260px] flex-col items-center justify-center gap-1 text-center">
              <p className="text-lg font-medium">No cash flow yet</p>
              <p className="text-sm text-muted-foreground">
                No payments received or expenses recorded for {period}.
              </p>
            </div>
          )}
        </div>

        {isAdmin ? (
          <div className="min-w-0 rounded-lg border bg-card p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-2xl font-semibold">Hotel performance</h2>
              <Button
                size="sm"
                variant="outline"
                disabled={hotels.length === 0}
                onClick={() =>
                  downloadCsv(
                    `hotel-performance-${stamp()}`,
                    ["Hotel", "Bookings", "Revenue (PKR)", "Cost (PKR)", "Profit (PKR)"],
                    hotels.map((h) => [h.hotel, h.bookings, h.Revenue, h.Cost, h.Revenue - h.Cost]),
                  )
                }
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Export Report (CSV)</span>
                <span className="sm:hidden">CSV</span>
              </Button>
            </div>
            {hotels.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                No events held in {period}.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={hotels.slice(0, 6)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="hotel"
                    fontSize={11}
                    interval={0}
                    tickFormatter={(v: string) => (v.length > 12 ? `${v.slice(0, 11)}…` : v)}
                  />
                  <YAxis
                    fontSize={12}
                    allowDecimals={false}
                    domain={[0, "auto"]}
                    tickCount={5}
                    tickFormatter={compactNumber}
                    width={48}
                  />
                  <Tooltip formatter={(v: number) => pkr(v)} />
                  <Legend />
                  <Bar dataKey="Revenue" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Cost" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        ) : (
          <div className="min-w-0 rounded-lg border bg-card p-5">
            <h2 className="mb-4 text-2xl font-semibold">Today's expenses</h2>
            <ul className="divide-y">
              {expenses
                .filter((e) => e.expense_date === today)
                .map((e) => (
                  <li key={e.id} className="flex justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 break-words">
                      {e.category} — {e.description}
                    </span>
                    <span className="shrink-0">{pkr(e.amount)}</span>
                  </li>
                ))}
              {!expenses.some((e) => e.expense_date === today) && (
                <li className="py-6 text-center text-sm text-muted-foreground">
                  No expenses logged today.
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="rounded-lg border bg-card p-5">
          <h2 className="mb-4 text-2xl font-semibold">Upcoming events</h2>
          <ul className="divide-y">
            {upcoming.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{e.name}</div>
                  <div className="text-muted-foreground">
                    {fmtDate(e.event_date)} · {(e.hotels as { name: string } | null)?.name ?? "—"}
                  </div>
                </div>
                <StatusPill value={e.status} />
              </li>
            ))}
            {upcoming.length === 0 && (
              <li className="py-6 text-center text-muted-foreground">No upcoming events.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
