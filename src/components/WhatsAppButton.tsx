import { Button } from "@/components/ui/button";
import { openWhatsApp, sanitizePhone, type WhatsAppUpdate } from "@/lib/whatsapp";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12.04 2a9.9 9.9 0 0 0-8.47 15.05L2 22l5.1-1.34A9.93 9.93 0 1 0 12.04 2Zm0 18.1a8.1 8.1 0 0 1-4.13-1.13l-.3-.18-3.03.8.81-2.95-.19-.31a8.1 8.1 0 1 1 6.84 3.77Zm4.45-6.07c-.24-.12-1.44-.71-1.66-.79-.22-.08-.39-.12-.55.12-.16.24-.63.79-.77.95-.14.16-.28.18-.52.06a6.6 6.6 0 0 1-1.95-1.2 7.3 7.3 0 0 1-1.35-1.69c-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.55-1.32-.75-1.8-.2-.47-.4-.41-.55-.42h-.47c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.12 3.64.58.25 1.03.4 1.38.51.58.18 1.1.16 1.52.1.46-.07 1.44-.59 1.64-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.46-.28Z" />
    </svg>
  );
}

export function WhatsAppButton({
  update,
  label = "Send WhatsApp Update",
}: {
  update: WhatsAppUpdate;
  label?: string;
}) {
  const hasPhone = sanitizePhone(update.phone) !== null;
  return (
    <Button
      size="sm"
      variant="outline"
      className="text-[#128C7E] hover:text-[#128C7E]"
      title={hasPhone ? label : "No valid phone number saved — you'll pick the contact in WhatsApp"}
      aria-label={label}
      onClick={() => openWhatsApp(update)}
    >
      <WhatsAppIcon className="h-4 w-4" />
      <span className="hidden xl:inline">WhatsApp</span>
    </Button>
  );
}
