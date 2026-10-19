import { PRESET_LABEL, TIME_ZONE, type RangePreset } from "@/lib/date-range";
import type { DateRangeState } from "@/hooks/use-date-range";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PRESETS: RangePreset[] = ["this_month", "last_month", "this_year", "custom"];

/** This month / Last month / This year / Custom, in Asia/Karachi. Pair with useDateRange(). */
export function RangeFilter({ range: r }: { range: DateRangeState }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Date range">
        {PRESETS.map((p) => (
          <Button
            key={p}
            size="sm"
            variant={r.preset === p ? "default" : "outline"}
            aria-pressed={r.preset === p}
            onClick={() => r.pick(p)}
          >
            {PRESET_LABEL[p]}
          </Button>
        ))}
      </div>
      {r.preset === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            aria-label="From date"
            className="w-40"
            value={r.from}
            onChange={(e) => r.setDate("from", e.target.value)}
          />
          <span className="text-sm text-muted-foreground">to</span>
          <Input
            type="date"
            aria-label="To date"
            className="w-40"
            value={r.to}
            onChange={(e) => r.setDate("to", e.target.value)}
          />
        </div>
      )}
      <p className={`text-xs ${r.invalid ? "text-destructive" : "text-muted-foreground"}`}>
        {r.invalid
          ? "Pick a valid range (the start date must not be after the end date). Showing the last valid range."
          : `${r.label} · ${TIME_ZONE}`}
      </p>
    </div>
  );
}
