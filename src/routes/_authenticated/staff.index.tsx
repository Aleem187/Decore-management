import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { requireRole, useMe } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { formatPkPhone } from "@/lib/phone";
import { payLabel } from "@/lib/staff";
import { useStaffMembers, type StaffMember } from "@/hooks/use-staff-members";
import { StaffForm } from "@/components/StaffForm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/staff/")({
  head: () => ({
    meta: [
      { title: "Staff — Sarim Events Planner" },
      { name: "description", content: "Decorators, drivers and labour." },
    ],
  }),
  beforeLoad: ({ context }) => requireRole(context.queryClient, ["admin"]),
  component: StaffPage,
});

function StaffPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";
  const { data = [], isLoading, error } = useStaffMembers();
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<StaffMember | "new" | null>(null);

  const term = q.trim().toLowerCase();
  const rows = data.filter(
    (s) =>
      (showInactive || s.active) &&
      (!term ||
        [s.name, s.job_title, s.phone ?? "", s.cnic ?? ""].some((x) =>
          x.toLowerCase().includes(term),
        )),
  );

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("soft_delete", { _table: "staff", _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      toast.success("Staff member deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold sm:text-4xl">Staff</h1>
          <p className="text-muted-foreground">
            Decorators, drivers and labour. They do not need a login.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Input
            placeholder="Search name, title, phone…"
            aria-label="Search staff"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full sm:w-64"
          />
          {isAdmin && (
            <Button onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" />
              Add staff
            </Button>
          )}
        </div>
      </div>
      <label className="flex w-fit items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
        />
        Show inactive staff
      </label>

      <div className="rounded-lg border bg-card shadow-soft">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Title</TableHead>
              <TableHead className="hidden md:table-cell">Phone</TableHead>
              <TableHead>Pay</TableHead>
              <TableHead className="hidden lg:table-cell">Joined</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {error && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-destructive">
                  {(error as Error).message}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  {term ? "No staff match your search." : "No staff yet."}
                </TableCell>
              </TableRow>
            )}
            {rows.map((s) => (
              <TableRow key={s.id} className={s.active ? "" : "text-muted-foreground"}>
                <TableCell className="font-medium">
                  <Link
                    to="/staff/$staffId"
                    params={{ staffId: s.id }}
                    className="underline-offset-4 hover:underline"
                  >
                    {s.name}
                  </Link>
                  {!s.active && (
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">Inactive</span>
                  )}
                  <div className="text-xs text-muted-foreground sm:hidden">{s.job_title}</div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">{s.job_title}</TableCell>
                <TableCell className="hidden whitespace-nowrap md:table-cell">
                  {s.phone ? formatPkPhone(s.phone) : "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {payLabel(s.salary_type, s.rate)}
                </TableCell>
                <TableCell className="hidden whitespace-nowrap lg:table-cell">
                  {s.joining_date ? fmtDate(s.joining_date) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {isAdmin && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                        Edit
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${s.name}`}
                        onClick={() =>
                          confirm(
                            `Delete ${s.name}? Their attendance and pay history stay on record.`,
                          ) && remove.mutate(s.id)
                        }
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              {editing === "new" ? "Add staff member" : "Edit staff member"}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <StaffForm staff={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
