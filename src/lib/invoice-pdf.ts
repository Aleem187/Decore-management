import { fmtDate, pkr } from "@/lib/format";

export type InvoicePdfData = {
  invoice_no: string;
  client_name: string;
  kind: string;
  amount: number | string;
  amount_paid: number | string;
  due_date: string | null;
  created_at: string;
  events?: { name: string; event_date: string | null; client_phone: string | null } | null;
};

// The database stores one amount per invoice, so the itemised breakdown
// splits it using these standard shares. The last line absorbs rounding.
const ITEM_SHARES: { name: string; share: number }[] = [
  { name: "Stage Decor", share: 0.4 },
  { name: "Lighting", share: 0.2 },
  { name: "Floral Setup", share: 0.25 },
  { name: "Mandap", share: 0.15 },
];

const GOLD: [number, number, number] = [176, 137, 74];
const INK: [number, number, number] = [38, 34, 30];
const MUTED: [number, number, number] = [120, 113, 105];

function lineItems(total: number) {
  let used = 0;
  return ITEM_SHARES.map((it, i) => {
    const value = i === ITEM_SHARES.length - 1 ? total - used : Math.round(total * it.share);
    used += value;
    return { name: it.name, value };
  });
}

async function build(inv: InvoicePdfData, mode: "invoice" | "receipt") {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;

  const total = Number(inv.amount) || 0;
  const paid = Number(inv.amount_paid) || 0;
  const balance = Math.max(total - paid, 0);
  const isReceipt = mode === "receipt";

  // Header
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
    .text(isReceipt ? "PAYMENT RECEIPT" : "INVOICE", W - M, 62, { align: "right" });
  doc
    .setFont("helvetica", "normal")
    .setFontSize(9)
    .setTextColor(...MUTED)
    .text(`${isReceipt ? "Receipt" : "Invoice"} no: ${inv.invoice_no}`, W - M, 78, {
      align: "right",
    })
    .text(`Issued: ${fmtDate(isReceipt ? new Date().toISOString() : inv.created_at)}`, W - M, 91, {
      align: "right",
    });
  doc
    .setDrawColor(...GOLD)
    .setLineWidth(1.2)
    .line(M, 104, W - M, 104);

  // Client & event details
  const ev = inv.events;
  const col2 = W / 2 + 10;
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
  doc.text(`Type: ${inv.kind}`, M, 174);
  if (!isReceipt) doc.text(`Due: ${fmtDate(inv.due_date)}`, col2, 174);

  // Itemised charges
  autoTable(doc, {
    startY: 198,
    margin: { left: M, right: M },
    head: [["#", "Decoration charges", "Amount"]],
    body: lineItems(total).map((it, i) => [String(i + 1), it.name, pkr(it.value)]),
    theme: "striped",
    styles: { font: "helvetica", fontSize: 10, cellPadding: 8, textColor: INK },
    headStyles: { fillColor: INK, textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 243, 237] },
    columnStyles: { 0: { cellWidth: 30 }, 2: { halign: "right", cellWidth: 130 } },
  });

  // Financial summary
  const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;
  autoTable(doc, {
    startY: y,
    margin: { left: W - M - 260, right: M },
    body: [
      ["Total Amount", pkr(total)],
      [isReceipt ? "Amount Received" : "Advance Paid", pkr(paid)],
      ["Remaining Balance Due", pkr(balance)],
    ],
    theme: "plain",
    styles: { font: "helvetica", fontSize: 10.5, cellPadding: 7, textColor: INK },
    columnStyles: { 1: { halign: "right", fontStyle: "bold" } },
    didParseCell: (d) => {
      if (d.row.index === 2) {
        d.cell.styles.fillColor = balance > 0 ? [250, 236, 226] : [229, 244, 233];
        d.cell.styles.fontStyle = "bold";
      }
    },
  });

  if (isReceipt) {
    const fy = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 28;
    doc
      .setFont("helvetica", "bold")
      .setFontSize(11)
      .setTextColor(...(balance > 0 ? GOLD : ([46, 125, 80] as [number, number, number])))
      .text(balance > 0 ? "PARTIALLY PAID" : "PAID IN FULL", W - M, fy, { align: "right" });
  }

  // Footer
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

  return doc;
}

export async function downloadInvoicePdf(inv: InvoicePdfData, mode: "invoice" | "receipt") {
  const doc = await build(inv, mode);
  doc.save(`${mode === "receipt" ? "Receipt" : "Invoice"}-${inv.invoice_no}.pdf`);
}
