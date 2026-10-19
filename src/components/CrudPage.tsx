import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Download } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/auth";
import { downloadCsv, stamp, type CsvCell } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
export type Field = {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "time" | "select" | "textarea" | "checkbox";
  options?: { value: string; label: string }[];
  required?: boolean;
  /** Stored outside the main table; passed to afterSave instead of being written to it. */
  extra?: boolean;
};
export type ExportColumn = { header: string; value: (r: Row) => CsvCell };
export type Column = { key: string; label: string; render?: (r: Row) => ReactNode; className?: string };

export function CrudPage(props: {
  table: string;
  title: string;
  subtitle?: string;
  select?: string;
  orderBy: string;
  columns: Column[];
  fields: Field[];
  defaults?: Row;
  canWrite: boolean;
  summary?: (rows: Row[]) => ReactNode;
  /** Clean headers/values for the report export; falls back to the visible columns. */
  exportColumns?: ExportColumn[];
  /** Reshape each fetched row (e.g. flatten an embedded table) before display and editing. */
  normalize?: (r: Row) => Row;
  /** Runs after the main row is saved, with its id and the full form values (for `extra` fields). */
  afterSave?: (id: string, form: Row) => Promise<void>;
  /** Runs before saving. Throw to cancel (for example after a warning the user declined). */
  beforeSave?: (form: Row) => Promise<void>;
}) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const canDelete = me?.role === "admin";
  const db = supabase as any;
  const [editing, setEditing] = useState<Row | null>(null);
  const [q, setQ] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: [props.table],
    queryFn: async () => {
      const { data, error } = await db.from(props.table).select(props.select ?? "*").is("deleted_at", null).order(props.orderBy, { ascending: false });
      if (error) throw error;
      return ((data ?? []) as Row[]).map((r) => (props.normalize ? props.normalize(r) : r));
    },
  });

  const save = useMutation({
    mutationFn: async (r: Row) => {
      const payload: Row = {};
      for (const f of props.fields) {
        if (f.extra) continue;
        let v = r[f.key];
        if (v === "" || v === undefined) v = f.type === "number" ? 0 : f.type === "checkbox" ? false : null;
        if (f.type === "number") v = Number(v);
        payload[f.key] = v;
      }
      if (props.beforeSave) await props.beforeSave(r);
      let id: string = r.id;
      if (r.id) {
        const res = await db.from(props.table).update(payload).eq("id", r.id);
        if (res.error) throw res.error;
      } else {
        const res = await db.from(props.table).insert(payload).select("id").single();
        if (res.error) throw res.error;
        id = res.data.id;
      }
      if (props.afterSave) await props.afterSave(id, r);
    },
    onSuccess: () => { qc.invalidateQueries(); setEditing(null); toast.success("Saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      // Soft delete through an admin-checked database function; rows are never physically removed.
      const { error } = await db.rpc("soft_delete", { _table: props.table, _id: id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries(); toast.success("Deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = rows.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));

  function exportCsv() {
    const cols: ExportColumn[] = props.exportColumns ?? props.columns.map((c) => ({
      header: c.label,
      value: (r) => c.key.split(".").reduce((o: any, k) => o?.[k], r),
    }));
    downloadCsv(`${props.table}-${stamp()}`, cols.map((c) => c.header), filtered.map((r) => cols.map((c) => c.value(r))));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold">{props.title}</h1>
          {props.subtitle && <p className="text-muted-foreground">{props.subtitle}</p>}
        </div>
        <div className="flex gap-2">
          <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="w-48" />
          <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4" />Export Report (CSV)</Button>
          {props.canWrite && <Button onClick={() => setEditing({ ...(props.defaults ?? {}) })}><Plus className="h-4 w-4" />Add</Button>}
        </div>
      </div>
      {props.summary?.(rows)}
      <div className="rounded-lg border bg-card shadow-soft">
        <Table>
          <TableHeader>
            <TableRow>
              {props.columns.map((c) => <TableHead key={c.key} className={c.className}>{c.label}</TableHead>)}
              {props.canWrite && <TableHead className="w-24" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={99} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
            {!isLoading && filtered.length === 0 && <TableRow><TableCell colSpan={99} className="py-10 text-center text-muted-foreground">Nothing here yet.</TableCell></TableRow>}
            {filtered.map((r) => (
              <TableRow key={r.id}>
                {props.columns.map((c) => <TableCell key={c.key} className={c.className}>{c.render ? c.render(r) : String(r[c.key] ?? "—")}</TableCell>)}
                {props.canWrite && (
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></Button>
                    {canDelete && <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => confirm("Delete this record? It will be hidden from everyone.") && del.mutate(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display text-2xl">{editing?.id ? "Edit" : "New"} {props.title.replace(/s$/, "")}</DialogTitle></DialogHeader>
          {editing && (
            <form id="crud-form" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(editing); }}>
              {props.fields.map((f) => {
                const v = editing[f.key] ?? "";
                const set = (val: any) => setEditing({ ...editing, [f.key]: val });
                return (
                  <div key={f.key} className="space-y-1">
                    <Label>{f.label}</Label>
                    {f.type === "textarea" ? <Textarea value={v} onChange={(e) => set(e.target.value)} />
                      : f.type === "select" ? (
                        <select required={f.required} value={v ?? ""} onChange={(e) => set(e.target.value)}
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                          <option value="">—</option>
                          {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : f.type === "checkbox" ? (
                        <input type="checkbox" checked={!!editing[f.key]} onChange={(e) => set(e.target.checked)} className="block h-4 w-4" />
                      ) : <Input type={f.type ?? "text"} required={f.required} value={v} onChange={(e) => set(e.target.value)} step={f.type === "number" ? "any" : undefined} />}
                  </div>
                );
              })}
            </form>
          )}
          <DialogFooter><Button type="submit" form="crud-form" disabled={save.isPending}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function useOptions(table: string, label = "name") {
  return useQuery({
    queryKey: [table, "options"],
    queryFn: async () => {
      const { data } = await (supabase as any).from(table).select(`id, ${label}`).is("deleted_at", null).order(label);
      return ((data ?? []) as Row[]).map((r) => ({ value: r.id as string, label: r[label] as string }));
    },
  }).data ?? [];
}

export function StatusPill({ value }: { value: string }) {
  const tone: Record<string, string> = {
    paid: "bg-success/15 text-success", completed: "bg-success/15 text-success", cancelled: "bg-muted text-muted-foreground line-through",
    partial: "bg-warning/20 text-accent-foreground", in_progress: "bg-warning/20 text-accent-foreground",
    unpaid: "bg-muted text-muted-foreground", upcoming: "bg-primary/10 text-primary",
    overdue: "bg-destructive/15 text-destructive",
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${tone[value] ?? "bg-muted"}`}>{value.replace("_", " ")}</span>;
}
