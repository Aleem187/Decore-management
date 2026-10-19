import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { requireRole, useMe } from "@/lib/auth";
import { fmtDate, pkr } from "@/lib/format";
import { invoiceStatus } from "@/lib/invoice-status";
import { invoiceTotals, profitOf } from "@/lib/event-pnl";
import { paidTotal } from "@/lib/payments";
import { StatusPill } from "@/components/CrudPage";
import { ClashList } from "@/components/ClashList";
import { EventTeam } from "@/components/EventTeam";
import { findVenueClashes } from "@/lib/clashes";
import { timeRange } from "@/lib/calendar";
import { useSameDayEvents } from "@/hooks/use-same-day-events";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/events/$eventId")({
  head: () => ({ meta: [{ title: "Event — Décor Studio" }] }),
  beforeLoad: ({ context }) => requireRole(context.queryClient, ["admin", "accountant"]),
  component: EventDetail,
});

function Metric({
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
    <div className="min-w-0 rounded-lg border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={`break-words font-display text-2xl font-semibold ${tone ?? ""}`}>{value}</div>
      {note && <div className="mt-0.5 text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

/** Venue double-booking warning, shown to everyone on the team. */
function VenueClashBanner({
  event,
}: {
  event: {
    id: string;
    event_date: string;
    start_time: string | null;
    end_time: string | null;
    status: string;
    hotel_id: string | null;
  };
}) {
  const sameDay = useSameDayEvents(event.hotel_id ? event.event_date : null);
  const clashes = findVenueClashes(event, sameDay.events);
  return (
    <ClashList
      title="This venue has another event at an overlapping time on the same date."
      clashes={clashes}
    />
  );
}

function EventDetail() {
  const { eventId } = Route.useParams();
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";

  // Everything an accountant is allowed to see: the event, its invoices and what was paid on them.
  const { data, isLoading, error } = useQuery({
    queryKey: ["event", eventId],
    queryFn: async () => {
      const [event, invoices] = await Promise.all([
        supabase
          .from("events")
          .select(
            "id, name, event_date, start_time, end_time, hotel_id, event_type, status, client_id, client_name, hotels(name), clients(name)",
          )
          .eq("id", eventId)
          .is("deleted_at", null)
          .maybeSingle(),
        supabase
          .from("invoices")
          .select(
            "id, invoice_no, kind, amount, due_date, voided_at, created_at, payments(amount, voided_at)",
          )
          .eq("event_id", eventId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
      ]);
      for (const r of [event, invoices]) if (r.error) throw r.error;
      return { event: event.data, invoices: invoices.data ?? [] };
    },
  });

  // Cost and profit come only from admin-only database functions / rows. Accountants never request them
  // (and the database would refuse if they did).
  const { data: pnl } = useQuery({
    enabled: isAdmin,
    queryKey: ["event", eventId, "pnl"],
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const [totals, expenses] = await Promise.all([
        supabase.rpc("event_pnl_one", { _event_id: eventId }),
        supabase
          .from("expenses")
          .select("id, expense_date, category, description, amount, paid, vendors(name)")
          .eq("event_id", eventId)
          .is("deleted_at", null)
          .order("expense_date", { ascending: false }),
      ]);
      for (const r of [totals, expenses]) if (r.error) throw r.error;
      return {
        totals: totals.data?.[0] ?? { invoiced: 0, received: 0, expenses: 0 },
        expenses: expenses.data ?? [],
      };
    },
  });

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-destructive">{(error as Error).message}</p>;
  const event = data?.event;
  const back = isAdmin
    ? { to: "/events" as const, label: "All events" }
    : { to: "/invoices" as const, label: "Invoices" };
  if (!event || !data) {
    return (
      <div className="space-y-3">
        <Link
          to={back.to}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          {back.label}
        </Link>
        <p>This event was not found. It may have been deleted.</p>
      </div>
    );
  }

  const money = invoiceTotals(data.invoices);
  const hotel = (event.hotels as { name: string } | null)?.name ?? "Unassigned";
  const clientRecord = event.clients as { name: string } | null;
  const result = pnl ? profitOf(pnl.totals.received, pnl.totals.expenses) : null;
  const invoiced = pnl ? Number(pnl.totals.invoiced) : money.invoiced;
  const received = pnl ? Number(pnl.totals.received) : money.received;

  return (
    <div className="space-y-6">
      <Link
        to={back.to}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        {back.label}
      </Link>

      <div className="space-y-1">
        <h1 className="break-words text-3xl font-semibold sm:text-4xl">{event.name}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{fmtDate(event.event_date)}</span>
          <span>{timeRange(event.start_time, event.end_time)}</span>
          <span>{event.event_type}</span>
          <span>{hotel}</span>
          {event.client_id ? (
            <Link
              to="/clients/$clientId"
              params={{ clientId: event.client_id }}
              className="underline-offset-4 hover:underline"
            >
              {clientRecord?.name ?? event.client_name}
            </Link>
          ) : (
            <span>{event.client_name}</span>
          )}
          <StatusPill value={event.status} />
        </div>
      </div>

      <VenueClashBanner event={event} />

      <div className={`grid gap-3 sm:grid-cols-2 ${isAdmin ? "lg:grid-cols-4" : ""}`}>
        <Metric label="Total invoiced" value={pkr(invoiced)} note="Void invoices excluded" />
        <Metric
          label="Total received"
          value={pkr(received)}
          tone="text-success"
          note="Voided payments excluded"
        />
        {isAdmin && pnl && result && (
          <>
            <Metric label="Total expenses" value={pkr(pnl.totals.expenses)} />
            <Metric
              label={result.profit < 0 ? "Loss" : "Profit"}
              value={pkr(result.profit)}
              tone={result.profit < 0 ? "text-destructive" : "text-success"}
              note={`${result.margin === null ? "No margin yet" : `${result.margin}% margin`} · received minus expenses`}
            />
          </>
        )}
      </div>
      {!isAdmin && (
        <p className="text-xs text-muted-foreground">
          Costs and profit for events are visible to admins only.
        </p>
      )}

      <section className="space-y-2">
        <h2 className="text-2xl font-semibold">Invoices</h2>
        <div className="rounded-lg border bg-card shadow-soft">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No.</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead className="hidden sm:table-cell">Paid</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.invoices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    No invoices for this event yet.
                  </TableCell>
                </TableRow>
              )}
              {data.invoices.map((inv) => {
                const paid = paidTotal(inv.payments ?? []);
                const status = inv.voided_at
                  ? "voided"
                  : invoiceStatus(Number(inv.amount), paid, inv.due_date);
                return (
                  <TableRow key={inv.id} className={inv.voided_at ? "text-muted-foreground" : ""}>
                    <TableCell className="font-mono text-xs">{inv.invoice_no}</TableCell>
                    <TableCell>{pkr(inv.amount)}</TableCell>
                    <TableCell className="hidden sm:table-cell">{pkr(paid)}</TableCell>
                    <TableCell>
                      <StatusPill value={status} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      {isAdmin && <EventTeam event={event} />}

      {isAdmin && (
        <section className="space-y-2">
          <h2 className="text-2xl font-semibold">Expenses</h2>
          <div className="rounded-lg border bg-card shadow-soft">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Expense</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead className="hidden sm:table-cell">Paid</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pnl && pnl.expenses.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      No expenses linked to this event. Link them from the Expenses page.
                    </TableCell>
                  </TableRow>
                )}
                {pnl?.expenses.map((x) => (
                  <TableRow key={x.id}>
                    <TableCell className="whitespace-nowrap">{fmtDate(x.expense_date)}</TableCell>
                    <TableCell>
                      {x.category}
                      {x.description ? ` — ${x.description}` : ""}
                      {(x.vendors as { name: string } | null)?.name && (
                        <div className="text-xs text-muted-foreground">
                          {(x.vendors as { name: string }).name}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{pkr(x.amount)}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {x.paid ? "Yes" : <span className="text-destructive">Pending</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
    </div>
  );
}
