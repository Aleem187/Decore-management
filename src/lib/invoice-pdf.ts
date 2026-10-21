import { supabase } from "@/integrations/supabase/client";
import {
  BLACK,
  CREAM,
  GOLD_DARK,
  GOLD_LIGHT,
  GREEN,
  INK,
  MUTED,
  BAND_H,
  brandFooters,
  brandHeader,
  categoryStrip,
  loadLogo,
  type Color,
} from "@/lib/pdf-brand";
import { fmtDate, pkr } from "@/lib/format";
import { resolveLines, type InvoiceItemRow } from "@/lib/invoice-lines";
import {
  METHOD_LABEL,
  paidTotal,
  remainingBalance,
  totalsAfterPayment,
  type PaymentMethod,
} from "@/lib/payments";

export type InvoicePdfData = {
  id: string;
  invoice_no: string;
  client_name: string;
  kind: string;
  amount: number | string;
  due_date: string | null;
  created_at: string;
  events?: {
    name: string;
    event_date: string | null;
    event_type?: string | null;
    client_phone: string | null;
    hotels?: { name: string } | null;
  } | null;
};

export type PaymentPdfRow = {
  id: string;
  amount: number;
  method: string;
  reference_no: string | null;
  paid_at: string;
  note: string | null;
  created_at: string;
  voided_at: string | null;
};

const methodLabel = (m: string) => METHOD_LABEL[m as PaymentMethod] ?? m;

async function newDoc() {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  return { doc: new jsPDF({ unit: "pt", format: "a4" }), autoTable };
}

