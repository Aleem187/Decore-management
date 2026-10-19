import { fmtDate, pkr } from "@/lib/format";
import { METHOD_LABEL, type PaymentMethod } from "@/lib/payments";
import type { SalaryResult } from "@/lib/salary";
import { maskCnic } from "@/lib/staff";

export type SlipStaff = {
  name: string;
  job_title: string;
  cnic: string | null;
  salary_type: string;
  rate: number | string;
  joining_date: string | null;
};
export type SlipPayment = {
  method: string;
  reference_no: string | null;
  paid_on: string;
  voided_at: string | null;
};

type Color = [number, number, number];
const GOLD: Color = [176, 137, 74];
const INK: Color = [38, 34, 30];
const MUTED: Color = [120, 113, 105];
const GREEN: Color = [46, 125, 80];

const monthName = (month: string) =>
  new Date(`${month.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const days = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Salary slip for one person and month. Pass the saved payment to print a paid slip (figures come from the
 * payout as it was recorded); without one the slip is marked as a draft.
 */
export async function downloadSalarySlip(input: {
  staff: SlipStaff;
  month: string;
  result: SalaryResult;
  payment?: SlipPayment | null;
}) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const { staff, month, result: r, payment } = input;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  const paid = !!payment && !payment.voided_at;
  const finalY = () =>
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

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
    .text("SALARY SLIP", W - M, 62, { align: "right" });
  doc
    .setFont("helvetica", "normal")
    .setFontSize(10)
    .setTextColor(...MUTED)
    .text(monthName(month), W - M, 80, { align: "right" });
  doc
    .setDrawColor(...GOLD)
    .setLineWidth(1.2)
    .line(M, 104, W - M, 104);

  const col2 = W / 2 + 10;
  doc
    .setFontSize(8)
    .setTextColor(...MUTED)
    .setFont("helvetica", "bold");
  doc.text("EMPLOYEE", M, 128).text("PAY BASIS", col2, 128);
  doc.setFontSize(11).setTextColor(...INK);
  doc.text(staff.name, M, 145);
  doc.text(
    `${pkr(staff.rate)} / ${staff.salary_type === "daily_wage" ? "day" : "month"}`,
    col2,
    145,
  );
  doc
    .setFont("helvetica", "normal")
    .setFontSize(9.5)
    .setTextColor(...MUTED);
  doc.text(staff.job_title, M, 160);
  doc.text(`CNIC: ${maskCnic(staff.cnic)}`, M, 174);
  doc.text(`Joined: ${staff.joining_date ? fmtDate(staff.joining_date) : "—"}`, col2, 160);

  autoTable(doc, {
    startY: 198,
    margin: { left: M, right: M },
    head: [["Attendance", "Days"]],
    body: [
      ["Present", days(r.present)],
      ["Half days", days(r.halfDays)],
      ["Absent", days(r.absent)],
      ["Leave (unpaid)", days(r.leave)],
      ["Days worked (half day = 0.5)", days(r.daysWorked)],
    ],
    theme: "striped",
    styles: { font: "helvetica", fontSize: 10, cellPadding: 6, textColor: INK },
    headStyles: { fillColor: INK, textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 243, 237] },
    columnStyles: { 1: { halign: "right", cellWidth: 90 } },
  });

  const lines: [string, string][] = [
    [
      r.salaryType === "daily_wage"
        ? `Wages (${days(r.daysWorked)} days × ${pkr(r.rate)})`
        : `Salary for the month${r.unpaidDays + r.preJoinDays > 0 ? ` (less ${days(r.unpaidDays + r.preJoinDays)} unpaid days)` : ""}`,
      pkr(r.gross),
    ],
    ["Bonus", pkr(r.bonus)],
    ["Advance recovered", `− ${pkr(r.advanceDeducted)}`],
    ["NET PAY", pkr(r.net)],
  ];
  autoTable(doc, {
    startY: finalY() + 18,
    margin: { left: M, right: M },
    head: [["Pay", "Amount"]],
    body: lines,
    theme: "plain",
    styles: { font: "helvetica", fontSize: 10.5, cellPadding: 7, textColor: INK },
    headStyles: { textColor: MUTED, fontStyle: "bold" },
    columnStyles: { 1: { halign: "right", fontStyle: "bold", cellWidth: 150 } },
    didParseCell: (d) => {
      if (d.row.index === lines.length - 1 && d.section === "body") {
        d.cell.styles.fillColor = [229, 244, 233];
        d.cell.styles.fontStyle = "bold";
      }
    },
  });

  let y = finalY() + 22;
  if (r.advanceCarriedForward > 0) {
    doc
      .setFont("helvetica", "normal")
      .setFontSize(9.5)
      .setTextColor(...MUTED)
      .text(`Advance balance carried forward: ${pkr(r.advanceCarriedForward)}`, M, y);
    y += 16;
  }
  if (paid && payment) {
    const how = `${METHOD_LABEL[payment.method as PaymentMethod] ?? payment.method}${payment.reference_no ? ` · ref ${payment.reference_no}` : ""}`;
    doc
      .setFont("helvetica", "bold")
      .setFontSize(12)
      .setTextColor(...GREEN)
      .text("PAID", M, y + 6);
    doc
      .setFont("helvetica", "normal")
      .setFontSize(9.5)
      .setTextColor(...MUTED)
      .text(`${fmtDate(payment.paid_on)} · ${how}`, M + 40, y + 6);
  } else {
    doc
      .setFont("helvetica", "bold")
      .setFontSize(12)
      .setTextColor(...GOLD)
      .text("DRAFT — NOT PAID YET", M, y + 6);
  }

  const sy = Math.max(y + 70, H - 150);
  doc.setDrawColor(...MUTED).setLineWidth(0.6);
  doc.line(M, sy, M + 170, sy).line(W - M - 170, sy, W - M, sy);
  doc
    .setFont("helvetica", "normal")
    .setFontSize(8.5)
    .setTextColor(...MUTED);
  doc.text("Employee signature", M, sy + 13).text("Accounts", W - M - 170, sy + 13);

  doc
    .setDrawColor(...GOLD)
    .setLineWidth(0.6)
    .line(M, H - 70, W - M, H - 70);
  doc
    .setFont("times", "italic")
    .setFontSize(12)
    .setTextColor(...INK)
    .text("Thank you for your work with Décor Studio!", W / 2, H - 48, { align: "center" });
  doc
    .setFont("helvetica", "normal")
    .setFontSize(8)
    .setTextColor(...MUTED)
    .text("This is a computer-generated document.", W / 2, H - 33, { align: "center" });

  doc.save(`Salary-${staff.name.replace(/[^\w]+/g, "_")}-${month.slice(0, 7)}.pdf`);
}
