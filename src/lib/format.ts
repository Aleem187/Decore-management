export const pkr = (n: number | string | null | undefined) =>
  "PKR " + Math.round(Number(n ?? 0) || 0).toLocaleString("en-US");

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
