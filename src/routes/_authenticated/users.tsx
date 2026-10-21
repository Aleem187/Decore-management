import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { requireRole, type Role } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { inviteUserFn, listUsersFn, setUserDisabledFn, setUserRoleFn } from "@/lib/users.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "Users — Sarim Events Planner" }, { name: "description", content: "Invite staff and manage access." }] }),
  beforeLoad: ({ context }) => requireRole(context.queryClient, ["admin"]),
  component: UsersPage,
});

const selectClass = "h-9 rounded-md border border-input bg-background px-3 text-sm";

function UsersPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<{ email: string; fullName: string; role: Role }>({ email: "", fullName: "", role: "accountant" });
  const { data: users = [], isLoading, error } = useQuery({ queryKey: ["users"], queryFn: () => listUsersFn() });

  const done = (msg: string) => () => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: ["users"] });
  };
  const failed = (e: Error) => toast.error(e.message);

  const invite = useMutation({
    mutationFn: () => inviteUserFn({ data: form }),
    onSuccess: () => {
      setForm({ email: "", fullName: "", role: "accountant" });
      done("Invitation sent")();
    },
    onError: failed,
  });
  const setDisabled = useMutation({
    mutationFn: (v: { userId: string; disabled: boolean }) => setUserDisabledFn({ data: v }),
    onSuccess: done("Account updated"),
    onError: failed,
  });
  const setRole = useMutation({
    mutationFn: (v: { userId: string; role: Role }) => setUserRoleFn({ data: v }),
    onSuccess: done("Role updated"),
    onError: failed,
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-semibold">Users</h1>
        <p className="text-muted-foreground">Access is by invitation only. Invited people set their own password from the e-mail link.</p>
      </div>

      <form
        className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_10rem_auto] lg:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          invite.mutate();
        }}
      >
        <div className="space-y-1">
          <Label>Full name</Label>
          <Input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>Email</Label>
          <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>Role</Label>
          <select className={`${selectClass} w-full`} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            <option value="accountant">Accountant</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <Button type="submit" disabled={invite.isPending}>Send invitation</Button>
      </form>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
            {error && <TableRow><TableCell colSpan={5} className="text-center text-destructive">{(error as Error).message}</TableCell></TableRow>}
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  <select
                    className={selectClass}
                    aria-label={`Role for ${u.name}`}
                    value={u.role ?? ""}
                    onChange={(e) => e.target.value && setRole.mutate({ userId: u.id, role: e.target.value as Role })}
                  >
                    {!u.role && <option value="">No role</option>}
                    <option value="accountant">Accountant</option>
                    <option value="admin">Admin</option>
                  </select>
                </TableCell>
                <TableCell>
                  {u.disabled ? <span className="text-destructive">Disabled</span> : u.lastSignInAt ? `Active · last in ${fmtDate(u.lastSignInAt)}` : "Invited"}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDisabled.mutate({ userId: u.id, disabled: !u.disabled })}
                  >
                    {u.disabled ? "Enable" : "Disable"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
