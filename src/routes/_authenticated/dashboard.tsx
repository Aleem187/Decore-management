import { requireRole, useMe } from "@/lib/auth";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate, pkr } from "@/lib/format";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv, stamp } from "@/lib/csv";
import { invoiceStatus } from "@/lib/invoice-status";
import { vendorTotals } from "@/lib/vendor-ledger";
import { StatusPill } from "@/components/CrudPage";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Décor Studio" }, { name: "description", content: "Revenue, expenses and event overview." }, { property: "og:title", content: "Dashboard — Décor Studio" }, { property: "og:description", content: "Revenue, expenses and event overview." }] }),
  beforeLoad: ({ context }) => requireRole(context.queryClient, ["admin", "accountant"]),
  component: Dashboard,
});

function useData() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [inv, exp, ev, vp] = await Promise.all([
        supabase.from("invoices").select("*").is("deleted_at", null).is("voided_at", null),
        supabase.from("expenses").select("*").is("deleted_at", null),
        supabase.from("events").select("*, hotels(name), event_financials(package_price)").is("deleted_at", null).order("event_date"),
        supabase.from("vendor_payments").select("vendor_id, amount").is("deleted_at", null),
      ]);
      return { invoices: inv.data ?? [], expenses: exp.data ?? [], events: ev.data ?? [], vendorPayments: vp.data ?? [] };
    },
  });
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border bg-card p-5 shadow-soft">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-3xl font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function Dashboard() {
  const { data: me } = useMe();
  const { data } = useData();
  if (!data || !me) return <p className="text-muted-foreground">Loading…</p>;
  const { invoices, expenses, events, vendorPayments } = data;
  // Pending vendor bills = what each vendor is still owed (bills minus payments), never below zero.
  const pendingVendorBills = [...new Set(expenses.map((e) => e.vendor_id).filter((v): v is string => !!v))].reduce(
    (sum, id) => sum + Math.max(0, vendorTotals(expenses.filter((e) => e.vendor_id === id), vendorPayments.filter((p) => p.vendor_id === id)).pending), 0);
  const unlinkedUnpaid = expenses.filter((e) => !e.vendor_id && !e.paid).reduce((s, e) => s + Number(e.amount), 0);
  const received = invoices.reduce((s, i) => s + Number(i.amount_paid), 0);
  const billed = invoices.reduce((s, i) => s + Number(i.amount), 0);
  const spent = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events.filter((e) => e.event_date >= today && e.status !== "paid").slice(0, 6);

  // monthly cash flow (last 6 months)
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(); d.setMonth(d.getMonth() - (5 - i));
    return d.toISOString().slice(0, 7);
  });
  const flow = months.map((m) => ({
    month: new Date(m + "-01").toLocaleDateString("en-GB", { month: "short" }),
    In: invoices.filter((i) => i.created_at.slice(0, 7) === m).reduce((s, i) => s + Number(i.amount_paid), 0),
    Out: expenses.filter((e) => e.expense_date.slice(0, 7) === m).reduce((s, e) => s + Number(e.amount), 0),
  }));

  // per hotel profit
  const byHotel = new Map<string, { hotel: string; Revenue: number; Cost: number; bookings: number }>();
  for (const ev of events) {
    const name = (ev.hotels as { name: string } | null)?.name ?? "Unassigned";
    const row = byHotel.get(name) ?? { hotel: name, Revenue: 0, Cost: 0, bookings: 0 };
    row.Revenue += Number((ev.event_financials as { package_price: number } | null)?.package_price ?? 0);
    row.Cost += expenses.filter((x) => x.event_id === ev.id).reduce((s, x) => s + Number(x.amount), 0);
    row.bookings += 1;
    byHotel.set(name, row);
  }
  const hotels = [...byHotel.values()].sort((a, b) => b.bookings - a.bookings);

  const isAdmin = me.role === "admin";
  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm uppercase tracking-[0.25em] text-gold">{isAdmin ? "Owner overview" : "Accounts desk"}</p>
        <h1 className="text-4xl font-semibold">Hello, {me.name || "there"}</h1>
      </div>

      {isAdmin ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Revenue received" value={pkr(received)} />
          <Stat label="Total expenses" value={pkr(spent)} />
          <Stat label="Net profit" value={pkr(received - spent)} tone={received - spent >= 0 ? "text-success" : "text-destructive"} />
          <Stat label="Outstanding" value={pkr(billed - received)} tone="text-warning" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Cash in (this month)" value={pkr(flow[5]?.In ?? 0)} />
          <Stat label="Cash out (this month)" value={pkr(flow[5]?.Out ?? 0)} />
          <Stat label="Unpaid invoices" value={String(invoices.filter((i) => invoiceStatus(i.amount, i.amount_paid, i.due_date) !== "paid").length)} tone="text-warning" />
          <Stat label="Pending vendor bills" value={pkr(pendingVendorBills + unlinkedUnpaid)} tone="text-destructive" />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-5">
          <h2 className="mb-4 text-2xl font-semibold">Cash flow</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={flow}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" fontSize={12} /><YAxis fontSize={12} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => pkr(v)} /><Legend />
              <Bar dataKey="In" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Out" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {isAdmin ? (
          <div className="rounded-lg border bg-card p-5">
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
              <p className="py-16 text-center text-sm text-muted-foreground">No events yet — add one to see hotel performance.</p>
            ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={hotels.slice(0, 6)}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="hotel" fontSize={11} /><YAxis fontSize={12} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(v: number) => pkr(v)} /><Legend />
                <Bar dataKey="Revenue" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Cost" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            )}
          </div>
        ) : (
          <div className="rounded-lg border bg-card p-5">
            <h2 className="mb-4 text-2xl font-semibold">Today's expenses</h2>
            <ul className="divide-y">
              {expenses.filter((e) => e.expense_date === today).map((e) => (
                <li key={e.id} className="flex justify-between py-2 text-sm"><span>{e.category} — {e.description}</span><span>{pkr(e.amount)}</span></li>
              ))}
              {!expenses.some((e) => e.expense_date === today) && <li className="py-6 text-center text-sm text-muted-foreground">No expenses logged today.</li>}
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
              <div><div className="font-medium">{e.name}</div><div className="text-muted-foreground">{fmtDate(e.event_date)} · {(e.hotels as { name: string } | null)?.name ?? "—"}</div></div>
              <StatusPill value={e.status} />
            </li>
          ))}
          {upcoming.length === 0 && <li className="py-6 text-center text-muted-foreground">No upcoming events.</li>}
        </ul>
      </div>
      )}
    </div>
  );
}
