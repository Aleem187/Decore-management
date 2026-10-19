import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, FileText, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import { fmtDate, pkr } from "@/lib/format";
import { downloadReceiptPdf, type InvoicePdfData } from "@/lib/invoice-pdf";
import {
  METHOD_LABEL,
  PAYMENT_METHODS,
  paidTotal,
  remainingBalance,
  validatePaymentAmount,
  type PaymentMethod,
} from "@/lib/payments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = () => ({
  amount: "",
  method: "cash" as PaymentMethod,
  reference_no: "",
  paid_at: today(),
  note: "",
});

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-display text-xl font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

export function InvoicePayments({ invoice, voided }: { invoice: InvoicePdfData; voided: boolean }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";
  const key = ["payments", invoice.id];
  const [form, setForm] = useState(emptyForm);
  const [voiding, setVoiding] = useState<{ id: string; reason: string } | null>(null);

  const { data: payments = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("invoice_id", invoice.id)
        .order("paid_at", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const total = Number(invoice.amount) || 0;
  const paid = paidTotal(payments);
  const remaining = remainingBalance(total, payments);

  const refresh = () => {
    for (const k of [key, ["invoices"], ["dashboard"], ["events"]])
      qc.invalidateQueries({ queryKey: k });
  };
  const onError = (e: Error) => toast.error(e.message);

  const add = useMutation({
    mutationFn: async () => {
      const amount = Number(form.amount);
      const problem = validatePaymentAmount(amount, remaining);
      if (problem) throw new Error(problem);
      const { error } = await supabase.from("payments").insert({
        invoice_id: invoice.id,
        amount,
        method: form.method,
        reference_no: form.reference_no.trim() || null,
        paid_at: form.paid_at || today(),
        note: form.note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setForm(emptyForm());
      refresh();
      toast.success("Payment recorded");
    },
    onError,
  });

  const voidIt = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      if (reason.trim().length < 3) throw new Error("Enter a reason (at least 3 characters)");
      const { error } = await supabase.rpc("void_payment", { _id: id, _reason: reason.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      setVoiding(null);
      refresh();
      toast.success("Payment voided");
    },
    onError,
  });

  const canAdd = !voided && remaining > 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric label="Invoice total" value={pkr(total)} />
        <Metric label="Paid" value={pkr(paid)} tone="text-success" />
        <Metric
          label="Remaining balance"
          value={pkr(remaining)}
          tone={remaining > 0 ? "text-destructive" : "text-success"}
        />
      </div>

      {voided && (
        <p className="text-sm text-destructive">
          This invoice is voided. No new payments can be recorded.
        </p>
      )}
      {!voided && remaining === 0 && total > 0 && (
        <p className="text-sm text-success">Paid in full.</p>
      )}

      {canAdd && (
        <form
          className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <div className="space-y-1">
            <Label>Amount (PKR) — up to {pkr(remaining)}</Label>
            <Input
              type="number"
              required
              min={0.01}
              max={remaining}
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Method</Label>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.method}
              onChange={(e) => setForm({ ...form, method: e.target.value as PaymentMethod })}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Reference no.</Label>
            <Input
              placeholder="Transaction / cheque no."
              value={form.reference_no}
              onChange={(e) => setForm({ ...form, reference_no: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Date received</Label>
            <Input
              type="date"
              required
              max={today()}
              value={form.paid_at}
              onChange={(e) => setForm({ ...form, paid_at: e.target.value })}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Note</Label>
            <Input
              placeholder="Optional"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={add.isPending}>
              <Plus className="h-4 w-4" />
              Record payment
            </Button>
            <span className="ml-3 text-xs text-muted-foreground">
              Payments cannot be edited or deleted. Only an admin can void one.
            </span>
          </div>
        </form>
      )}

      <section>
        <h3 className="mb-2 font-display text-lg font-semibold">Payment history</h3>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Reference / note</TableHead>
                <TableHead className="w-48" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && payments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                    No payments yet.
                  </TableCell>
                </TableRow>
              )}
              {payments.map((p) => (
                <TableRow key={p.id} className={p.voided_at ? "text-muted-foreground" : ""}>
                  <TableCell className="whitespace-nowrap">{fmtDate(p.paid_at)}</TableCell>
                  <TableCell className={`font-medium ${p.voided_at ? "line-through" : ""}`}>
                    {pkr(p.amount)}
                  </TableCell>
                  <TableCell>{METHOD_LABEL[p.method as PaymentMethod] ?? p.method}</TableCell>
                  <TableCell className="max-w-56">
                    <div className="truncate">
                      {[p.reference_no, p.note].filter(Boolean).join(" · ") || "—"}
                    </div>
                    {p.voided_at && (
                      <div className="text-xs text-destructive">
                        Voided {fmtDate(p.voided_at)}: {p.void_reason}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {!p.voided_at && voiding?.id !== p.id && (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            downloadReceiptPdf(invoice, p.id).catch((e: Error) =>
                              toast.error(e.message),
                            )
                          }
                        >
                          <FileText className="h-4 w-4" />
                          Receipt
                        </Button>
                        {isAdmin && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setVoiding({ id: p.id, reason: "" })}
                          >
                            <Ban className="h-4 w-4" />
                            Void
                          </Button>
                        )}
                      </div>
                    )}
                    {voiding?.id === p.id && (
                      <form
                        className="flex gap-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          voidIt.mutate(voiding);
                        }}
                      >
                        <Input
                          autoFocus
                          required
                          minLength={3}
                          placeholder="Reason for voiding"
                          aria-label="Reason for voiding"
                          value={voiding.reason}
                          onChange={(e) => setVoiding({ id: p.id, reason: e.target.value })}
                        />
                        <Button
                          size="sm"
                          type="submit"
                          variant="destructive"
                          disabled={voidIt.isPending}
                        >
                          Void
                        </Button>
                        <Button
                          size="sm"
                          type="button"
                          variant="ghost"
                          onClick={() => setVoiding(null)}
                        >
                          Cancel
                        </Button>
                      </form>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
