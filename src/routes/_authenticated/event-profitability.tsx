import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { requireRole } from "@/lib/auth";
import { downloadCsv } from "@/lib/csv";
import { REPORT_HEADERS, buildReport, reportCsvRows } from "@/lib/event-pnl";
import { fmtDate, pkr } from "@/lib/format";
import { useDateRange } from "@/hooks/use-date-range";
import { RangeFilter } from "@/components/RangeFilter";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/event-profitability")({
  head: () => ({
    meta: [
      { title: "Event Profitability — Sarim Events Planner" },
      { name: "description", content: "Profit and loss for each event." },
    ],
  }),
  beforeLoad: ({ context }) => requireRole(context.queryClient, ["admin"]),
  component: EventProfitability,
});

const tone = (n: number) => (n < 0 ? "text-destructive" : "text-success");
const pctText = (m: number | null) => (m === null ? "—" : `${m}%`);

function EventProfitability() {
  const dateRange = useDateRange();
  const { range } = dateRange;

  // Each request is written to the audit log by the database, so avoid refetching on every window focus.
  const { data, isLoading, error } = useQuery({
    queryKey: ["event-pnl", range.from, range.to],
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const [rows, general] = await Promise.all([
        supabase.rpc("event_pnl", { _from: range.from, _to: range.to }),
        supabase.rpc("general_expenses_total", { _from: range.from, _to: range.to }),
      ]);
      for (const r of [rows, general]) if (r.error) throw r.error;
      return buildReport(rows.data ?? [], general.data ?? 0);
    },
  });

  const empty = !data || (data.events.length === 0 && data.general === 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold sm:text-4xl">Event Profitability</h1>
          <p className="text-muted-foreground">
            Events held in the period. Profit = received − expenses; margin = profit ÷ received.
          </p>
        </div>
        <RangeFilter range={dateRange} />
      </div>

      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          disabled={empty}
          onClick={() =>
            data &&
            downloadCsv(
              `event-profitability-${range.from}_to_${range.to}`,
              REPORT_HEADERS,
              reportCsvRows(data),
            )
          }
        >
          <Download className="h-4 w-4" />
          Export Report (CSV)
        </Button>
      </div>

      {error && <p className="text-destructive">{(error as Error).message}</p>}

      <div className="rounded-lg border bg-card shadow-soft">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead className="hidden md:table-cell">Client</TableHead>
              <TableHead className="hidden lg:table-cell">Hotel</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Invoiced</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Expenses</TableHead>
              <TableHead className="text-right">Profit</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Margin</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {data && data.events.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  No events held in this period.
                </TableCell>
              </TableRow>
            )}
            {data?.events.map((e) => (
              <TableRow key={e.eventId}>
                <TableCell>
                  <Link
                    to="/events/$eventId"
                    params={{ eventId: e.eventId }}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {e.eventName}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {fmtDate(e.eventDate)}
                    <span className="md:hidden"> · {e.client}</span>
                    <span className="lg:hidden"> · {e.hotel}</span>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">{e.client}</TableCell>
                <TableCell className="hidden lg:table-cell">{e.hotel}</TableCell>
                <TableCell className="hidden text-right sm:table-cell">{pkr(e.invoiced)}</TableCell>
                <TableCell className="text-right">{pkr(e.received)}</TableCell>
                <TableCell className="text-right">{pkr(e.expenses)}</TableCell>
                <TableCell className={`text-right font-medium ${tone(e.profit)}`}>
                  {pkr(e.profit)}
                </TableCell>
                <TableCell className="hidden text-right sm:table-cell">
                  {pctText(e.margin)}
                </TableCell>
              </TableRow>
            ))}
            {data && data.events.length > 0 && (
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell>Total ({data.events.length} events)</TableCell>
                <TableCell className="hidden md:table-cell" />
                <TableCell className="hidden lg:table-cell" />
                <TableCell className="hidden text-right sm:table-cell">
                  {pkr(data.totals.invoiced)}
                </TableCell>
                <TableCell className="text-right">{pkr(data.totals.received)}</TableCell>
                <TableCell className="text-right">{pkr(data.totals.expenses)}</TableCell>
                <TableCell className={`text-right ${tone(data.totals.profit)}`}>
                  {pkr(data.totals.profit)}
                </TableCell>
                <TableCell className="hidden text-right sm:table-cell">
                  {pctText(data.totals.margin)}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {data && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border bg-card p-4">
            <div className="text-sm text-muted-foreground">
              General expenses (not linked to an event)
            </div>
            <div className="font-display text-2xl font-semibold">{pkr(data.general)}</div>
            <div className="text-xs text-muted-foreground">
              Dated in this period. Never counted in any event's profit.
            </div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-sm text-muted-foreground">Net after general expenses</div>
            <div className={`font-display text-2xl font-semibold ${tone(data.netAfterGeneral)}`}>
              {pkr(data.netAfterGeneral)}
            </div>
            <div className="text-xs text-muted-foreground">Event profit minus general expenses</div>
          </div>
        </div>
      )}
    </div>
  );
}
