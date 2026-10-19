import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useMe } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const MATERIAL_STATUSES = ["packed", "delivered", "returned"] as const;
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];

const SUGGESTIONS = [
  "Stage Flowers",
  "Stage Lighting",
  "Sofa Set",
  "Backdrop Panels",
  "Curtains",
  "Mandap",
  "Audio System",
];

const TONE: Record<MaterialStatus, string> = {
  packed: "bg-warning/20 text-accent-foreground",
  delivered: "bg-primary/10 text-primary",
  returned: "bg-success/15 text-success",
};

const asStatus = (s: string): MaterialStatus =>
  (MATERIAL_STATUSES as readonly string[]).includes(s) ? (s as MaterialStatus) : "packed";
const nextStatus = (s: MaterialStatus): MaterialStatus =>
  MATERIAL_STATUSES[(MATERIAL_STATUSES.indexOf(s) + 1) % MATERIAL_STATUSES.length] ?? "packed";

export function EventChecklist({
  eventId,
  canEdit = true,
}: {
  eventId: string;
  canEdit?: boolean;
}) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";
  const key = ["event_materials", eventId];
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");

  const { data: items = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_materials")
        .select("*")
        .eq("event_id", eventId)
        .is("deleted_at", null)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const onError = (e: Error) => toast.error(e.message);
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const add = useMutation({
    mutationFn: async () => {
      const quantity = Math.max(1, Math.floor(Number(qty) || 1));
      const { error } = await supabase
        .from("event_materials")
        .insert({ event_id: eventId, item_name: name.trim(), quantity });
      if (error) throw error;
    },
    onSuccess: () => {
      setName("");
      setQty("1");
      refresh();
    },
    onError,
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: MaterialStatus }) => {
      const { error } = await supabase.from("event_materials").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("soft_delete", { _table: "event_materials", _id: id });
      if (error) throw error;
    },
    onSuccess: refresh,
    onError,
  });

  const counts = MATERIAL_STATUSES.map(
    (s) => `${items.filter((i) => asStatus(i.status) === s).length} ${s}`,
  ).join(" · ");

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {items.length === 0 ? "No items yet." : counts} — tap a badge to move it to the next stage.
      </p>

      <ul className="divide-y rounded-md border">
        {isLoading && <li className="p-3 text-sm text-muted-foreground">Loading…</li>}
        {items.map((it) => {
          const status = asStatus(it.status);
          return (
            <li key={it.id} className="flex items-center gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{it.item_name}</div>
                <div className="text-xs text-muted-foreground">Qty: {it.quantity}</div>
              </div>
              <button
                type="button"
                disabled={!canEdit || setStatus.isPending}
                onClick={() => setStatus.mutate({ id: it.id, status: nextStatus(status) })}
                title={canEdit ? `Mark as ${nextStatus(status)}` : undefined}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-opacity hover:opacity-80 disabled:opacity-60 ${TONE[status]}`}
              >
                {status}
              </button>
              {canEdit && isAdmin && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove ${it.item_name}`}
                  onClick={() => remove.mutate(it.id)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {canEdit && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) add.mutate();
          }}
        >
          <div className="flex gap-2">
            <Input
              list="material-suggestions"
              placeholder="Item name (e.g. Mandap)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <datalist id="material-suggestions">
              {SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <Input
              type="number"
              min={1}
              step={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-20 shrink-0"
              aria-label="Quantity"
            />
            <Button type="submit" disabled={add.isPending}>
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
