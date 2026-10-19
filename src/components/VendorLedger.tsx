import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate, pkr } from "@/lib/format";
import { vendorTotals } from "@/lib/vendor-ledger";
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

export const PAYMENT_METHODS = [
  "Cash",
  "Bank Transfer",
  "Easypaisa",
  "JazzCash",
  "Cheque",
] as const;

type Vendor = { id: string; name: string; category: string | null; phone: string | null };

const today = () => new Date().toISOString().slice(0, 10);

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-display text-xl font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

export function VendorLedger({ vendor }: { vendor: Vendor }) {
  const qc = useQueryClient();
  const key = ["vendor_ledger", vendor.id];
  const [form, setForm] = useState({
    payment_date: today(),
    amount: "",
    method: "Cash" as string,
    notes: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const [exp, pay] = await Promise.all([
        supabase
          .from("expenses")
          .select("id, expense_date, category, description, amount, paid")
          .eq("vendor_id", vendor.id)
          .order("expense_date", { ascending: false }),
        supabase
          .from("vendor_payments")
          .select("*")
          .eq("vendor_id", vendor.id)
          .order("payment_date", { ascending: false })
          .order("created_at", { ascending: false }),
      ]);
      if (exp.error) throw exp.error;
      if (pay.error) throw pay.error;
      return { expenses: exp.data, payments: pay.data };
    },
  });

  const expenses = data?.expenses ?? [];
  const payments = data?.payments ?? [];
  const { payable, paid, pending } = vendorTotals(expenses, payments);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["vendors"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const onError = (e: Error) => toast.error(e.message);

  const add = useMutation({
    mutationFn: async () => {
      const amount = Number(form.amount);
      if (!Number.isFinite(amount) || amount <= 0)
        throw new Error("Enter an amount greater than zero");
      const { error } = await supabase.from("vendor_payments").insert({
        vendor_id: vendor.id,
        payment_date: form.payment_date || today(),
        amount,
        method: form.method,
        notes: form.notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setForm({ payment_date: today(), amount: "", method: "Cash", notes: "" });
      refresh();
      toast.success("Payment recorded");
    },
    onError,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("vendor_payments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError,
  });

  return (
    <div className="space-y-5">
      <div className="text-sm text-muted-foreground">
        {[vendor.category, vendor.phone].filter(Boolean).join(" · ") || "No contact details saved"}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric label="Total payable" value={pkr(payable)} />
        <Metric label="Total paid" value={pkr(paid)} tone="text-success" />
        <Metric
          label={pending < 0 ? "Advance with vendor" : "Pending balance"}
          value={pkr(Math.abs(pending))}
          tone={pending > 0 ? "text-destructive" : pending < 0 ? "text-success" : ""}
        />
      </div>

      <form
        className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <div className="space-y-1">
          <Label>Date</Label>
          <Input
            type="date"
            required
            value={form.payment_date}
            onChange={(e) => setForm({ ...form, payment_date: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label>Amount paid (PKR)</Label>
          <Input
            type="number"
            required
            min={1}
            step="any"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label>Payment method</Label>
          <select
            value={form.method}
            onChange={(e) => setForm({ ...form, method: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label>Notes</Label>
          <Input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Optional"
          />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={add.isPending}>
            <Plus className="h-4 w-4" />
            Record payment
          </Button>
        </div>
      </form>

      <section>
        <h3 className="mb-2 font-display text-lg font-semibold">Payment history</h3>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-10" />
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
                    No payments recorded yet.
                  </TableCell>
                </TableRow>
              )}
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-nowrap">{fmtDate(p.payment_date)}</TableCell>
                  <TableCell className="font-medium">{pkr(p.amount)}</TableCell>
                  <TableCell>{p.method}</TableCell>
                  <TableCell className="max-w-48 truncate">{p.notes ?? "—"}</TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Delete payment"
                      onClick={() => confirm("Delete this payment?") && remove.mutate(p.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section>
        <h3 className="mb-2 font-display text-lg font-semibold">Bills from this vendor</h3>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Settled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!isLoading && expenses.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                    No expenses linked to this vendor.
                  </TableCell>
                </TableRow>
              )}
              {expenses.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap">{fmtDate(e.expense_date)}</TableCell>
                  <TableCell>
                    {e.category}
                    {e.description ? ` — ${e.description}` : ""}
                  </TableCell>
                  <TableCell>{pkr(e.amount)}</TableCell>
                  <TableCell>
                    {e.paid ? "Yes" : <span className="text-destructive">Pending</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Paid = bills marked paid on the Expenses page + payments recorded above.
        </p>
      </section>
    </div>
  );
}
