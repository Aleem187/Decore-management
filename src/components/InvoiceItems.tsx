import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import { pkr } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Item = { id: string; description: string; quantity: number; unit_price: number };

export function InvoiceItems({
  invoiceId,
  locked = false,
}: {
  invoiceId: string;
  locked?: boolean;
}) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";
  const key = ["invoice_items", invoiceId];
  const [form, setForm] = useState({ description: "", quantity: "1", unit_price: "" });

  const { data: items = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_items")
        .select("id, description, quantity, unit_price")
        .eq("invoice_id", invoiceId)
        .is("deleted_at", null)
        .order("created_at");
      if (error) throw error;
      return data as Item[];
    },
  });

  // The database recalculates the invoice total from its items, so refresh the invoice list too.
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["invoices"] });
  };
  const onError = (e: Error) => toast.error(e.message);

  const add = useMutation({
    mutationFn: async () => {
      const quantity = Number(form.quantity);
      const unit_price = Number(form.unit_price);
      if (!form.description.trim()) throw new Error("Enter a description");
      if (!(quantity > 0) || !(unit_price > 0))
        throw new Error("Quantity and unit price must be above zero");
      const { error } = await supabase
        .from("invoice_items")
        .insert({
          invoice_id: invoiceId,
          description: form.description.trim(),
          quantity,
          unit_price,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      setForm({ description: "", quantity: "1", unit_price: "" });
      refresh();
    },
    onError,
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Omit<Item, "id">> }) => {
      const { error } = await supabase.from("invoice_items").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => {
      toast.error(e.message);
      refresh();
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("soft_delete", { _table: "invoice_items", _id: id });
      if (error) throw error;
    },
    onSuccess: refresh,
    onError,
  });

  const total = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        These lines appear on the PDF. Once an invoice has items, its total is the sum of the items.
        {items.length === 0 &&
          " With no items the PDF shows one line, “Decoration services”, for the invoice total."}
      </p>

      <div className="divide-y rounded-md border">
        {isLoading && <div className="p-3 text-sm text-muted-foreground">Loading…</div>}
        {items.map((it) => (
          <div
            key={it.id}
            className="grid grid-cols-[1fr_auto] items-center gap-2 p-3 sm:grid-cols-[1fr_5rem_7rem_auto_auto]"
          >
            <Input
              aria-label="Description"
              defaultValue={it.description}
              disabled={locked}
              className="col-span-2 sm:col-span-1"
              onBlur={(e) =>
                e.target.value.trim() &&
                e.target.value !== it.description &&
                update.mutate({ id: it.id, patch: { description: e.target.value.trim() } })
              }
            />
            <Input
              aria-label="Quantity"
              type="number"
              min={0.01}
              step="any"
              defaultValue={it.quantity}
              disabled={locked}
              onBlur={(e) =>
                Number(e.target.value) > 0 &&
                Number(e.target.value) !== Number(it.quantity) &&
                update.mutate({ id: it.id, patch: { quantity: Number(e.target.value) } })
              }
            />
            <Input
              aria-label="Unit price"
              type="number"
              min={0.01}
              step="any"
              defaultValue={it.unit_price}
              disabled={locked}
              onBlur={(e) =>
                Number(e.target.value) > 0 &&
                Number(e.target.value) !== Number(it.unit_price) &&
                update.mutate({ id: it.id, patch: { unit_price: Number(e.target.value) } })
              }
            />
            <span className="text-right text-sm font-medium">
              {pkr(Number(it.quantity) * Number(it.unit_price))}
            </span>
            {isAdmin && !locked ? (
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove ${it.description}`}
                onClick={() => confirm("Remove this line?") && remove.mutate(it.id)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            ) : (
              <span />
            )}
          </div>
        ))}
        {!isLoading && items.length === 0 && (
          <div className="p-3 text-sm text-muted-foreground">No items yet.</div>
        )}
        {items.length > 0 && (
          <div className="flex justify-between p-3 text-sm font-semibold">
            <span>Total</span>
            <span>{pkr(total)}</span>
          </div>
        )}
      </div>

      {!locked && (
        <form
          className="grid gap-2 sm:grid-cols-[1fr_5rem_7rem_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Input
            placeholder="Description (e.g. Stage Decor)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            required
          />
          <Input
            aria-label="Quantity"
            type="number"
            min={0.01}
            step="any"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            required
          />
          <Input
            aria-label="Unit price (PKR)"
            placeholder="Unit price"
            type="number"
            min={0.01}
            step="any"
            value={form.unit_price}
            onChange={(e) => setForm({ ...form, unit_price: e.target.value })}
            required
          />
          <Button type="submit" disabled={add.isPending}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </form>
      )}
    </div>
  );
}
