import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { describeTimes, findStaffClashes, type ClashEvent } from "@/lib/clashes";
import { dayLabel } from "@/lib/calendar";
import { useSameDayEvents } from "@/hooks/use-same-day-events";
import { useTeamMembers } from "@/hooks/use-team-members";
import { ClashList } from "@/components/ClashList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const DEFAULT_ROLE = "Decorator";
const ROLE_SUGGESTIONS = [
  "Lead decorator",
  "Decorator",
  "Electrician",
  "Helper",
  "Driver",
  "Supervisor",
];

/** Admin-only: who is working this event. Warns before double-booking someone; the admin can still go ahead. */
export function EventTeam({ event }: { event: ClashEvent & { name: string } }) {
  const qc = useQueryClient();
  const key = ["event-team", event.id];
  const [staffId, setStaffId] = useState("");
  const [role, setRole] = useState(DEFAULT_ROLE);
  const [pending, setPending] = useState<{
    staffId: string;
    name: string;
    clashes: ClashEvent[];
  } | null>(null);

  const team = useTeamMembers(true);
  const sameDay = useSameDayEvents(event.event_date);
  const { data: assigned = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_staff")
        .select("id, staff_id, role")
        .eq("event_id", event.id)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const nameOf = (id: string) => team.data?.find((m) => m.id === id)?.name ?? "Former team member";
  const taken = new Set(assigned.map((a) => a.staff_id));
  const available = (team.data ?? []).filter((m) => !taken.has(m.id));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["events", "same-day"] });
    qc.invalidateQueries({ queryKey: ["calendar"] });
  };
  const onError = (e: Error) => toast.error(e.message);

  const add = useMutation({
    mutationFn: async (v: { staffId: string; role: string }) => {
      const { error } = await supabase
        .from("event_staff")
        .insert({ event_id: event.id, staff_id: v.staffId, role: v.role.trim() || DEFAULT_ROLE });
      if (error) throw error;
    },
    onSuccess: () => {
      setStaffId("");
      setPending(null);
      refresh();
      toast.success("Team member assigned");
    },
    onError,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("event_staff").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError,
  });

  function tryAssign() {
    if (!staffId) return;
    const clashes = findStaffClashes(staffId, event, sameDay.events, sameDay.assignments);
    if (clashes.length > 0) {
      setPending({ staffId, name: nameOf(staffId), clashes });
      return;
    }
    add.mutate({ staffId, role });
  }

  return (
    <section className="space-y-3">
      <h2 className="text-2xl font-semibold">Team</h2>

      <ul className="divide-y rounded-lg border bg-card shadow-soft">
        {isLoading && <li className="p-3 text-sm text-muted-foreground">Loading…</li>}
        {!isLoading && assigned.length === 0 && (
          <li className="p-4 text-center text-sm text-muted-foreground">Nobody assigned yet.</li>
        )}
        {assigned.map((a) => {
          const clashes = findStaffClashes(a.staff_id, event, sameDay.events, sameDay.assignments);
          return (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium">{nameOf(a.staff_id)}</div>
                <div className="text-xs text-muted-foreground">{a.role}</div>
                {clashes.length > 0 && (
                  <div className="mt-1 flex items-start gap-1 text-xs text-foreground">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Also on{" "}
                      {clashes
                        .map(
                          (c) =>
                            `${(c as ClashEvent & { name?: string }).name ?? "another event"} (${describeTimes(c)})`,
                        )
                        .join(", ")}{" "}
                      on {dayLabel(event.event_date)}
                    </span>
                  </div>
                )}
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove ${nameOf(a.staff_id)}`}
                onClick={() =>
                  confirm(`Remove ${nameOf(a.staff_id)} from this event?`) && remove.mutate(a.id)
                }
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </li>
          );
        })}
      </ul>

      {pending ? (
        <div className="space-y-3 rounded-lg border p-3">
          <ClashList
            title={`${pending.name} is already assigned to another event that overlaps this one.`}
            clashes={pending.clashes}
          />
          <p className="text-sm">Assign {pending.name} anyway?</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              disabled={add.isPending}
              onClick={() => add.mutate({ staffId: pending.staffId, role })}
            >
              Assign anyway
            </Button>
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            tryAssign();
          }}
        >
          <select
            aria-label="Team member"
            required
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Choose a team member…</option>
            {available.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.role})
              </option>
            ))}
          </select>
          <div>
            <Input
              list="event-roles"
              aria-label="Role on this event"
              placeholder="Role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              maxLength={60}
            />
            <datalist id="event-roles">
              {ROLE_SUGGESTIONS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>
          <Button type="submit" disabled={add.isPending || sameDay.isLoading || !staffId}>
            <Plus className="h-4 w-4" />
            Assign
          </Button>
        </form>
      )}
      {team.error && <p className="text-xs text-destructive">{(team.error as Error).message}</p>}
      <p className="text-xs text-muted-foreground">
        Team members are the people with a login in Users. Disabled accounts are not listed.
      </p>
    </section>
  );
}
