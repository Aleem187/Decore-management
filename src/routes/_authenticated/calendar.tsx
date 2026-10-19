import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { requireRole, useMe } from "@/lib/auth";
import {
  STATUS_STYLE,
  addDays,
  addMonths,
  dayLabel,
  groupByDay,
  monthGrid,
  monthTitle,
  startOfMonth,
  styleFor,
  timeRange,
  formatTime,
  visibleRange,
  weekTitle,
  type CalendarView,
} from "@/lib/calendar";
import { karachiDate } from "@/lib/date-range";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTeamMembers } from "@/hooks/use-team-members";
import { NewEventDialog } from "@/components/NewEventDialog";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar — Décor Studio" },
      { name: "description", content: "Events by month, week or list." },
    ],
  }),
  beforeLoad: ({ context }) => requireRole(context.queryClient, ["admin", "accountant"]),
  component: CalendarPage,
});

type CalEvent = {
  id: string;
  name: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  status: string;
  hotel_id: string | null;
  client_name: string;
  hotels: { name: string } | null;
  event_staff: { staff_id: string; role: string }[] | null;
};

const VIEWS: { id: CalendarView; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "list", label: "List" },
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** One event as a coloured chip that opens its detail page. */
function Chip({ e, compact }: { e: CalEvent; compact?: boolean }) {
  const st = styleFor(e.status);
  const time = e.start_time ? formatTime(e.start_time) : "";
  return (
    <Link
      to="/events/$eventId"
      params={{ eventId: e.id }}
      onClick={(ev) => ev.stopPropagation()}
      title={`${e.name} · ${STATUS_STYLE[e.status]?.label ?? e.status}${e.hotels?.name ? ` · ${e.hotels.name}` : ""} · ${timeRange(e.start_time, e.end_time)}`}
      className={`block truncate rounded border px-1.5 py-0.5 text-xs font-medium hover:opacity-80 ${st.chip}`}
    >
      {time && <span className="mr-1 opacity-80">{time}</span>}
      {e.name}
      {!compact && e.hotels?.name && (
        <span className="ml-1 font-normal opacity-70">· {e.hotels.name}</span>
      )}
    </Link>
  );
}

