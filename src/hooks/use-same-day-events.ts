import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Assignment, ClashEvent } from "@/lib/clashes";

export type SameDayEvent = ClashEvent & {
  name: string;
  event_staff: { staff_id: string }[] | null;
};

/** Every live event on one date (any status), with who is assigned, for clash checks. */
export function useSameDayEvents(date: string | null | undefined) {
  const query = useQuery({
    enabled: !!date,
    queryKey: ["events", "same-day", date],
    staleTime: 15_000,
    queryFn: async (): Promise<SameDayEvent[]> => {
      const { data, error } = await supabase
        .from("events")
        .select(
          "id, name, event_date, start_time, end_time, status, hotel_id, deleted_at, event_staff(staff_id)",
        )
        .eq("event_date", date as string)
        .is("deleted_at", null);
      if (error) throw error;
      return data as SameDayEvent[];
    },
  });
  const events = query.data ?? [];
  const assignments: Assignment[] = events.flatMap((e) =>
    (e.event_staff ?? []).map((s) => ({ event_id: e.id, staff_id: s.staff_id })),
  );
  return { ...query, events, assignments };
}
