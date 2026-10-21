import type { jsPDF } from "jspdf";
import { BRAND_LOGO, BRAND_NAME, BRAND_TAGLINE, EVENT_CATEGORIES } from "@/lib/brand";

export type Color = [number, number, number];
export const GOLD: Color = [212, 175, 55];
export const GOLD_LIGHT: Color = [255, 215, 0];
export const GOLD_DARK: Color = [150, 112, 20];
export const BLACK: Color = [11, 11, 11];
export const INK: Color = [38, 34, 30];
export const MUTED: Color = [110, 104, 96];
export const GREEN: Color = [46, 125, 80];
export const CREAM: Color = [250, 246, 232];

export const BAND_H = 112;
const M = 48;

let logoCache: Promise<string | null> | null = null;
/** Logo as a data URL for embedding; null if it cannot be loaded (the PDF then falls back to text only). */
export function loadLogo(): Promise<string | null> {
  logoCache ??= fetch(BRAND_LOGO)
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("logo"))))
    .then(
      (b) =>
        new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(fr.error);
          fr.readAsDataURL(b);
        }),
    )
    .catch(() => null);
  return logoCache;
}

/** Black band with logo, brand name, tagline, document title and number, closed by a gold rule. */
export function brandHeader(doc: jsPDF, logo: string | null, title: string, lines: string[]) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(...BLACK).rect(0, 0, W, BAND_H, "F");
  doc.setFillColor(...GOLD).rect(0, BAND_H, W, 3, "F");
  let x = M;
  if (logo) {
    doc.addImage(logo, "PNG", M - 6, 14, 84, 84);
    x = M + 88;
  }
  doc
    .setFont("times", "bold")
    .setFontSize(23)
    .setTextColor(...GOLD_LIGHT)
    .text(BRAND_NAME.toUpperCase(), x, 55);
  doc
    .setFont("times", "italic")
    .setFontSize(11.5)
    .setTextColor(...GOLD)
    .text(BRAND_TAGLINE, x, 73);
  doc
    .setFont("helvetica", "bold")
    .setFontSize(17)
    .setTextColor(...GOLD_LIGHT)
    .text(title, W - M, 40, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(235, 230, 215);
  lines.forEach((l, i) => doc.text(l, W - M, 57 + i * 13, { align: "right" }));
}

/** Thin gold-bordered strip listing the event categories the company handles. */
export function categoryStrip(doc: jsPDF, y: number, active?: string | null) {
  const W = doc.internal.pageSize.getWidth();
  doc
    .setFillColor(...CREAM)
    .setDrawColor(...GOLD)
    .setLineWidth(0.6);
  doc.roundedRect(M, y, W - 2 * M, 22, 3, 3, "FD");
  const cell = (W - 2 * M) / EVENT_CATEGORIES.length;
  const match = (c: string) =>
    !!active &&
    c.toLowerCase().replace(/s$/, "").split(" ")[0] ===
      active.toLowerCase().replace(/s$/, "").split(" ")[0];
  doc.setFontSize(8.5);
  EVENT_CATEGORIES.forEach((c, i) => {
    const on = match(c);
    doc.setFont("helvetica", on ? "bold" : "normal").setTextColor(...(on ? BLACK : GOLD_DARK));
    doc.text(c.toUpperCase(), M + cell * i + cell / 2, y + 14, { align: "center" });
  });
}

export function brandFooters(doc: jsPDF, thanks: string) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= doc.getNumberOfPages(); i++) {
    doc.setPage(i);
    doc.setFillColor(...BLACK).rect(0, H - 74, W, 74, "F");
    doc.setFillColor(...GOLD).rect(0, H - 74, W, 2, "F");
    doc
      .setFont("times", "italic")
      .setFontSize(12.5)
      .setTextColor(...GOLD_LIGHT)
      .text(thanks, W / 2, H - 48, { align: "center" });
    doc
      .setFont("helvetica", "normal")
      .setFontSize(8)
      .setTextColor(190, 184, 168)
      .text(
        `${BRAND_NAME} · ${BRAND_TAGLINE} · This is a computer-generated document and requires no signature.`,
        W / 2,
        H - 30,
        { align: "center" },
      );
  }
}
