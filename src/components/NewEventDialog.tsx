import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { dayLabel, STATUS_STYLE } from "@/lib/calendar";
import { findVenueClashes } from "@/lib/clashes";
import { useSameDayEvents } from "@/hooks/use-same-day-events";
import { ClashList } from "@/components/ClashList";
import { useOptions } from "@/components/CrudPage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const TYPES = [
  "Wedding",
  "Mehndi",
  "Corporate",
  "Birthday",
  "Stage Decor",
  "Mandap / Stage",
  "Other",
];
const STATUSES = ["upcoming", "in_progress", "completed", "paid", "cancelled"] as const;
type Status = (typeof STATUSES)[number];

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Admin: create an event on a date picked in the calendar. Warns when the venue is already booked. */
export function NewEventDialog({ day, onClose }: { day: string | null; onClose: () => void }) {
  return (
    <Dialog open={!!day} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            New event{day ? ` · ${dayLabel(day)}` : ""}
          </DialogTitle>
        </DialogHeader>
        {day && <NewEventForm key={day} day={day} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function NewEventForm({ day, onClose }: { day: string; onClose: () => void }) {
  const qc = useQueryClient();
  const hotels = useOptions("hotels");
  const clients = useOptions("clients");
  const [v, setV] = useState({
    name: "",
    event_date: day,
    start_time: "",
    end_time: "",
    hotel_id: "",
    client_id: "",
    client_name: "",
    event_type: "Wedding",
    status: "upcoming" as Status,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const set =
    (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setV({ ...v, [k]: e.target.value });
      setConfirming(false);
    };

  // Live venue check against everything already booked that day.
  const sameDay = useSameDayEvents(/^\d{4}-\d{2}-\d{2}$/.test(v.event_date) ? v.event_date : null);
  const clashes = findVenueClashes(
    {
      id: "new",
      event_date: v.event_date,
      start_time: v.start_time || null,
      end_time: v.end_time || null,
      status: v.status,
      hotel_id: v.hotel_id || null,
    },
    sameDay.events,
  );

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!v.name.trim()) e["name"] = "Name is required";
    if (v.name.trim().length > 120) e["name"] = "Name must be at most 120 characters";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.event_date)) e["event_date"] = "Pick a date";
    if (!!v.start_time !== !!v.end_time)
      e["end_time"] = "Set both a start and an end time, or leave both empty";
    else if (v.start_time && v.start_time === v.end_time)
      e["end_time"] = "The end time must differ from the start time";
    if (!v.client_id && !v.client_name.trim())
      e["client_id"] = "Choose a client or type a client name";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("events").insert({
        name: v.name.trim(),
        event_date: v.event_date,
        start_time: v.start_time || null,
        end_time: v.end_time || null,
        hotel_id: v.hotel_id || null,
        event_type: v.event_type,
        status: v.status,
        // The database replaces this with the chosen client's current name.
        client_name: clients.find((c) => c.value === v.client_id)?.label ?? v.client_name.trim(),
        client_id: v.client_id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Event created");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      className="grid gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!validate()) return;
        if (clashes.length > 0 && !confirming) {
          setConfirming(true);
          return;
        }
        create.mutate();
      }}
    >
      <Field label="Event name *" error={errors["name"]}>
        <Input value={v.name} onChange={set("name")} maxLength={120} autoFocus />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Date *" error={errors["event_date"]}>
          <Input type="date" value={v.event_date} onChange={set("event_date")} />
        </Field>
        <Field label="Start time">
          <Input type="time" value={v.start_time} onChange={set("start_time")} />
        </Field>
        <Field label="End time" error={errors["end_time"]}>
          <Input type="time" value={v.end_time} onChange={set("end_time")} />
        </Field>
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">
        Times are optional. An end time before the start time means the event runs past midnight.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Hotel / venue">
          <select className={selectClass} value={v.hotel_id} onChange={set("hotel_id")}>
            <option value="">—</option>
            {hotels.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Event type">
          <select className={selectClass} value={v.event_type} onChange={set("event_type")}>
            {TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Client" error={errors["client_id"]}>
          <select className={selectClass} value={v.client_id} onChange={set("client_id")}>
            <option value="">—</option>
            {clients.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Client name (if not in the list)">
          <Input value={v.client_name} onChange={set("client_name")} disabled={!!v.client_id} />
        </Field>
        <Field label="Status">
          <select className={selectClass} value={v.status} onChange={set("status")}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_STYLE[s]?.label ?? s}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <ClashList
        title="This venue already has an event at an overlapping time on this date."
        clashes={clashes}
      />
      {confirming && (
        <p className="text-sm font-medium">
          This will double-book the venue. Create the event anyway?
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          onClick={confirming ? () => setConfirming(false) : onClose}
        >
          {confirming ? "Go back" : "Cancel"}
        </Button>
        <Button
          type="submit"
          variant={confirming ? "destructive" : "default"}
          disabled={create.isPending}
        >
          {confirming ? "Create anyway" : "Create event"}
        </Button>
      </div>
    </form>
  );
}
