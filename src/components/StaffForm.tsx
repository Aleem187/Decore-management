import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  JOB_TITLES,
  SALARY_TYPES,
  normalizeCnic,
  validateStaff,
  type StaffFormValues,
} from "@/lib/staff";
import { formatPkPhone, normalizePkPhone } from "@/lib/phone";
import type { StaffMember } from "@/hooks/use-staff-members";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const toForm = (s?: StaffMember | null): StaffFormValues => ({
  name: s?.name ?? "",
  job_title: s?.job_title ?? "Decorator",
  phone: s?.phone ?? "",
  cnic: s?.cnic ?? "",
  salary_type: s?.salary_type ?? "daily_wage",
  rate: s ? String(s.rate) : "",
  joining_date: s?.joining_date ?? "",
  active: s?.active ?? true,
  notes: s?.notes ?? "",
});

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Admin: add or edit a staff member. Phone and CNIC are cleaned before saving. */
export function StaffForm({ staff, onDone }: { staff?: StaffMember | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState<StaffFormValues>(() => toForm(staff));
  const [errors, setErrors] = useState<Partial<Record<keyof StaffFormValues, string>>>({});
  const set =
    (k: keyof StaffFormValues) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setV({ ...v, [k]: e.target.value });

  const save = useMutation({
    mutationFn: async () => {
      const result = validateStaff(v);
      if ("errors" in result) {
        setErrors(result.errors);
        throw new Error("Please fix the highlighted fields");
      }
      setErrors({});
      if (staff) {
        const { error } = await supabase.from("staff").update(result.data).eq("id", staff.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("staff").insert(result.data);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      toast.success(staff ? "Staff member updated" : "Staff member added");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const phone = normalizePkPhone(v.phone);
  const cnic = normalizeCnic(v.cnic);
  const select = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

  return (
    <form
      className="grid gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label="Name *" error={errors.name}>
        <Input value={v.name} onChange={set("name")} maxLength={120} autoFocus />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Job title *" error={errors.job_title}>
          <Input list="job-titles" value={v.job_title} onChange={set("job_title")} maxLength={60} />
          <datalist id="job-titles">
            {JOB_TITLES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
        <Field
          label="Phone"
          error={errors.phone}
          hint={
            v.phone.trim() && phone
              ? `Will be saved as ${formatPkPhone(phone)}`
              : "e.g. 0300 1234567"
          }
        >
          <Input inputMode="tel" value={v.phone} onChange={set("phone")} />
        </Field>
        <Field
          label="CNIC"
          error={errors.cnic}
          hint={
            v.cnic.trim() && cnic ? `Will be saved as ${cnic}` : "13 digits, e.g. 35202-1234567-1"
          }
        >
          <Input inputMode="numeric" value={v.cnic} onChange={set("cnic")} />
        </Field>
        <Field label="Joining date" error={errors.joining_date}>
          <Input type="date" value={v.joining_date} onChange={set("joining_date")} />
        </Field>
        <Field label="Pay type *" error={errors.salary_type}>
          <select className={select} value={v.salary_type} onChange={set("salary_type")}>
            {SALARY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={v.salary_type === "monthly" ? "Monthly salary (PKR) *" : "Daily rate (PKR) *"}
          error={errors.rate}
        >
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={v.rate}
            onChange={set("rate")}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={v.active}
          onChange={(e) => setV({ ...v, active: e.target.checked })}
        />
        Active (can be assigned to events and marked present)
      </label>
      <Field label="Notes" error={errors.notes}>
        <Textarea rows={3} value={v.notes} onChange={set("notes")} maxLength={2000} />
      </Field>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {staff ? "Save changes" : "Add staff member"}
        </Button>
      </div>
    </form>
  );
}
