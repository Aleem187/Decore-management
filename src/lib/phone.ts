/**
 * Pakistani phone numbers in the stored format 92xxxxxxxxxx (92 + 10 digits).
 * Mirrors public.normalize_pk_phone in the database; keep the two in sync.
 *
 *   0300-1234567, 0300 1234567, (0300) 123 4567 -> 923001234567
 *   +92 300 1234567, 92 300 1234567              -> 923001234567
 *   0092 300 1234567                             -> 923001234567
 *   +92 (0)300 1234567                           -> 923001234567
 *   300 1234567                                  -> 923001234567
 * Returns null when the input is empty or not a valid number.
 */
export function normalizePkPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("0092")) d = d.slice(2);
  if (/^92\d{10}$/.test(d)) return d;
  if (/^920\d{10}$/.test(d)) return `92${d.slice(3)}`;
  if (/^0\d{10}$/.test(d)) return `92${d.slice(1)}`;
  if (/^3\d{9}$/.test(d)) return `92${d}`;
  return null;
}

/** 923001234567 -> "+92 300 1234567" for display. */
export function formatPkPhone(stored: string | null | undefined): string {
  if (!stored || !/^92\d{10}$/.test(stored)) return stored ?? "";
  return `+92 ${stored.slice(2, 5)} ${stored.slice(5)}`;
}
