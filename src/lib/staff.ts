import { z } from "zod";
import { normalizePkPhone } from "@/lib/phone";

/** 13 digits -> 12345-1234567-1, otherwise null. Mirrors normalize_cnic() in the database. */
export function normalizeCnic(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  return d.length === 13 ? `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}` : null;
}

/** Show only the last digit of a CNIC on printed documents. */
export const maskCnic = (cnic: string | null | undefined) =>
  cnic ? `xxxxx-xxxxxxx-${cnic.slice(-1)}` : "—";

export const JOB_TITLES = [
  "Decorator",
  "Supervisor",
  "Driver",
  "Labor",
  "Electrician",
  "Carpenter",
  "Florist",
  "Helper",
];
export const SALARY_TYPES = [
  { value: "monthly", label: "Monthly salary" },
  { value: "daily_wage", label: "Daily wage" },
] as const;

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const staffSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(120, "Name must be at most 120 characters"),
  job_title: z
    .string()
    .trim()
    .min(1, "Job title is required")
    .max(60, "Job title must be at most 60 characters"),
  phone: z.preprocess(
    blank,
    z
      .string()
      .trim()
      .optional()
      .transform((v, ctx) => {
        if (v === undefined) return null;
        const n = normalizePkPhone(v);
        if (!n)
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Phone must be a Pakistani number like 0300 1234567",
          });
        return n;
      }),
  ),
  cnic: z.preprocess(
    blank,
    z
      .string()
      .trim()
      .optional()
      .transform((v, ctx) => {
        if (v === undefined) return null;
        const n = normalizeCnic(v);
        if (!n)
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "CNIC must have 13 digits, like 35202-1234567-1",
          });
        return n;
      }),
  ),
  salary_type: z.enum(["monthly", "daily_wage"], {
    errorMap: () => ({ message: "Choose monthly or daily wage" }),
  }),
  rate: z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? Number.NaN : Number(v)) : v),
    z
      .number({ invalid_type_error: "Enter the pay rate" })
      .min(0, "Rate cannot be negative")
      .max(100_000_000, "Rate is too large"),
  ),
  joining_date: z.preprocess(
    blank,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date")
      .optional()
      .transform((v) => v ?? null),
  ),
  active: z.boolean(),
  notes: z.preprocess(
    blank,
    z
      .string()
      .trim()
      .max(2000, "Notes must be at most 2000 characters")
      .optional()
      .transform((v) => v ?? null),
  ),
});
export type StaffInput = z.infer<typeof staffSchema>;
export type StaffFormValues = Omit<Record<keyof StaffInput, string>, "active"> & {
  active: boolean;
};

export function validateStaff(
  values: StaffFormValues,
): { data: StaffInput } | { errors: Partial<Record<keyof StaffInput, string>> } {
  const r = staffSchema.safeParse(values);
  if (r.success) return { data: r.data };
  const errors: Partial<Record<keyof StaffInput, string>> = {};
  for (const issue of r.error.issues) {
    const k = issue.path[0] as keyof StaffInput;
    if (!errors[k]) errors[k] = issue.message;
  }
  return { errors };
}

export const payLabel = (type: string, rate: number | string) =>
  `PKR ${Math.round(Number(rate) || 0).toLocaleString("en-US")} / ${type === "daily_wage" ? "day" : "month"}`;
