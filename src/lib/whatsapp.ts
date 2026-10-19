import { fmtDate, pkr } from "@/lib/format";

const DEFAULT_COUNTRY_CODE = "92"; // Pakistan

/**
 * Turns a free-form phone number into the digits-only international format
 * wa.me expects. Returns null if it doesn't look like a usable number.
 * "0300-1234567" -> "923001234567", "+92 300 1234567" -> "923001234567".
 */
export function sanitizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = DEFAULT_COUNTRY_CODE + digits.slice(1);
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

export type WhatsAppUpdate = {
  clientName: string;
  eventName: string | null | undefined;
  eventDate: string | null | undefined;
  total: number | string;
  paid: number | string;
  phone: string | null | undefined;
};

export function whatsappUrl(u: WhatsAppUpdate): string {
  const total = Number(u.total) || 0;
  const paid = Number(u.paid) || 0;
  const event = u.eventName
    ? `your event ${u.eventName}${u.eventDate ? ` on ${fmtDate(u.eventDate)}` : ""}`
    : "your booking";
  const text =
    `Hello ${u.clientName}, here is an update regarding ${event}. ` +
    `Total Amount: ${pkr(total)}, Paid: ${pkr(paid)}, Remaining Balance: ${pkr(Math.max(total - paid, 0))}. ` +
    `Thank you for choosing Décor Studio!`;
  const phone = sanitizePhone(u.phone);
  return `https://wa.me/${phone ?? ""}?text=${encodeURIComponent(text)}`;
}

export function openWhatsApp(u: WhatsAppUpdate) {
  window.open(whatsappUrl(u), "_blank", "noopener,noreferrer");
}
