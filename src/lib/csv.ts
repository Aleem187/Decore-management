export type CsvCell = string | number | boolean | null | undefined;

// Cells starting with these characters can run as formulas in Excel/Sheets.
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(v: CsvCell): string {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = v == null ? "" : String(v);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * CSV text: every cell quoted, quotes doubled, CRLF between rows. Text cells that start with = + - @ (or a tab/CR)
 * get a leading single quote so a spreadsheet cannot run them as a formula. Real numbers are written as-is,
 * so negative amounts stay numeric.
 */
export function buildCsv(headers: string[], rows: CsvCell[][]): string {
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

/** Downloads a UTF-8 CSV (with BOM so Excel shows Décor, Rs etc. correctly). */
export function downloadCsv(filename: string, headers: string[], rows: CsvCell[][]) {
  const blob = new Blob(["\ufeff", buildCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const stamp = () => new Date().toISOString().slice(0, 10);
