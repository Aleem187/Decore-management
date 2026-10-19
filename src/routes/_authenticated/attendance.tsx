import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { requireRole } from "@/lib/auth";
import { ATTENDANCE_META, ATTENDANCE_STATUSES, monthSummary } from "@/lib/attendance";
import { addDays, dayLabel } from "@/lib/calendar";
import { karachiDate } from "@/lib/date-range";
import type { AttendanceStatus } from "@/lib/salary";
import { useSameDayEvents } from "@/hooks/use-same-day-events";
import { useStaffMembers } from "@/hooks/use-staff-members";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance — Décor Studio" },
      { name: "description", content: "Daily attendance for staff." },
    ],
  }),
  beforeLoad: ({ context }) => requireRole(context.queryClient, ["admin", "accountant"]),
  component: AttendancePage,
});

type Mark = { id: string; staff_id: string; status: AttendanceStatus; event_id: string | null };

function AttendancePage() {
  const qc = useQueryClient();
  const today = karachiDate();
  const [date, setDate] = useState(today);
  const [eventId, setEventId] = useState("");
  const staff = useStaffMembers();
  const sameDay = useSameDayEvents(date);

  const key = ["attendance", "day", date];
  const { data: marks = [] } = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Mark[]> => {
      const { data, error } = await supabase
        .from("attendance")
        .select("id, staff_id, status, event_id")
        .eq("work_date", date);
      if (error) throw error;
      return data as Mark[];
    },
  });
  const byStaff = new Map(marks.map((m) => [m.staff_id, m]));
  const active = (staff.data ?? []).filter((s) => s.active);
  const events = sameDay.events.filter((e) => e.status !== "cancelled");

  const mark = useMutation({
    mutationFn: async (v: { staffId: string; status: AttendanceStatus }) => {
      const existing = byStaff.get(v.staffId);
      const link = eventId || null;
      if (existing) {
        const { error } = await supabase
          .from("attendance")
          .update({ status: v.status, event_id: link ?? existing.event_id })
          .eq("id", existing.id);
        if (error) throw error;
        return;
      }
      const { error } = await supabase
        .from("attendance")
        .insert({ staff_id: v.staffId, work_date: date, status: v.status, event_id: link });
      // Someone else marked this person a moment ago: the database allows one mark per day, so change theirs instead.
      if (error?.code === "23505") {
        const { error: e2 } = await supabase
          .from("attendance")
          .update({ status: v.status })
          .eq("staff_id", v.staffId)
          .eq("work_date", date);
        if (e2) throw e2;
        return;
      }
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const markAllPresent = useMutation({
    mutationFn: async () => {
      const rows = active
        .filter((s) => !byStaff.has(s.id))
        .map((s) => ({
          staff_id: s.id,
          work_date: date,
          status: "present" as const,
          event_id: eventId || null,
        }));
      if (rows.length === 0) return 0;
      const { error } = await supabase.from("attendance").insert(rows);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["attendance"] });
      toast.success(n ? `Marked ${n} present` : "Everyone is already marked");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const summary = monthSummary(marks.filter((m) => active.some((s) => s.id === m.staff_id)));
  const isFuture = date > today;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-semibold sm:text-4xl">Attendance</h1>
        <p className="text-muted-foreground">
          Mark each person for the day. A person has one mark per day: marking again changes it.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="outline"
            aria-label="Previous day"
            onClick={() => setDate(addDays(date, -1))}
          >
            ‹
          </Button>
          <Input
            type="date"
            aria-label="Date"
            max={today}
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="w-40"
          />
          <Button
            size="icon"
            variant="outline"
            aria-label="Next day"
            disabled={date >= today}
            onClick={() => setDate(addDays(date, 1))}
          >
            ›
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDate(today)}
            disabled={date === today}
          >
            Today
          </Button>
        </div>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Worked on event (optional)</span>
          <select
            className="h-9 min-w-48 rounded-md border border-input bg-background px-3 text-sm"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
          >
            <option value="">— none —</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="outline"
          disabled={isFuture || markAllPresent.isPending || active.length === 0}
          onClick={() => markAllPresent.mutate()}
        >
          Mark everyone unmarked as present
        </Button>
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {dayLabel(date)} · {summary.present} present · {summary.half_day} half day ·{" "}
        {summary.absent} absent · {summary.leave} leave · {active.length - summary.marked} not
        marked
      </p>
      {isFuture && (
        <p className="text-sm text-destructive">Attendance cannot be marked for a future date.</p>
      )}
      {staff.error && <p className="text-destructive">{(staff.error as Error).message}</p>}

      <ul className="grid gap-3 md:grid-cols-2">
        {active.length === 0 && !staff.isLoading && (
          <li className="rounded-lg border bg-card p-8 text-center text-muted-foreground md:col-span-2">
            No active staff. Add people on the{" "}
            <Link to="/staff" className="underline">
              Staff
            </Link>{" "}
            page.
          </li>
        )}
        {active.map((s) => {
          const current = byStaff.get(s.id)?.status;
          return (
            <li key={s.id} className="rounded-lg border bg-card p-3">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <Link
                  to="/staff/$staffId"
                  params={{ staffId: s.id }}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {s.name}
                </Link>
                <span className="text-xs text-muted-foreground">{s.job_title}</span>
              </div>
              <div
                className="grid grid-cols-2 gap-2 sm:grid-cols-4"
                role="group"
                aria-label={`Attendance for ${s.name}`}
              >
                {ATTENDANCE_STATUSES.map((st) => (
                  <Button
                    key={st}
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isFuture || mark.isPending}
                    aria-pressed={current === st}
                    className={`h-10 ${current === st ? ATTENDANCE_META[st].chip + " border-2 font-semibold" : ""}`}
                    onClick={() => mark.mutate({ staffId: s.id, status: st })}
                  >
                    {ATTENDANCE_META[st].label}
                  </Button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
