import { z } from "zod";
import { normalizePkPhone } from "@/lib/phone";
import { paidTotal, type PaymentLike } from "@/lib/payments";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** An optional phone: empty is fine, anything else must be a valid Pakistani number (stored as 92xxxxxxxxxx). */
const phoneField = (label: string) =>
  z.preprocess(
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
            message: `${label} must be a Pakistani number like 0300 1234567 (11 digits starting 03, or +92 followed by 10 digits)`,
          });
        return n;
      }),
  );

const optionalText = (max: number, label: string) =>
  z.preprocess(
    blank,
    z
      .string()
      .trim()
      .max(max, `${label} must be at most ${max} characters`)
      .optional()
      .transform((v) => v ?? null),
  );

export const clientSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(120, "Name must be at most 120 characters"),
  phone: phoneField("Phone"),
  whatsapp: phoneField("WhatsApp"),
  email: z.preprocess(
    blank,
    z
      .string()
      .trim()
      .max(254)
      .email("Enter a valid email address")
      .optional()
      .transform((v) => v ?? null),
  ),
  address: optionalText(500, "Address"),
  notes: optionalText(2000, "Notes"),
});
export type ClientInput = z.infer<typeof clientSchema>;
export type ClientFormValues = Record<keyof ClientInput, string>;

/** Field -> first error message, or null when valid. */
export function validateClient(
  values: ClientFormValues,
): { data: ClientInput } | { errors: Partial<Record<keyof ClientInput, string>> } {
  const r = clientSchema.safeParse(values);
  if (r.success) return { data: r.data };
  const errors: Partial<Record<keyof ClientInput, string>> = {};
  for (const issue of r.error.issues) {
    const k = issue.path[0] as keyof ClientInput;
    if (!errors[k]) errors[k] = issue.message;
  }
  return { errors };
}

export type ClientInvoice = {
  amount: number | string;
  voided_at: string | null;
  payments: (PaymentLike & { amount: number | string })[] | null;
};

const cents = (n: number | string) => Math.round((Number(n) || 0) * 100);

/**
 * A client's money, calculated from their invoices and payments (nothing stored):
 * - invoiced: all non-void invoices
 * - received: non-void payments on those invoices
 * - outstanding: what is still unpaid, per invoice (an invoice can never offset another)
 */
export function clientBalance(invoices: ClientInvoice[]) {
  let invoiced = 0;
  let received = 0;
  let outstanding = 0;
  for (const inv of invoices) {
    if (inv.voided_at) continue;
    const amount = cents(inv.amount);
    const paid = Math.round(paidTotal(inv.payments ?? []) * 100);
    invoiced += amount;
    received += paid;
    outstanding += Math.max(amount - paid, 0);
  }
  return { invoiced: invoiced / 100, received: received / 100, outstanding: outstanding / 100 };
}

/** Make a search term safe inside a PostgREST `or(...)` filter and as an ILIKE pattern. */
export function searchPattern(term: string): string | null {
  const t = term
    .trim()
    .replace(/[,()%*_\\"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t ? `%${t}%` : null;
}

/**
 * Digits to look for when the search box holds a phone number. Numbers are stored as 92xxxxxxxxxx,
 * so a typed "0300 123" must become "92300123". Returns null when the term is not phone-like.
 */
export function phoneSearchDigits(term: string): string | null {
  if (!/^[\d\s+()-]+$/.test(term.trim())) return null;
  let d = term.replace(/\D/g, "");
  if (d.length < 3) return null;
  if (d.startsWith("0092")) d = d.slice(2);
  else if (d.startsWith("0")) d = `92${d.slice(1)}`;
  return d;
}