type Doc = Awaited<ReturnType<typeof newDoc>>["doc"];
const finalY = (doc: Doc) =>
  (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

function header(doc: Doc, logo: string | null, title: string, numberLabel: string, issued: string) {
  brandHeader(doc, logo, title, [numberLabel, `Issued: ${fmtDate(issued)}`]);
}

const PARTIES_Y = BAND_H + 24;
const TABLE_Y = PARTIES_Y + 124;

function parties(doc: Doc, inv: InvoicePdfData, showDue: boolean) {
  const W = doc.internal.pageSize.getWidth();
  const M = 48;
  const col2 = W / 2 + 10;
  const ev = inv.events;
  categoryStrip(doc, PARTIES_Y, ev?.event_type);
  const y = PARTIES_Y + 44;
  doc
    .setFontSize(8)
    .setTextColor(...GOLD_DARK)
    .setFont("helvetica", "bold");
  doc.text("BILLED TO", M, y).text("EVENT DETAILS", col2, y);
  doc.setFontSize(11.5).setTextColor(...INK);
  doc.text(inv.client_name, M, y + 17);
  doc.text(ev?.name ?? "—", col2, y + 17);
  doc
    .setFont("helvetica", "normal")
    .setFontSize(9.5)
    .setTextColor(...MUTED);
  doc.text(`Phone: ${ev?.client_phone || "—"}`, M, y + 32);
  doc.text(`Category: ${ev?.event_type || "—"}`, col2, y + 32);
  doc.text(`Invoice: ${inv.invoice_no} · ${inv.kind}`, M, y + 46);
  doc.text(`Event date: ${fmtDate(ev?.event_date)}`, col2, y + 46);
  doc.text(
    showDue ? `Due date: ${fmtDate(inv.due_date)}` : `Invoice date: ${fmtDate(inv.created_at)}`,
    M,
    y + 60,
  );
  doc.text(`Venue: ${ev?.hotels?.name || "—"}`, col2, y + 60);
}

function stamp(doc: Doc, text: string, color: Color, y: number) {
  const W = doc.internal.pageSize.getWidth();
  doc
    .setFont("helvetica", "bold")
    .setFontSize(13)
    .setTextColor(...color)
    .text(text, W - 48, y, { align: "right" });
}

type AutoTable = Awaited<ReturnType<typeof newDoc>>["autoTable"];

function summaryTable(
  doc: Doc,
  autoTable: AutoTable,
  startY: number,
  rows: [string, string][],
  balance: number,
) {
  const W = doc.internal.pageSize.getWidth();
  autoTable(doc, {
    startY,
    margin: { left: W - 48 - 260, right: 48, bottom: 90 },
    body: rows,
    theme: "plain",
    styles: { font: "helvetica", fontSize: 10.5, cellPadding: 7, textColor: INK },
    columnStyles: { 1: { halign: "right", fontStyle: "bold" } },
    didParseCell: (d) => {
      if (d.row.index === rows.length - 1) {
        d.cell.styles.fillColor = balance > 0 ? [250, 240, 205] : [229, 244, 233];
        d.cell.styles.fontStyle = "bold";
      }
    },
  });
}

async function buildInvoice(
  inv: InvoicePdfData,
  items: InvoiceItemRow[],
  payments: PaymentPdfRow[],
) {
  const ctx = await newDoc();
  const logo = await loadLogo();
  const { doc, autoTable } = ctx;
  const M = 48;
  const total = Number(inv.amount) || 0;
  const live = payments.filter((p) => !p.voided_at);
  const paid = paidTotal(live);
  const balance = remainingBalance(total, live);

  header(doc, logo, "INVOICE", `Invoice no: ${inv.invoice_no}`, inv.created_at);
  parties(doc, inv, true);

  autoTable(doc, {
    startY: TABLE_Y,
    margin: { left: M, right: M, bottom: 90 },
    head: [["#", "Description", "Qty", "Unit price", "Amount"]],
    body: resolveLines(total, items).map((l, i) => [
      String(i + 1),
      l.description,
      String(l.quantity),
      pkr(l.unitPrice),
      pkr(l.amount),
    ]),
    theme: "striped",
    styles: { font: "helvetica", fontSize: 10, cellPadding: 8, textColor: INK },
    headStyles: { fillColor: BLACK, textColor: GOLD_LIGHT, fontStyle: "bold" },
    alternateRowStyles: { fillColor: CREAM },
    columnStyles: {
      0: { cellWidth: 30 },
      2: { halign: "right", cellWidth: 50 },
      3: { halign: "right", cellWidth: 95 },
      4: { halign: "right", cellWidth: 100 },
    },
  });

  if (live.length > 0) {
    autoTable(doc, {
      startY: finalY(doc) + 18,
      margin: { left: M, right: M, bottom: 90 },
      head: [["Payments received", "Method", "Reference", "Amount"]],
      body: [...live]
        .sort(
          (a, b) => a.paid_at.localeCompare(b.paid_at) || a.created_at.localeCompare(b.created_at),
        )
        .map((p) => [
          fmtDate(p.paid_at),
          methodLabel(p.method),
          p.reference_no ?? "—",
          pkr(p.amount),
        ]),
      theme: "plain",
      styles: { font: "helvetica", fontSize: 9.5, cellPadding: 5, textColor: INK },
      headStyles: { textColor: GOLD_DARK, fontStyle: "bold" },
      columnStyles: { 3: { halign: "right", cellWidth: 100 } },
    });
  }

  summaryTable(
    doc,
    autoTable,
    finalY(doc) + 20,
    [
      ["Total Amount", pkr(total)],
      ["Payments Received", pkr(paid)],
      ["Remaining Balance Due", pkr(balance)],
    ],
    balance,
  );

  const y = finalY(doc) + 28;
  if (balance === 0 && total > 0) stamp(doc, "PAID IN FULL", GREEN, y);
  else if (paid > 0) stamp(doc, "PARTIALLY PAID", GOLD_DARK, y);
  else stamp(doc, "UNPAID", MUTED, y);

  brandFooters(doc, "Thank you for choosing Sarim Events Planner — Make Your Moments Special!");
  return doc;
}

async function buildReceipt(inv: InvoicePdfData, payment: PaymentPdfRow, all: PaymentPdfRow[]) {
  const ctx = await newDoc();
  const logo = await loadLogo();
  const { doc, autoTable } = ctx;
  const M = 48;
  const total = Number(inv.amount) || 0;
  const after = totalsAfterPayment(total, all, payment.id);
  if (!after) throw new Error("This payment has been voided, so no receipt can be issued.");
  const receiptNo = `RCT-${payment.id.slice(0, 8).toUpperCase()}`;

  header(doc, logo, "PAYMENT RECEIPT", `Receipt no: ${receiptNo}`, payment.created_at);
  parties(doc, inv, false);

  autoTable(doc, {
    startY: TABLE_Y,
    margin: { left: M, right: M, bottom: 90 },
    head: [["Payment date", "Method", "Reference", "Amount received"]],
    body: [
      [
        fmtDate(payment.paid_at),
        methodLabel(payment.method),
        payment.reference_no ?? "—",
        pkr(payment.amount),
      ],
    ],
    theme: "striped",
    styles: { font: "helvetica", fontSize: 10.5, cellPadding: 9, textColor: INK },
    headStyles: { fillColor: BLACK, textColor: GOLD_LIGHT, fontStyle: "bold" },
    columnStyles: { 3: { halign: "right", fontStyle: "bold", cellWidth: 130 } },
  });
  if (payment.note) {
    doc
      .setFont("helvetica", "italic")
      .setFontSize(9.5)
      .setTextColor(...MUTED)
      .text(`Note: ${payment.note}`, M, finalY(doc) + 18);
  }

  summaryTable(
    doc,
    autoTable,
    finalY(doc) + (payment.note ? 32 : 20),
    [
      ["Invoice Total", pkr(total)],
      ["Paid To Date (incl. this payment)", pkr(after.paidToDate)],
      ["Balance After This Payment", pkr(after.balanceAfter)],
    ],
    after.balanceAfter,
  );
  const y = finalY(doc) + 28;
  if (after.balanceAfter === 0) stamp(doc, "PAID IN FULL", GREEN, y);
  else stamp(doc, "PARTIALLY PAID", GOLD_DARK, y);

  brandFooters(doc, "Thank you for choosing Sarim Events Planner — Make Your Moments Special!");
  return { doc, receiptNo };
}

async function loadPayments(invoiceId: string): Promise<PaymentPdfRow[]> {
  const { data, error } = await supabase
    .from("payments")
    .select("id, amount, method, reference_no, paid_at, note, created_at, voided_at")
    .eq("invoice_id", invoiceId)
    .order("paid_at")
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((p) => ({ ...p, amount: Number(p.amount) }));
}

/** Invoice PDF: items from invoice_items, stamp and payment list from the payments table. */
export async function downloadInvoicePdf(inv: InvoicePdfData) {
  const [items, payments] = await Promise.all([
    supabase
      .from("invoice_items")
      .select("description, quantity, unit_price")
      .eq("invoice_id", inv.id)
      .is("deleted_at", null)
      .order("created_at"),
    loadPayments(inv.id),
  ]);
  if (items.error) throw items.error;
  const doc = await buildInvoice(inv, items.data ?? [], payments);
  doc.save(`Invoice-${inv.invoice_no}.pdf`);
}

/** One receipt per payment. Voided payments cannot be receipted. */
export async function downloadReceiptPdf(inv: InvoicePdfData, paymentId: string) {
  const all = await loadPayments(inv.id);
  const payment = all.find((p) => p.id === paymentId);
  if (!payment) throw new Error("Payment not found");
  const { doc, receiptNo } = await buildReceipt(inv, payment, all);
  doc.save(`${receiptNo}-${inv.invoice_no}.pdf`);
}
