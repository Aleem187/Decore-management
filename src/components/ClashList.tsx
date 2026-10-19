import { Link } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { describeTimes, type ClashEvent } from "@/lib/clashes";
import { dayLabel } from "@/lib/calendar";

/** A warning box listing the events that clash. `title` says what clashes (the venue, a person). */
export function ClashList({
  title,
  clashes,
}: {
  title: string;
  clashes: (ClashEvent & { name?: string })[];
}) {
  if (clashes.length === 0) return null;
  return (
    <div role="alert" className="rounded-md border border-warning/50 bg-warning/15 p-3 text-sm">
      <div className="flex items-start gap-2 font-medium">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{title}</span>
      </div>
      <ul className="mt-1 list-disc space-y-0.5 pl-9">
        {clashes.map((c) => (
          <li key={c.id}>
            <Link
              to="/events/$eventId"
              params={{ eventId: c.id }}
              className="font-medium underline underline-offset-2"
            >
              {c.name ?? "Another event"}
            </Link>{" "}
            · {dayLabel(c.event_date)} · {describeTimes(c)}
          </li>
        ))}
      </ul>
    </div>
  );
}
