import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronLeft, ChevronRight, FileText, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { requireRole, useMe } from "@/lib/auth";
import { ATTENDANCE_META, ATTENDANCE_STATUSES, monthSummary, monthWeeks } from "@/lib/attendance";
import { addMonths, dayLabel, endOfMonth, startOfMonth } from "@/lib/calendar";
import { karachiDate } from "@/lib/date-range";
import { fmtDate, pkr } from "@/lib/format";
import { METHOD_LABEL, PAYMENT_METHODS, type PaymentMethod } from "@/lib/payments";
import { formatPkPhone } from "@/lib/phone";
import { SALARY_RULES, calculateSalary, fromStoredCalc, type AttendanceStatus } from "@/lib/salary";
import { downloadSalarySlip } from "@/lib/salary-slip-pdf";
import { maskCnic, payLabel } from "@/lib/staff";
import { useStaffMembers } from "@/hooks/use-staff-members";
import { StaffForm } from "@/components/StaffForm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/staff/$staffId")({
  head: () => ({ meta: [{ title: "Staff member — Sarim Events Planner" }] }),
  beforeLoad: ({ context }) => requireRole(context.queryClient, ["admin"]),
  component: StaffDetail,
});

const monthTitle = (m: string) =>
  new Date(`${m}T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

function Metric({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  value: string;
  tone?: string | undefined;
  note?: string | undefined;
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`break-words font-display text-xl font-semibold ${tone ?? ""}`}>{value}</div>
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

function StaffDetail() {
  const { staffId } = Route.useParams();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";
  const today = karachiDate();
  const [month, setMonth] = useState(startOfMonth(today));
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [bonus, setBonus] = useState("");
  const [pay, setPay] = useState({
    method: "cash" as PaymentMethod,
    reference_no: "",
    paid_on: today,
    note: "",
  });
  const [advance, setAdvance] = useState({ amount: "", given_on: today, note: "" });
  const [voiding, setVoiding] = useState<{ id: string; reason: string } | null>(null);

  const staffList = useStaffMembers();
  const staff = staffList.data?.find((s) => s.id === staffId);
  const end = endOfMonth(month);

  const attendanceQ = useQuery({
    queryKey: ["attendance", "month", staffId, month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance")
        .select("id, work_date, status")
        .eq("staff_id", staffId)
        .gte("work_date", month)
        .lte("work_date", end);
      if (error) throw error;
      return data as { id: string; work_date: string; status: AttendanceStatus }[];
    },
  });
  const advancesQ = useQuery({
    queryKey: ["staff-advances", staffId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_advances")
        .select("id, amount, given_on, note")
        .eq("staff_id", staffId)
        .is("deleted_at", null)
        .order("given_on", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const paymentsQ = useQuery({
    queryKey: ["salary-payments", staffId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("salary_payments")
        .select("*")
        .eq("staff_id", staffId)
        .order("period_month", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const refresh = () => qc.invalidateQueries();
  const onError = (e: Error) => toast.error(e.message);

  const attendance = attendanceQ.data ?? [];
  const advances = advancesQ.data ?? [];
  const payments = paymentsQ.data ?? [];
  const byDay = new Map(attendance.map((a) => [a.work_date, a]));

  const mark = useMutation({
    mutationFn: async (v: { day: string; status: AttendanceStatus }) => {
      const existing = byDay.get(v.day);
      if (existing) {
        const { error } = await supabase
          .from("attendance")
          .update({ status: v.status })
          .eq("id", existing.id);
        if (error) throw error;
        return;
      }
      const { error } = await supabase
        .from("attendance")
        .insert({ staff_id: staffId, work_date: v.day, status: v.status });
      if (error?.code === "23505") {
        const { error: e2 } = await supabase
          .from("attendance")
          .update({ status: v.status })
          .eq("staff_id", staffId)
          .eq("work_date", v.day);
        if (e2) throw e2;
        return;
      }
      if (error) throw error;
    },
    onSuccess: refresh,
    onError,
  });
  const clearMark = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("attendance").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setSelected(null);
      refresh();
    },
    onError,
  });

  const addAdvance = useMutation({
    mutationFn: async () => {
      const amount = Number(advance.amount);
      if (!(amount > 0)) throw new Error("Enter an amount above zero");
      const { error } = await supabase.from("staff_advances").insert({
        staff_id: staffId,
        amount,
        given_on: advance.given_on || today,
        note: advance.note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setAdvance({ amount: "", given_on: today, note: "" });
      toast.success("Advance recorded");
      refresh();
    },
    onError,
  });
  const removeAdvance = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("soft_delete", { _table: "staff_advances", _id: id });
      if (error) throw error;
    },
    onSuccess: refresh,
    onError,
  });

  const liveBonus = Number(bonus) || 0;
  const activePayments = payments.filter((p) => !p.voided_at);
  const paidThisMonth = activePayments.find((p) => p.period_month === month);
  const result = staff
    ? paidThisMonth
      ? fromStoredCalc(paidThisMonth.calc as Record<string, unknown>)
      : calculateSalary({
          salaryType: staff.salary_type as "monthly" | "daily_wage",
          rate: staff.rate,
          joiningDate: staff.joining_date,
          month,
          attendance,
          advancesGiven: advances
            .filter((a) => a.given_on <= end)
            .reduce((s, a) => s + Number(a.amount), 0),
          advancesRecovered: activePayments.reduce((s, p) => s + Number(p.advance_deducted), 0),
          bonus: liveBonus,
        })
    : null;

  const recordPayment = useMutation({
    mutationFn: async () => {
      if (!result || !staff) return;
      if (liveBonus < 0) throw new Error("Bonus cannot be negative");
      const { error } = await supabase.rpc("record_salary_payment", {
        _staff_id: staffId,
        _month: month,
        _bonus: liveBonus,
        _expected_net: result.net,
        _method: pay.method,
        _reference_no: pay.reference_no.trim() || null,
        _paid_on: pay.paid_on || today,
        _note: pay.note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setBonus("");
      setPay({ method: "cash", reference_no: "", paid_on: today, note: "" });
      toast.success("Salary payment recorded");
      refresh();
    },
    onError,
  });
  const voidPayment = useMutation({
    mutationFn: async (v: { id: string; reason: string }) => {
      if (v.reason.trim().length < 3) throw new Error("Enter a reason (at least 3 characters)");
      const { error } = await supabase.rpc("void_salary_payment", {
        _id: v.id,
        _reason: v.reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setVoiding(null);
      toast.success("Salary payment voided");
      refresh();
    },
    onError,
  });

  if (staffList.isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!staff || !result) {
    return (
      <div className="space-y-3">
        <Link
          to="/staff"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          All staff
        </Link>
        <p>This staff member was not found. They may have been deleted.</p>
      </div>
    );
  }

  const summary = monthSummary(attendance);
  const selectedMark = selected ? byDay.get(selected) : undefined;
  const slip = (
    payment: {
      method: string;
      reference_no: string | null;
      paid_on: string;
      voided_at: string | null;
    } | null,
    res = result,
    m = month,
  ) =>
    downloadSalarySlip({ staff, month: m, result: res, payment }).catch((e: Error) =>
      toast.error(e.message),
    );

  return (
    <div className="space-y-8">
      <Link
        to="/staff"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        All staff
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="break-words text-3xl font-semibold sm:text-4xl">
            {staff.name}{" "}
            {!staff.active && (
              <span className="ml-1 rounded-full bg-muted px-2 py-0.5 align-middle text-sm font-normal">
                Inactive
              </span>
            )}
          </h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>{staff.job_title}</span>
            <span>{payLabel(staff.salary_type, staff.rate)}</span>
            {staff.phone && <span>{formatPkPhone(staff.phone)}</span>}
            <span>CNIC {maskCnic(staff.cnic)}</span>
            <span>Joined {staff.joining_date ? fmtDate(staff.joining_date) : "—"}</span>
          </div>
          {staff.notes && (
            <p className="max-w-prose whitespace-pre-line pt-1 text-sm">{staff.notes}</p>
          )}
        </div>
        {isAdmin && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="outline"
            aria-label="Previous month"
            onClick={() => {
              setMonth(addMonths(month, -1));
              setSelected(null);
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setMonth(startOfMonth(today));
              setSelected(null);
            }}
          >
            This month
          </Button>
          <Button
            size="icon"
            variant="outline"
            aria-label="Next month"
            disabled={month >= startOfMonth(today)}
            onClick={() => {
              setMonth(addMonths(month, 1));
              setSelected(null);
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <h2 className="text-xl font-semibold sm:text-2xl" aria-live="polite">
          {monthTitle(month)}
        </h2>
      </div>

      <section className="space-y-3">
        <h2 className="text-2xl font-semibold">Attendance</h2>
        <p className="text-sm text-muted-foreground">
          {summary.present} present · {summary.half_day} half day · {summary.absent} absent ·{" "}
          {summary.leave} leave · {summary.daysWorked} days worked
        </p>
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="py-1.5">
                <span className="sm:hidden">{d[0]}</span>
                <span className="hidden sm:inline">{d}</span>
              </div>
            ))}
          </div>
          {monthWeeks(month).map((week) => (
            <div key={week[0]?.day} className="grid grid-cols-7 border-b last:border-b-0">
              {week.map(({ day, inMonth }) => {
                const m = inMonth ? byDay.get(day) : undefined;
                const future = day > today;
                return (
                  <button
                    key={day}
                    type="button"
                    disabled={!inMonth || future}
                    aria-label={`${dayLabel(day)}${m ? `, ${ATTENDANCE_META[m.status].label}` : ", not marked"}`}
                    onClick={() => setSelected(day === selected ? null : day)}
                    className={`flex h-12 flex-col items-center justify-center border-r text-xs last:border-r-0 sm:h-14 ${inMonth ? "" : "bg-muted/30 text-transparent"} ${future && inMonth ? "text-muted-foreground/50" : ""} ${selected === day ? "ring-2 ring-inset ring-primary" : ""} ${m ? ATTENDANCE_META[m.status].chip : "hover:bg-muted/40"}`}
                  >
                    <span>{Number(day.slice(8))}</span>
                    {m && (
                      <span className="text-[10px] font-semibold">
                        {ATTENDANCE_META[m.status].short}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <ul
          className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
          aria-label="Legend"
        >
          {ATTENDANCE_STATUSES.map((s) => (
            <li key={s}>
              <b>{ATTENDANCE_META[s].short}</b> {ATTENDANCE_META[s].label}
            </li>
          ))}
        </ul>
        {selected && (
          <div className="rounded-lg border bg-card p-3">
            <div className="mb-2 text-sm font-medium">
              {dayLabel(selected)}
              {selectedMark ? ` · ${ATTENDANCE_META[selectedMark.status].label}` : " · not marked"}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {ATTENDANCE_STATUSES.map((st) => (
                <Button
                  key={st}
                  size="sm"
                  variant="outline"
                  disabled={mark.isPending}
                  aria-pressed={selectedMark?.status === st}
                  className={`h-10 ${selectedMark?.status === st ? `${ATTENDANCE_META[st].chip} border-2 font-semibold` : ""}`}
                  onClick={() => mark.mutate({ day: selected, status: st })}
                >
                  {ATTENDANCE_META[st].label}
                </Button>
              ))}
              {isAdmin && selectedMark && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-10 text-destructive"
                  onClick={() =>
                    confirm("Remove this attendance mark?") && clearMark.mutate(selectedMark.id)
                  }
                >
                  <Trash2 className="h-4 w-4" /> Clear
                </Button>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-semibold">Salary — {monthTitle(month)}</h2>
        {paidThisMonth && (
          <p className="text-sm text-success">
            Paid on {fmtDate(paidThisMonth.paid_on)}. These are the figures that were recorded.
          </p>
        )}
        {!paidThisMonth && attendance.length === 0 && staff.salary_type === "monthly" && (
          <p className="text-sm text-foreground">
            No attendance is marked for this month, so the full salary is shown. Mark absences first
            if there were any.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label={
              result.salaryType === "daily_wage"
                ? `Wages (${result.daysWorked} days)`
                : "Earned this month"
            }
            value={pkr(result.gross)}
            note={
              result.salaryType === "monthly" && result.unpaidDays + result.preJoinDays > 0
                ? `${result.unpaidDays + result.preJoinDays} unpaid days deducted`
                : undefined
            }
          />
          <Metric label="Bonus" value={pkr(result.bonus)} />
          <Metric
            label="Advance recovered"
            value={`− ${pkr(result.advanceDeducted)}`}
            tone="text-destructive"
            note={
              result.advanceCarriedForward > 0
                ? `${pkr(result.advanceCarriedForward)} carries forward`
                : undefined
            }
          />
          <Metric label="Net pay" value={pkr(result.net)} tone="text-success" />
        </div>

        {!paidThisMonth && (
          <form
            className="grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (
                confirm(
                  `Record a salary payment of ${pkr(result.net)} to ${staff.name} for ${monthTitle(month)}?\n\nThis cannot be edited afterwards. Only an admin can void it.`,
                )
              )
                recordPayment.mutate();
            }}
          >
            <div className="space-y-1">
              <Label>Bonus (PKR, optional)</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={bonus}
                onChange={(e) => setBonus(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Method</Label>
              <select
                className={selectClass}
                value={pay.method}
                onChange={(e) => setPay({ ...pay, method: e.target.value as PaymentMethod })}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {METHOD_LABEL[m]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Paid on</Label>
              <Input
                type="date"
                max={today}
                value={pay.paid_on}
                onChange={(e) => setPay({ ...pay, paid_on: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Reference no.</Label>
              <Input
                value={pay.reference_no}
                onChange={(e) => setPay({ ...pay, reference_no: e.target.value })}
              />
            </div>
            <div className="space-y-1 sm:col-span-1 lg:col-span-2">
              <Label>Note</Label>
              <Input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} />
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={recordPayment.isPending}>
                Record payment of {pkr(result.net)}
              </Button>
              <Button type="button" variant="outline" onClick={() => slip(null)}>
                <FileText className="h-4 w-4" /> Draft salary slip
              </Button>
            </div>
          </form>
        )}

        <details className="rounded-lg border bg-card p-3 text-sm">
          <summary className="cursor-pointer font-medium">How salary is calculated</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            {SALARY_RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </details>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-semibold">Salary payments</h2>
        <div className="overflow-x-auto rounded-lg border bg-card shadow-soft">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead>Net paid</TableHead>
                <TableHead className="hidden sm:table-cell">Paid on</TableHead>
                <TableHead className="hidden md:table-cell">Method</TableHead>
                <TableHead className="w-52" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No salary payments yet.
                  </TableCell>
                </TableRow>
              )}
              {payments.map((p) => (
                <TableRow key={p.id} className={p.voided_at ? "text-muted-foreground" : ""}>
                  <TableCell className="whitespace-nowrap">{monthTitle(p.period_month)}</TableCell>
                  <TableCell className={p.voided_at ? "line-through" : "font-medium"}>
                    {pkr(p.amount)}
                    {p.voided_at && (
                      <div className="text-xs text-destructive no-underline">
                        Voided {fmtDate(p.voided_at)}: {p.void_reason}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap sm:table-cell">
                    {fmtDate(p.paid_on)}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {METHOD_LABEL[p.method as PaymentMethod] ?? p.method}
                  </TableCell>
                  <TableCell className="text-right">
                    {!p.voided_at && voiding?.id !== p.id && (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            slip(
                              p,
                              fromStoredCalc(p.calc as Record<string, unknown>),
                              p.period_month,
                            )
                          }
                        >
                          <FileText className="h-4 w-4" /> Slip
                        </Button>
                        {isAdmin && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setVoiding({ id: p.id, reason: "" })}
                          >
                            Void
                          </Button>
                        )}
                      </div>
                    )}
                    {voiding?.id === p.id && (
                      <form
                        className="flex gap-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          voidPayment.mutate(voiding);
                        }}
                      >
                        <Input
                          autoFocus
                          required
                          minLength={3}
                          placeholder="Reason for voiding"
                          aria-label="Reason for voiding"
                          value={voiding.reason}
                          onChange={(e) => setVoiding({ id: p.id, reason: e.target.value })}
                        />
                        <Button
                          size="sm"
                          type="submit"
                          variant="destructive"
                          disabled={voidPayment.isPending}
                        >
                          Void
                        </Button>
                        <Button
                          size="sm"
                          type="button"
                          variant="ghost"
                          onClick={() => setVoiding(null)}
                        >
                          Cancel
                        </Button>
                      </form>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-semibold">Advances</h2>
        <form
          className="grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            addAdvance.mutate();
          }}
        >
          <div className="space-y-1">
            <Label>Amount (PKR)</Label>
            <Input
              type="number"
              inputMode="decimal"
              required
              min={1}
              step="0.01"
              value={advance.amount}
              onChange={(e) => setAdvance({ ...advance, amount: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Given on</Label>
            <Input
              type="date"
              required
              max={today}
              value={advance.given_on}
              onChange={(e) => setAdvance({ ...advance, given_on: e.target.value })}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Note</Label>
            <Input
              value={advance.note}
              onChange={(e) => setAdvance({ ...advance, note: e.target.value })}
              placeholder="Optional"
            />
          </div>
          <div className="sm:col-span-4">
            <Button type="submit" disabled={addAdvance.isPending}>
              Record advance
            </Button>
            <span className="ml-3 text-xs text-muted-foreground">
              An advance cannot be edited. It is recovered from the next salary and counted as cash
              out under Salary.
            </span>
          </div>
        </form>
        <div className="overflow-x-auto rounded-lg border bg-card shadow-soft">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {advances.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    No advances.
                  </TableCell>
                </TableRow>
              )}
              {advances.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap">{fmtDate(a.given_on)}</TableCell>
                  <TableCell className="font-medium">{pkr(a.amount)}</TableCell>
                  <TableCell className="max-w-56 truncate">{a.note ?? "—"}</TableCell>
                  <TableCell>
                    {isAdmin && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Delete advance"
                        onClick={() =>
                          confirm("Delete this advance? Its Salary expense is removed too.") &&
                          removeAdvance.mutate(a.id)
                        }
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Edit staff member</DialogTitle>
          </DialogHeader>
          {editing && <StaffForm staff={staff} onDone={() => setEditing(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