function Legend() {
  return (
    <ul
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
      aria-label="Status colours"
    >
      {Object.entries(STATUS_STYLE).map(([k, s]) => (
        <li key={k} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function CalendarPage() {
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";
  const isMobile = useIsMobile();
  const today = karachiDate();
  const [view, setView] = useState<CalendarView>("month");
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);

  const range = visibleRange(view, anchor);
  const { data, isLoading, error } = useQuery({
    queryKey: ["calendar", range.from, range.to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select(
          "id, name, event_date, start_time, end_time, status, hotel_id, client_name, hotels(name), event_staff(staff_id, role)",
        )
        .gte("event_date", range.from)
        .lte("event_date", range.to)
        .is("deleted_at", null)
        .order("event_date");
      if (error) throw error;
      return data as unknown as CalEvent[];
    },
  });
  const team = useTeamMembers(isAdmin);
  const byDay = groupByDay(data ?? []);
  const staffNames = (e: CalEvent) =>
    (e.event_staff ?? [])
      .map((s) => team.data?.find((m) => m.id === s.staff_id)?.name ?? "—")
      .join(", ");

  function move(dir: -1 | 1) {
    setSelected(null);
    setAnchor(view === "week" ? addDays(anchor, dir * 7) : addMonths(anchor, dir));
  }
  // Clicking a date: admins on larger screens start a new event; everywhere else it selects the day.
  function onDay(day: string) {
    setSelected(day);
    if (isAdmin && !isMobile) setCreating(day);
  }

  const title = view === "week" ? weekTitle(anchor) : monthTitle(anchor);
  const dayEvents = selected ? (byDay.get(selected) ?? []) : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold sm:text-4xl">Calendar</h1>
          <p className="text-muted-foreground">
            {isAdmin ? "Click a date to add an event." : "Events by date."} Dates are Asia/Karachi.
          </p>
        </div>
        <div className="inline-flex rounded-md border" role="group" aria-label="Calendar view">
          {VIEWS.map((v) => (
            <Button
              key={v.id}
              size="sm"
              variant={view === v.id ? "default" : "ghost"}
              aria-pressed={view === v.id}
              className="rounded-none first:rounded-l-md last:rounded-r-md"
              onClick={() => setView(v.id)}
            >
              {v.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="outline"
            aria-label={view === "week" ? "Previous week" : "Previous month"}
            onClick={() => move(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setAnchor(today);
              setSelected(null);
            }}
          >
            Today
          </Button>
          <Button
            size="icon"
            variant="outline"
            aria-label={view === "week" ? "Next week" : "Next month"}
            onClick={() => move(1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <h2 className="text-xl font-semibold sm:text-2xl" aria-live="polite">
          {title}
        </h2>
        {isAdmin && (
          <Button
            size="sm"
            onClick={() =>
              setCreating(
                selected ??
                  (anchor.slice(0, 7) === today.slice(0, 7) ? today : startOfMonth(anchor)),
              )
            }
          >
            <Plus className="h-4 w-4" />
            New event
          </Button>
        )}
      </div>
      <Legend />
      {error && <p className="text-destructive">{(error as Error).message}</p>}
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {view === "month" && (
        <div className="overflow-hidden rounded-lg border bg-card shadow-soft">
          <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-2">
                <span className="sm:hidden">{d[0]}</span>
                <span className="hidden sm:inline">{d}</span>
              </div>
            ))}
          </div>
          {monthGrid(anchor).map((week) => (
            <div key={week[0]} className="grid grid-cols-7 border-b last:border-b-0">
              {week.map((day) => {
                const list = byDay.get(day) ?? [];
                const inMonth = day.slice(0, 7) === anchor.slice(0, 7);
                const isToday = day === today;
                return (
                  <div
                    key={day}
                    onClick={() => onDay(day)}
                    className={`min-h-14 min-w-0 cursor-pointer border-r p-1 last:border-r-0 sm:min-h-28 sm:p-1.5 ${inMonth ? "" : "bg-muted/30 text-muted-foreground"} ${selected === day ? "ring-2 ring-inset ring-primary" : "hover:bg-muted/40"}`}
                  >
                    <button
                      type="button"
                      aria-label={`${dayLabel(day)}${list.length ? `, ${list.length} event${list.length > 1 ? "s" : ""}` : ""}`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onDay(day);
                      }}
                      className={`mx-auto flex h-6 w-6 items-center justify-center rounded-full text-xs sm:mx-0 sm:h-7 sm:w-7 sm:text-sm ${isToday ? "bg-primary font-semibold text-primary-foreground" : ""}`}
                    >
                      {Number(day.slice(8))}
                    </button>
                    {/* phones: coloured dots; larger screens: named chips */}
                    <div className="mt-1 flex flex-wrap justify-center gap-0.5 sm:hidden">
                      {list.slice(0, 4).map((e) => (
                        <span
                          key={e.id}
                          className={`h-1.5 w-1.5 rounded-full ${styleFor(e.status).dot}`}
                        />
                      ))}
                    </div>
                    <div className="mt-1 hidden space-y-0.5 sm:block">
                      {list.slice(0, 3).map((e) => (
                        <Chip key={e.id} e={e} compact />
                      ))}
                      {list.length > 3 && (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground underline"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setSelected(day);
                          }}
                        >
                          +{list.length - 3} more
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {view === "week" && (
        <div className="grid gap-2 md:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => addDays(range.from, i)).map((day) => {
            const list = byDay.get(day) ?? [];
            return (
              <div
                key={day}
                className={`min-w-0 rounded-lg border bg-card p-2 ${day === today ? "ring-2 ring-primary" : ""}`}
              >
                <div className="mb-2 flex items-center justify-between gap-1">
                  <span className={`text-sm font-medium ${day === today ? "text-primary" : ""}`}>
                    {dayLabel(day)}
                  </span>
                  {isAdmin && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      aria-label={`Add event on ${dayLabel(day)}`}
                      onClick={() => setCreating(day)}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="space-y-1">
                  {list.map((e) => (
                    <Chip key={e.id} e={e} />
                  ))}
                  {list.length === 0 && <p className="text-xs text-muted-foreground">No events</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === "list" && (
        <div className="space-y-4">
          {!isLoading && (data ?? []).length === 0 && (
            <p className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
              No events in {monthTitle(anchor)}.
            </p>
          )}
          {[...byDay.entries()].map(([day, list]) => (
            <section key={day} className="overflow-hidden rounded-lg border bg-card">
              <header className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                <h3 className={`text-sm font-semibold ${day === today ? "text-primary" : ""}`}>
                  {dayLabel(day)}
                  {day === today && " · Today"}
                </h3>
                {isAdmin && (
                  <Button size="sm" variant="ghost" onClick={() => setCreating(day)}>
                    <Plus className="h-4 w-4" />
                    Add
                  </Button>
                )}
              </header>
              <ul className="divide-y">
                {list.map((e) => (
                  <EventRow key={e.id} e={e} staff={isAdmin ? staffNames(e) : ""} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* The selected day (month view): needed on phones, where cells only have dots */}
      {view === "month" && selected && (
        <section
          className="overflow-hidden rounded-lg border bg-card"
          aria-label={`Events on ${dayLabel(selected)}`}
        >
          <header className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
            <h3 className="text-sm font-semibold">{dayLabel(selected)}</h3>
            {isAdmin && (
              <Button size="sm" onClick={() => setCreating(selected)}>
                <Plus className="h-4 w-4" />
                Add event
              </Button>
            )}
          </header>
          {dayEvents.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">No events on this day.</p>
          ) : (
            <ul className="divide-y">
              {dayEvents.map((e) => (
                <EventRow key={e.id} e={e} staff={isAdmin ? staffNames(e) : ""} />
              ))}
            </ul>
          )}
        </section>
      )}

      <NewEventDialog day={creating} onClose={() => setCreating(null)} />
    </div>
  );
}

function EventRow({ e, staff }: { e: CalEvent; staff: string }) {
  const st = styleFor(e.status);
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
      <div className="min-w-0">
        <Link
          to="/events/$eventId"
          params={{ eventId: e.id }}
          className={`font-medium underline-offset-4 hover:underline ${e.status === "cancelled" ? "line-through" : ""}`}
        >
          {e.name}
        </Link>
        <div className="text-xs text-muted-foreground">
          {timeRange(e.start_time, e.end_time)} · {e.hotels?.name ?? "No venue"} · {e.client_name}
        </div>
        {staff && <div className="text-xs text-muted-foreground">Team: {staff}</div>}
      </div>
      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${st.chip}`}>
        {STATUS_STYLE[e.status]?.label ?? e.status}
      </span>
    </li>
  );
}
