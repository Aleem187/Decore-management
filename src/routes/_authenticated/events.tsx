import { createFileRoute } from "@tanstack/react-router";
import { CrudPage, StatusPill, useOptions } from "@/components/CrudPage";
import { useState } from "react";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EventChecklist } from "@/components/EventChecklist";
import { WhatsAppButton } from "@/components/WhatsAppButton";
import { useMe } from "@/lib/auth";
import { fmtDate, pkr } from "@/lib/format";

const types = ["Wedding", "Mehndi", "Corporate", "Birthday", "Stage Decor", "Mandap / Stage", "Other"];

export const Route = createFileRoute("/_authenticated/events")({
  head: () => ({ meta: [{ title: "Events — Décor Studio" }, { name: "description", content: "Decor projects and status tracker." }, { property: "og:title", content: "Events — Décor Studio" }, { property: "og:description", content: "Decor projects and status tracker." }] }),
  component: EventsPage,
});

function EventsPage() {
  const { data: me } = useMe();
  const hotels = useOptions("hotels");
  const [checklist, setChecklist] = useState<{ id: string; name: string } | null>(null);
  return (
    <>
    <CrudPage table="events" title="Events" subtitle="Upcoming → In progress → Completed → Paid" orderBy="event_date"
      select="*, hotels(name), expenses(amount), invoices(amount_paid)" canWrite={me?.role === "admin"} defaults={{ event_type: "Wedding", status: "upcoming" }}
      columns={[
        { key: "event_date", label: "Date", render: (r) => fmtDate(r.event_date) },
        { key: "name", label: "Event", render: (r) => <><span className="font-medium">{r.name}</span><div className="text-xs text-muted-foreground">{r.event_type} · {r.client_name}</div></> },
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
            clientName: r.client_name, eventName: r.name, eventDate: r.event_date, total: r.package_price, phone: r.client_phone,
            paid: (r.invoices ?? []).reduce((s: number, i: { amount_paid: number }) => s + Number(i.amount_paid), 0),
          }} />
        ) },
      ]}
      fields={[
        { key: "name", label: "Event name", required: true },
        { key: "event_date", label: "Date", type: "date", required: true },
        { key: "event_type", label: "Event type", type: "select", options: types.map((t) => ({ value: t, label: t })), required: true },
        { key: "hotel_id", label: "Hotel", type: "select", options: hotels },
        { key: "client_name", label: "Client name", required: true },
        { key: "client_phone", label: "Client phone" },
        { key: "package_price", label: "Package price (PKR)", type: "number" },
        { key: "estimated_cost", label: "Estimated cost (PKR)", type: "number" },
        { key: "status", label: "Status", type: "select", options: ["upcoming", "in_progress", "completed", "paid"].map((s) => ({ value: s, label: s.replace("_", " ") })), required: true },
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
