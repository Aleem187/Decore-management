import { supabase } from "@/integrations/supabase/client";
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
  events?: { name: string; event_date: string | null; client_phone: string | null } | null;
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

type Color = [number, number, number];
const GOLD: Color = [176, 137, 74];
const INK: Color = [38, 34, 30];
const MUTED: Color = [120, 113, 105];
const GREEN: Color = [46, 125, 80];

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

function header(doc: Doc, title: string, numberLabel: string, issued: string) {
  const W = doc.internal.pageSize.getWidth();
  const M = 48;
  doc
    .setFont("times", "bold")
    .setFontSize(26)
    .setTextColor(...INK)
    .text("Décor Studio", M, 62);
  doc
    .setFont("helvetica", "normal")
    .setFontSize(9)
    .setTextColor(...MUTED)
    .text("Weddings · Events · Luxury Décor", M, 78);
  doc
    .setFont("helvetica", "bold")
    .setFontSize(18)
    .setTextColor(...GOLD)
    .text(title, W - M, 62, { align: "right" });
  doc
    .setFont("helvetica", "normal")
    .setFontSize(9)
    .setTextColor(...MUTED)
    .text(numberLabel, W - M, 78, { align: "right" })
    .text(`Issued: ${fmtDate(issued)}`, W - M, 91, { align: "right" });
  doc
    .setDrawColor(...GOLD)
    .setLineWidth(1.2)
    .line(M, 104, W - M, 104);
}

function parties(doc: Doc, inv: InvoicePdfData, showDue: boolean) {
  const W = doc.internal.pageSize.getWidth();
  const M = 48;
  const col2 = W / 2 + 10;
  const ev = inv.events;
  doc
    .setFontSize(8)
    .setTextColor(...MUTED)
    .setFont("helvetica", "bold");
  doc.text("BILLED TO", M, 128).text("EVENT", col2, 128);
  doc.setFontSize(11).setTextColor(...INK);
  doc.text(inv.client_name, M, 145);
  doc.text(ev?.name ?? "—", col2, 145);
  doc
    .setFont("helvetica", "normal")
    .setFontSize(9.5)
    .setTextColor(...MUTED);
  doc.text(`Phone: ${ev?.client_phone || "—"}`, M, 160);
  doc.text(`Date: ${fmtDate(ev?.event_date)}`, col2, 160);
  doc.text(`Invoice: ${inv.invoice_no} · ${inv.kind}`, M, 174);
  if (showDue) doc.text(`Due: ${fmtDate(inv.due_date)}`, col2, 174);
}

function stamp(doc: Doc, text: string, color: Color, y: number) {
  const W = doc.internal.pageSize.getWidth();
  doc
    .setFont("helvetica", "bold")
    .setFontSize(13)
    .setTextColor(...color)
    .text(text, W - 48, y, { align: "right" });
}

function footers(doc: Doc) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  for (let i = 1; i <= doc.getNumberOfPages(); i++) {
    doc.setPage(i);
    doc
      .setDrawColor(...GOLD)
      .setLineWidth(0.6)
      .line(M, H - 70, W - M, H - 70);
    doc
      .setFont("times", "italic")
      .setFontSize(12)
      .setTextColor(...INK)
      .text("Thank you for choosing Décor Studio!", W / 2, H - 48, { align: "center" });
    doc
      .setFont("helvetica", "normal")
      .setFontSize(8)
      .setTextColor(...MUTED)
      .text("This is a computer-generated document and requires no signature.", W / 2, H - 33, {
        align: "center",
      });
  }
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
    margin: { left: W - 48 - 260, right: 48 },
    body: rows,
    theme: "plain",
    styles: { font: "helvetica", fontSize: 10.5, cellPadding: 7, textColor: INK },
    columnStyles: { 1: { halign: "right", fontStyle: "bold" } },
    didParseCell: (d) => {
      if (d.row.index === rows.length - 1) {
        d.cell.styles.fillColor = balance > 0 ? [250, 236, 226] : [229, 244, 233];
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
  const { doc, autoTable } = ctx;
  const W = doc.internal.pageSize.getWidth();
  const M = 48;
  const total = Number(inv.amount) || 0;
  const live = payments.filter((p) => !p.voided_at);
  const paid = paidTotal(live);
  const balance = remainingBalance(total, live);

  header(doc, "INVOICE", `Invoice no: ${inv.invoice_no}`, inv.created_at);
  parties(doc, inv, true);

  autoTable(doc, {
    startY: 198,
    margin: { left: M, right: M },
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
    headStyles: { fillColor: INK, textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 243, 237] },
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
      margin: { left: M, right: M },
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
      headStyles: { textColor: MUTED, fontStyle: "bold" },
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
  else if (paid > 0) stamp(doc, "PARTIALLY PAID", GOLD, y);
  else stamp(doc, "UNPAID", MUTED, y);

  footers(doc);
  return doc;
}

async function buildReceipt(inv: InvoicePdfData, payment: PaymentPdfRow, all: PaymentPdfRow[]) {
  const ctx = await newDoc();
  const { doc, autoTable } = ctx;
  const M = 48;
  const total = Number(inv.amount) || 0;
  const after = totalsAfterPayment(total, all, payment.id);
  if (!after) throw new Error("This payment has been voided, so no receipt can be issued.");
  const receiptNo = `RCT-${payment.id.slice(0, 8).toUpperCase()}`;

  header(doc, "PAYMENT RECEIPT", `Receipt no: ${receiptNo}`, payment.created_at);
  parties(doc, inv, false);

  autoTable(doc, {
    startY: 198,
    margin: { left: M, right: M },
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
    headStyles: { fillColor: INK, textColor: 255, fontStyle: "bold" },
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
  else stamp(doc, "PARTIALLY PAID", GOLD, y);

  footers(doc);
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
