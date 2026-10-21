import { useState } from "react";
import { requireRole } from "@/lib/auth";
import { createFileRoute } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import { CrudPage } from "@/components/CrudPage";
import { VendorLedger } from "@/components/VendorLedger";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { pkr } from "@/lib/format";
import { vendorTotals, type LedgerExpense, type LedgerPayment } from "@/lib/vendor-ledger";

export const Route = createFileRoute("/_authenticated/vendors")({
  head: () => ({ meta: [{ title: "Vendors — Sarim Events Planner" }, { name: "description", content: "Supplier ledgers." }, { property: "og:title", content: "Vendors — Sarim Events Planner" }, { property: "og:description", content: "Supplier ledgers." }] }),
  beforeLoad: ({ context }) => requireRole(context.queryClient, ["admin", "accountant"]),
  component: VendorsPage,
});

type VendorRow = {
  id: string;
  name: string;
  category: string | null;
  phone: string | null;
  expenses?: LedgerExpense[];
  vendor_payments?: LedgerPayment[];
};

function VendorsPage() {
  const [open, setOpen] = useState<VendorRow | null>(null);
  return (
    <>
      <CrudPage table="vendors" title="Vendors" subtitle="Supplier ledgers — bills, payments and pending balance" orderBy="created_at"
        select="*, expenses(amount, paid), vendor_payments(amount)" canWrite
        columns={[
          { key: "name", label: "Vendor", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "category", label: "Category" },
          { key: "phone", label: "Phone" },
          { key: "payable", label: "Total payable", render: (r) => pkr(vendorTotals(r.expenses, r.vendor_payments).payable) },
          { key: "paid", label: "Total paid", render: (r) => pkr(vendorTotals(r.expenses, r.vendor_payments).paid) },
          { key: "due", label: "Pending", render: (r) => {
            const d = vendorTotals(r.expenses, r.vendor_payments).pending;
            return <span className={d > 0 ? "text-destructive font-medium" : d < 0 ? "text-success font-medium" : ""}>{pkr(d)}</span>;
          } },
          { key: "ledger", label: "Ledger", render: (r) => (
            <Button size="sm" variant="outline" onClick={() => setOpen(r as VendorRow)}><BookOpen className="h-4 w-4" />Ledger</Button>
          ) },
        ]}
        fields={[
          { key: "name", label: "Vendor name", required: true },
          { key: "category", label: "Category (e.g. Flower Supplier, Lighting Team, Transport Driver, Props Rental)" },
          { key: "phone", label: "Phone" },
        ]}
      />
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display text-2xl">{open?.name} — Ledger</DialogTitle></DialogHeader>
          {open && <VendorLedger vendor={open} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
