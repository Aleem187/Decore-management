import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { requireRole, useMe } from "@/lib/auth";
import { phoneSearchDigits, searchPattern } from "@/lib/clients";
import { fmtDate } from "@/lib/format";
import { formatPkPhone } from "@/lib/phone";
import { ClientForm, type ClientRecord } from "@/components/ClientForm";
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

export const Route = createFileRoute("/_authenticated/clients/")({
  head: () => ({
    meta: [
      { title: "Clients — Sarim Events Planner" },
      { name: "description", content: "Client directory and balances." },
    ],
  }),
  beforeLoad: ({ context }) => requireRole(context.queryClient, ["admin", "accountant"]),
  component: ClientsPage,
});

const PAGE_SIZE = 20;

function ClientsPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<ClientRecord | "new" | null>(null);

  // Wait for the typing to pause, then search from the first page.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(input);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [input]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["clients", "list", { q, page }],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = supabase
        .from("clients")
        .select("id, name, phone, whatsapp, email, address, notes, created_at", { count: "exact" })
        .is("deleted_at", null)
        .order("name")
        .order("id")
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      const pat = searchPattern(q);
      if (pat) {
        const digits = phoneSearchDigits(q);
        const parts = [
          `name.ilike.${pat}`,
          `email.ilike.${pat}`,
          digits ? `phone.ilike.%${digits}%` : `phone.ilike.${pat}`,
        ];
        query = query.or(parts.join(","));
      }
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data, total: count ?? 0 };
    },
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  // A delete can empty the last page; step back instead of showing nothing.
  useEffect(() => {
    if (data && page > lastPage) setPage(lastPage);
  }, [data, page, lastPage]);

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("soft_delete", { _table: "clients", _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Client deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold sm:text-4xl">Clients</h1>
          <p className="text-muted-foreground">Contacts, events and balances in one place</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Input
            placeholder="Search name, phone or email…"
            aria-label="Search clients"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="w-full sm:w-64"
          />
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" />
            Add client
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card shadow-soft">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="hidden md:table-cell">Email</TableHead>
              <TableHead className="hidden lg:table-cell">Added</TableHead>
              <TableHead className="w-24" />
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
            {error && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-destructive">
                  {(error as Error).message}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  {q ? "No clients match your search." : "No clients yet — add your first one."}
                </TableCell>
              </TableRow>
            )}
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">
                  <Link
                    to="/clients/$clientId"
                    params={{ clientId: c.id }}
                    className="underline-offset-4 hover:underline"
                  >
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {c.phone ? formatPkPhone(c.phone) : "—"}
                </TableCell>
                <TableCell className="hidden max-w-56 truncate md:table-cell">
                  {c.email ?? "—"}
                </TableCell>
                <TableCell className="hidden whitespace-nowrap lg:table-cell">
                  {fmtDate(c.created_at)}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                    Edit
                  </Button>
                  {isAdmin && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Delete ${c.name}`}
                      onClick={() =>
                        confirm(
                          `Delete ${c.name}? Their events and invoices stay, but the client is hidden.`,
                        ) && remove.mutate(c.id)
                      }
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span aria-live="polite">
          {total === 0
            ? "0 clients"
            : `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}
          {isFetching && !isLoading ? " · updating…" : ""}
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <span>
            Page {Math.min(page, lastPage) + 1} of {lastPage + 1}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= lastPage}
            onClick={() => setPage(page + 1)}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              {editing === "new" ? "Add client" : "Edit client"}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <ClientForm
              client={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
