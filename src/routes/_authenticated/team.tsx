import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { effectiveRole, meQuery } from "@/lib/auth";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({ meta: [{ title: "Team & Audit — Décor Studio" }, { name: "description", content: "Staff roles and activity log." }, { property: "og:title", content: "Team & Audit — Décor Studio" }, { property: "og:description", content: "Staff roles and activity log." }] }),
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (effectiveRole(me?.role ?? null) !== "admin") throw redirect({ to: "/dashboard" });
  },
  component: TeamPage,
});

function TeamPage() {
  const { data } = useQuery({
    queryKey: ["team"],
    queryFn: async () => {
      const [p, r, a] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at"),
        supabase.from("user_roles").select("*"),
        supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(100),
      ]);
      return { profiles: p.data ?? [], roles: r.data ?? [], logs: a.data ?? [] };
    },
  });
  const name = (id: string | null) => data?.profiles.find((p) => p.id === id)?.full_name ?? "System";

  return (
    <div className="space-y-8">
      <div><h1 className="text-4xl font-semibold">Team & audit</h1><p className="text-muted-foreground">Staff accounts and every change made to the books.</p></div>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead></TableRow></TableHeader>
          <TableBody>
            {data?.profiles.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.full_name}</TableCell>
                <TableCell>{p.email}</TableCell>
                <TableCell className="capitalize">{data.roles.filter((r) => r.user_id === p.id).map((r) => r.role).join(", ")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="rounded-lg border bg-card">
        <h2 className="px-4 pt-4 text-2xl font-semibold">Activity log</h2>
        <Table>
          <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Who</TableHead><TableHead>Action</TableHead><TableHead>Area</TableHead></TableRow></TableHeader>
          <TableBody>
            {data?.logs.map((l) => (
              <TableRow key={l.id}>
                <TableCell>{new Date(l.created_at).toLocaleString("en-GB")}</TableCell>
                <TableCell>{name(l.user_id)}</TableCell>
                <TableCell className="capitalize">{l.action.toLowerCase()}</TableCell>
                <TableCell className="capitalize">{l.table_name}</TableCell>
              </TableRow>
            ))}
            {data?.logs.length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">No activity yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
