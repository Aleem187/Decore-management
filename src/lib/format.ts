export const pkr = (n: number | string | null | undefined) =>
  "PKR " + Math.round(Number(n ?? 0) || 0).toLocaleString("en-US");

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/** Short axis label: 0, 500, 1.5k, 250k, 2.4M. */
export const compactNumber = (n: number) => {
  const v = Math.abs(n);
  const trim = (x: number) => String(Math.round(x * 10) / 10);
  const sign = n < 0 ? "-" : "";
  if (v >= 1_000_000) return `${sign}${trim(v / 1_000_000)}M`;
  if (v >= 1_000) return `${sign}${trim(v / 1_000)}k`;
  return `${sign}${Math.round(v)}`;
};
