import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Mail, MapPin, Pencil, Phone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { requireRole, useMe } from "@/lib/auth";
import { clientBalance } from "@/lib/clients";
import { fmtDate, pkr } from "@/lib/format";
import { invoiceStatus } from "@/lib/invoice-status";
import { paidTotal } from "@/lib/payments";
import { formatPkPhone } from "@/lib/phone";
import { ClientForm } from "@/components/ClientForm";
import { StatusPill } from "@/components/CrudPage";
import { WhatsAppButton } from "@/components/WhatsAppButton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/clients/$clientId")({
  head: () => ({ meta: [{ title: "Client — Décor Studio" }] }),
  beforeLoad: ({ context }) => requireRole(context.queryClient, ["admin", "accountant"]),
  component: ClientDetail,
});

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={`break-words font-display text-2xl font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function ClientDetail() {
  const { clientId } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";
  const [editing, setEditing] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["client", clientId],
    queryFn: async () => {
      const [client, events, invoices] = await Promise.all([
        supabase
          .from("clients")
          .select("*")
          .eq("id", clientId)
          .is("deleted_at", null)
          .maybeSingle(),
        supabase
          .from("events")
          .select("id, name, event_date, status, hotels(name)")
          .eq("client_id", clientId)
          .is("deleted_at", null)
          .order("event_date", { ascending: false }),
        supabase
          .from("invoices")
          .select(
            "id, invoice_no, kind, amount, due_date, voided_at, created_at, payments(amount, voided_at)",
          )
          .eq("client_id", clientId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
      ]);
      for (const r of [client, events, invoices]) if (r.error) throw r.error;
      return { client: client.data, events: events.data ?? [], invoices: invoices.data ?? [] };
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("soft_delete", { _table: "clients", _id: clientId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Client deleted");
      navigate({ to: "/clients", replace: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-destructive">{(error as Error).message}</p>;
  const client = data?.client;
  if (!client || !data) {
    return (
      <div className="space-y-3">
        <Link
          to="/clients"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          All clients
        </Link>
        <p>This client was not found. It may have been deleted.</p>
      </div>
    );
  }

  const balance = clientBalance(data.invoices);
  const whatsappNumber = client.whatsapp ?? client.phone;

  return (
    <div className="space-y-6">
      <Link
        to="/clients"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        All clients
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h1 className="break-words text-3xl font-semibold sm:text-4xl">{client.name}</h1>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            {client.phone && (
              <span className="inline-flex items-center gap-1">
                <Phone className="h-4 w-4" />
                {formatPkPhone(client.phone)}
              </span>
            )}
            {client.whatsapp && client.whatsapp !== client.phone && (
              <span>WhatsApp {formatPkPhone(client.whatsapp)}</span>
            )}
            {client.email && (
              <span className="inline-flex items-center gap-1 break-all">
                <Mail className="h-4 w-4" />
                {client.email}
              </span>
            )}
            {client.address && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                {client.address}
              </span>
            )}
            {!client.phone && !client.email && !client.address && (
              <span>No contact details yet</span>
            )}
          </div>
          {client.notes && (
            <p className="max-w-prose whitespace-pre-line text-sm">{client.notes}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <WhatsAppButton
            label="Send WhatsApp Update"
            update={{
              clientName: client.name,
              eventName: null,
              eventDate: null,
              total: balance.invoiced,
              paid: balance.received,
              phone: whatsappNumber,
            }}
          />
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                confirm(
                  `Delete ${client.name}? Their events and invoices stay, but the client is hidden.`,
                ) && remove.mutate()
              }
            >
              <Trash2 className="h-4 w-4 text-destructive" />
              Delete
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Total invoiced" value={pkr(balance.invoiced)} />
        <Metric label="Total received" value={pkr(balance.received)} tone="text-success" />
        <Metric
          label="Outstanding balance"
          value={pkr(balance.outstanding)}
          tone={balance.outstanding > 0 ? "text-destructive" : "text-success"}
        />
      </div>

      <section className="space-y-2">
        <h2 className="text-2xl font-semibold">Invoices</h2>
        <div className="rounded-lg border bg-card shadow-soft">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No.</TableHead>
                <TableHead className="hidden sm:table-cell">Issued</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead className="hidden md:table-cell">Paid</TableHead>
                <TableHead>Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.invoices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No invoices linked to this client yet. Pick the client when creating an invoice.
                  </TableCell>
                </TableRow>
              )}
              {data.invoices.map((inv) => {
                const paid = paidTotal(inv.payments ?? []);
                const amount = Number(inv.amount);
                const status = inv.voided_at ? "voided" : invoiceStatus(amount, paid, inv.due_date);
                return (
                  <TableRow key={inv.id} className={inv.voided_at ? "text-muted-foreground" : ""}>
                    <TableCell className="font-mono text-xs">{inv.invoice_no}</TableCell>
                    <TableCell className="hidden whitespace-nowrap sm:table-cell">
                      {fmtDate(inv.created_at)}
                    </TableCell>
                    <TableCell>{pkr(amount)}</TableCell>
                    <TableCell className="hidden md:table-cell">{pkr(paid)}</TableCell>
                    <TableCell>{inv.voided_at ? "—" : pkr(Math.max(amount - paid, 0))}</TableCell>
                    <TableCell>
                      <StatusPill value={status} />
                    </TableCell>
                    <TableCell>
                      <WhatsAppButton
                        update={{
                          clientName: client.name,
                          eventName: null,
                          eventDate: null,
                          total: amount,
                          paid,
                          phone: whatsappNumber,
                        }}
                        label={`Send WhatsApp update for ${inv.invoice_no}`}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-2xl font-semibold">Events</h2>
        <div className="rounded-lg border bg-card shadow-soft">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="hidden sm:table-cell">Hotel</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.events.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    No events linked to this client yet.
                  </TableCell>
                </TableRow>
              )}
              {data.events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.name}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDate(e.event_date)}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {(e.hotels as { name: string } | null)?.name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <StatusPill value={e.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Edit client</DialogTitle>
          </DialogHeader>
          {editing && <ClientForm client={client} onDone={() => setEditing(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
