import { createFileRoute } from "@tanstack/react-router";
import { FileText, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { WhatsAppButton } from "@/components/WhatsAppButton";
import { downloadInvoicePdf, type InvoicePdfData } from "@/lib/invoice-pdf";
import { CrudPage, StatusPill, useOptions } from "@/components/CrudPage";
import { fmtDate, pkr } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/invoices")({
  head: () => ({ meta: [{ title: "Invoices — Décor Studio" }, { name: "description", content: "Client billing and payment status." }, { property: "og:title", content: "Invoices — Décor Studio" }, { property: "og:description", content: "Client billing and payment status." }] }),
  component: InvoicesPage,
});

function download(r: unknown, mode: "invoice" | "receipt") {
  downloadInvoicePdf(r as InvoicePdfData, mode).catch(() => toast.error("Could not generate the PDF"));
}

function InvoicesPage() {
  const events = useOptions("events");
  return (
    <CrudPage table="invoices" title="Invoices" subtitle="Status updates automatically from amount paid and due date" orderBy="created_at"
      select="*, events(name, event_date, client_phone)" canWrite defaults={{ kind: "Advance", invoice_no: `INV-${Date.now().toString().slice(-6)}` }}
      summary={(rows) => {
        const total = rows.reduce((s, r) => s + Number(r.amount), 0);
        const paid = rows.reduce((s, r) => s + Number(r.amount_paid), 0);
        return (
          <div className="grid gap-3 sm:grid-cols-3">
            {[["Billed", total], ["Received", paid], ["Outstanding", total - paid]].map(([l, v]) => (
              <div key={l} className="rounded-lg border bg-card p-4"><div className="text-sm text-muted-foreground">{l}</div><div className="font-display text-3xl font-semibold">{pkr(v)}</div></div>
            ))}
          </div>
        );
      }}
      columns={[
        { key: "invoice_no", label: "No.", render: (r) => <span className="font-mono text-xs">{r.invoice_no}</span> },
        { key: "client_name", label: "Client", render: (r) => <>{r.client_name}<div className="text-xs text-muted-foreground">{r.events?.name ?? ""} · {r.kind}</div></> },
        { key: "amount", label: "Amount", render: (r) => pkr(r.amount) },
        { key: "amount_paid", label: "Paid", render: (r) => pkr(r.amount_paid) },
        { key: "balance", label: "Balance", render: (r) => pkr(Number(r.amount) - Number(r.amount_paid)) },
        { key: "due_date", label: "Due", render: (r) => fmtDate(r.due_date) },
        { key: "status", label: "Status", render: (r) => <StatusPill value={r.status} /> },
        { key: "pdf", label: "PDF", className: "whitespace-nowrap", render: (r) => (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => download(r, "invoice")}><FileText className="h-4 w-4" />Invoice</Button>
            <Button size="sm" variant="outline" disabled={Number(r.amount_paid) <= 0} onClick={() => download(r, "receipt")}><Receipt className="h-4 w-4" />Receipt</Button>
            <WhatsAppButton update={{ clientName: r.client_name, eventName: r.events?.name, eventDate: r.events?.event_date, total: r.amount, paid: r.amount_paid, phone: r.events?.client_phone }} />
          </div>
        ) },
      ]}
      exportColumns={[
        { header: "Invoice No", value: (r) => r.invoice_no },
        { header: "Date", value: (r) => r.created_at?.slice(0, 10) },
        { header: "Client Name", value: (r) => r.client_name },
        { header: "Event", value: (r) => r.events?.name },
        { header: "Type", value: (r) => r.kind },
        { header: "Amount (PKR)", value: (r) => Number(r.amount) },
        { header: "Paid (PKR)", value: (r) => Number(r.amount_paid) },
        { header: "Balance (PKR)", value: (r) => Number(r.amount) - Number(r.amount_paid) },
        { header: "Due Date", value: (r) => r.due_date },
        { header: "Status", value: (r) => r.status },
      ]}
      fields={[
        { key: "invoice_no", label: "Invoice number", required: true },
        { key: "event_id", label: "Event", type: "select", options: events },
        { key: "client_name", label: "Client name", required: true },
        { key: "kind", label: "Type", type: "select", options: ["Advance", "Remaining Balance", "Extra Charges", "Full"].map((k) => ({ value: k, label: k })), required: true },
        { key: "amount", label: "Amount (PKR)", type: "number", required: true },
        { key: "amount_paid", label: "Amount paid (PKR)", type: "number" },
        { key: "due_date", label: "Due date", type: "date" },
      ]}
    />
  );
}
