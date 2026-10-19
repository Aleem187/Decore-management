import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { describeTimes, findStaffClashes, type ClashEvent } from "@/lib/clashes";
import { dayLabel } from "@/lib/calendar";
import { useSameDayEvents } from "@/hooks/use-same-day-events";
import { useStaffMembers } from "@/hooks/use-staff-members";
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

/**
 * Admin-only: who is working this event. New assignments are staff members (the Staff page); assignments
 * made earlier to login users still show and can be removed. Warns before double-booking someone.
 */
export function EventTeam({ event }: { event: ClashEvent & { name: string } }) {
  const qc = useQueryClient();
  const key = ["event-team", event.id];
  const [memberId, setMemberId] = useState("");
  const [role, setRole] = useState(DEFAULT_ROLE);
  const [pending, setPending] = useState<{
    memberId: string;
    name: string;
    clashes: ClashEvent[];
  } | null>(null);

  const staff = useStaffMembers();
  const logins = useTeamMembers(true); // names for assignments made before the Staff module existed
  const sameDay = useSameDayEvents(event.event_date);
  const { data: assigned = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_staff")
        .select("id, staff_id, staff_member_id, role")
        .eq("event_id", event.id)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const personKey = (a: { staff_id: string | null; staff_member_id: string | null }) =>
    (a.staff_member_id ?? a.staff_id) as string;
  const nameOf = (a: { staff_id: string | null; staff_member_id: string | null }) =>
    a.staff_member_id
      ? (staff.data?.find((m) => m.id === a.staff_member_id)?.name ?? "Former staff member")
      : (logins.data?.find((m) => m.id === a.staff_id)?.name ?? "Login user");
  const staffName = (id: string) => staff.data?.find((m) => m.id === id)?.name ?? "this person";

  const taken = new Set(assigned.map((a) => a.staff_member_id));
  const available = (staff.data ?? []).filter((m) => m.active && !taken.has(m.id));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["events", "same-day"] });
    qc.invalidateQueries({ queryKey: ["calendar"] });
  };
  const onError = (e: Error) => toast.error(e.message);

  const add = useMutation({
    mutationFn: async (v: { memberId: string; role: string }) => {
      const { error } = await supabase.from("event_staff").insert({
        event_id: event.id,
        staff_member_id: v.memberId,
        role: v.role.trim() || DEFAULT_ROLE,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setMemberId("");
      setPending(null);
      refresh();
      toast.success("Staff member assigned");
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
    if (!memberId) return;
    const clashes = findStaffClashes(memberId, event, sameDay.events, sameDay.assignments);
    if (clashes.length > 0) {
      setPending({ memberId, name: staffName(memberId), clashes });
      return;
    }
    add.mutate({ memberId, role });
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
          const clashes = findStaffClashes(
            personKey(a),
            event,
            sameDay.events,
            sameDay.assignments,
          );
          return (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium">
                  {a.staff_member_id ? (
                    <Link
                      to="/staff/$staffId"
                      params={{ staffId: a.staff_member_id }}
                      className="underline-offset-4 hover:underline"
                    >
                      {nameOf(a)}
                    </Link>
                  ) : (
                    <>
                      {nameOf(a)}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        (login user)
                      </span>
                    </>
                  )}
                </div>
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
                aria-label={`Remove ${nameOf(a)}`}
                onClick={() =>
                  confirm(`Remove ${nameOf(a)} from this event?`) && remove.mutate(a.id)
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
              onClick={() => add.mutate({ memberId: pending.memberId, role })}
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
            aria-label="Staff member"
            required
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Choose a staff member…</option>
            {available.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.job_title})
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
          <Button type="submit" disabled={add.isPending || sameDay.isLoading || !memberId}>
            <Plus className="h-4 w-4" />
            Assign
          </Button>
        </form>
      )}
      {staff.error && <p className="text-xs text-destructive">{(staff.error as Error).message}</p>}
      <p className="text-xs text-muted-foreground">
        Staff members are managed on the{" "}
        <Link to="/staff" className="underline">
          Staff
        </Link>{" "}
        page. Inactive staff are not listed.
      </p>
    </section>
  );
}
