import { EVENT_TYPES } from "@/lib/brand";
import { requireRole, useMe } from "@/lib/auth";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CrudPage, StatusPill, useOptions } from "@/components/CrudPage";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EventChecklist } from "@/components/EventChecklist";
import { WhatsAppButton } from "@/components/WhatsAppButton";
import { fmtDate, pkr } from "@/lib/format";
import { timeRange } from "@/lib/calendar";
import { describeTimes, findVenueClashes } from "@/lib/clashes";

const types: string[] = [...EVENT_TYPES];

export const Route = createFileRoute("/_authenticated/events/")({
  head: () => ({ meta: [{ title: "Events — Sarim Events Planner" }, { name: "description", content: "Decor projects and status tracker." }, { property: "og:title", content: "Events — Sarim Events Planner" }, { property: "og:description", content: "Decor projects and status tracker." }] }),
  beforeLoad: ({ context }) => requireRole(context.queryClient, ["admin"]),
  component: EventsPage,
});

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Package price and estimated cost live in the admin-only event_financials table.
function flattenFinancials(r: Row): Row {
  const f = Array.isArray(r["event_financials"]) ? r["event_financials"][0] : r["event_financials"];
  return { ...r, package_price: Number(f?.package_price ?? 0), estimated_cost: Number(f?.estimated_cost ?? 0) };
}

// Warn (and let the admin override) when the venue already has an event at the same date and time.
async function warnAboutVenueClash(form: Row) {
  if (!form["hotel_id"] || !form["event_date"] || form["status"] === "cancelled") return;
  const { data, error } = await supabase
    .from("events")
    .select("id, name, event_date, start_time, end_time, status, hotel_id")
    .eq("hotel_id", form["hotel_id"])
    .eq("event_date", form["event_date"])
    .is("deleted_at", null);
  if (error) throw error;
  const target = {
    id: form["id"] ?? "new",
    event_date: form["event_date"],
    start_time: form["start_time"] || null,
    end_time: form["end_time"] || null,
    status: form["status"] ?? "upcoming",
    hotel_id: form["hotel_id"],
  };
  const clashes = findVenueClashes(target, data);
  if (clashes.length === 0) return;
  const lines = clashes.map((c) => `• ${c.name} (${describeTimes(c)})`).join("\n");
  if (!window.confirm(`This venue already has an event at an overlapping time on this date:\n\n${lines}\n\nSave anyway?`)) {
    throw new Error("Not saved: the venue is already booked");
  }
}

async function saveFinancials(eventId: string, form: Row) {
  const { error } = await supabase.from("event_financials").upsert({
    event_id: eventId,
    package_price: Number(form["package_price"] ?? 0),
    estimated_cost: Number(form["estimated_cost"] ?? 0),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

function EventsPage() {
  const { data: me } = useMe();
  const hotels = useOptions("hotels");
  const clients = useOptions("clients");
  const [checklist, setChecklist] = useState<{ id: string; name: string } | null>(null);
  return (
    <>
    <CrudPage table="events" title="Events" subtitle="Upcoming → In progress → Completed → Paid" orderBy="event_date"
      select="*, hotels(name), clients(phone, whatsapp), expenses(amount), invoices(amount_paid, voided_at), event_financials(package_price, estimated_cost)"
      normalize={flattenFinancials} afterSave={saveFinancials} beforeSave={warnAboutVenueClash} canWrite={me?.role === "admin"} defaults={{ event_type: "Wedding", status: "upcoming" }}
      columns={[
        { key: "event_date", label: "Date", render: (r) => <>{fmtDate(r.event_date)}<div className="text-xs text-muted-foreground">{timeRange(r.start_time, r.end_time)}</div></> },
        { key: "name", label: "Event", render: (r) => <><Link to="/events/$eventId" params={{ eventId: r.id }} className="font-medium underline-offset-4 hover:underline">{r.name}</Link><div className="text-xs text-muted-foreground">{r.event_type} · {r.client_name}</div></> },
        { key: "hotels.name", label: "Hotel", render: (r) => r.hotels?.name ?? "—" },
        { key: "package_price", label: "Package", render: (r) => pkr(r.package_price) },
        { key: "estimated_cost", label: "Est. vs actual cost", render: (r) => {
          const actual = (r.expenses ?? []).reduce((s: number, e: { amount: number }) => s + Number(e.amount), 0);
          return <>{pkr(r.estimated_cost)}<div className={`text-xs ${actual > r.estimated_cost ? "text-destructive" : "text-muted-foreground"}`}>actual {pkr(actual)}</div></>;
        } },
        { key: "status", label: "Status", render: (r) => <StatusPill value={r.status} /> },
        { key: "materials", label: "Materials", render: (r) => (
          <Button size="sm" variant="outline" onClick={() => setChecklist({ id: r.id, name: r.name })}><ClipboardList className="h-4 w-4" />Checklist</Button>
        ) },
        { key: "whatsapp", label: "Client", render: (r) => (
          <WhatsAppButton update={{
            clientName: r.client_name, eventName: r.name, eventDate: r.event_date, total: r.package_price, phone: r.clients?.whatsapp ?? r.clients?.phone ?? r.client_phone,
            paid: (r.invoices ?? []).filter((i: { voided_at: string | null }) => !i.voided_at).reduce((s: number, i: { amount_paid: number }) => s + Number(i.amount_paid), 0),
          }} />
        ) },
      ]}
      fields={[
        { key: "name", label: "Event name", required: true },
        { key: "event_date", label: "Date", type: "date", required: true },
        { key: "start_time", label: "Start time (optional)", type: "time" },
        { key: "end_time", label: "End time (set both, or neither)", type: "time" },
        { key: "event_type", label: "Event type", type: "select", options: types.map((t) => ({ value: t, label: t })), required: true },
        { key: "hotel_id", label: "Hotel", type: "select", options: hotels },
        { key: "client_id", label: "Client", type: "select", options: clients },
        { key: "client_name", label: "Client name (only if not in the list above)" },
        { key: "client_phone", label: "Client phone" },
        { key: "package_price", label: "Package price (PKR)", type: "number", extra: true },
        { key: "estimated_cost", label: "Estimated cost (PKR)", type: "number", extra: true },
        { key: "status", label: "Status", type: "select", options: ["upcoming", "in_progress", "completed", "paid", "cancelled"].map((s) => ({ value: s, label: s.replace("_", " ") })), required: true },
        { key: "notes", label: "Material checklist / notes", type: "textarea" },
      ]}
    />
    <Dialog open={!!checklist} onOpenChange={(o) => !o && setChecklist(null)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-2xl">Material &amp; inventory checklist</DialogTitle></DialogHeader>
        {checklist && (
          <>
            <p className="-mt-2 text-sm text-muted-foreground">{checklist.name}</p>
            <EventChecklist eventId={checklist.id} />
          </>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
