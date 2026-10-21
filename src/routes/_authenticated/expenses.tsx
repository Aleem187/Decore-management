import { requireRole } from "@/lib/auth";
import { createFileRoute } from "@tanstack/react-router";
import { CrudPage, useOptions } from "@/components/CrudPage";
import { fmtDate, pkr } from "@/lib/format";

const CATEGORIES = ["Flowers", "Lighting", "Props", "Fabric", "Transportation", "Daily Wages", "Hotel Fees", "Salary", "Other"];

export const Route = createFileRoute("/_authenticated/expenses")({
  head: () => ({ meta: [{ title: "Expenses — Sarim Events Planner" }, { name: "description", content: "Daily expense ledger." }, { property: "og:title", content: "Expenses — Sarim Events Planner" }, { property: "og:description", content: "Daily expense ledger." }] }),
  beforeLoad: ({ context }) => requireRole(context.queryClient, ["admin", "accountant"]),
  component: ExpensesPage,
});

function ExpensesPage() {
  const events = useOptions("events");
  const vendors = useOptions("vendors");
  const today = new Date().toISOString().slice(0, 10);
  return (
    <CrudPage table="expenses" title="Expenses" subtitle="Daily cash-out ledger by category" orderBy="expense_date"
      select="*, events(name), vendors(name)" canWrite defaults={{ expense_date: today, category: "Flowers", paid: true }}
      summary={(rows) => {
        const todayTotal = rows.filter((r) => r.expense_date === today).reduce((s, r) => s + Number(r.amount), 0);
        const month = rows.filter((r) => r.expense_date?.slice(0, 7) === today.slice(0, 7)).reduce((s, r) => s + Number(r.amount), 0);
        const unpaid = rows.filter((r) => !r.paid).reduce((s, r) => s + Number(r.amount), 0);
        return (
          <div className="grid gap-3 sm:grid-cols-3">
            {[["Today", todayTotal], ["This month", month], ["Unpaid to vendors", unpaid]].map(([l, v]) => (
              <div key={l} className="rounded-lg border bg-card p-4"><div className="text-sm text-muted-foreground">{l}</div><div className="font-display text-3xl font-semibold">{pkr(v)}</div></div>
            ))}
          </div>
        );
      }}
      columns={[
        { key: "expense_date", label: "Date", render: (r) => fmtDate(r.expense_date) },
        { key: "category", label: "Category" },
        { key: "description", label: "Description", render: (r) => <>{r.description ?? "—"}<div className="text-xs text-muted-foreground">{[r.events?.name, r.vendors?.name].filter(Boolean).join(" · ")}</div></> },
        { key: "amount", label: "Amount", render: (r) => pkr(r.amount) },
        { key: "paid", label: "Paid", render: (r) => (r.paid ? "Yes" : <span className="text-destructive">Pending</span>) },
      ]}
      exportColumns={[
        { header: "Date", value: (r) => r.expense_date },
        { header: "Category", value: (r) => r.category },
        { header: "Description", value: (r) => r.description },
        { header: "Event", value: (r) => r.events?.name },
        { header: "Vendor", value: (r) => r.vendors?.name },
        { header: "Amount (PKR)", value: (r) => Number(r.amount) },
        { header: "Payment Status", value: (r) => (r.paid ? "Paid" : "Pending") },
      ]}
      fields={[
        { key: "expense_date", label: "Date", type: "date", required: true },
        { key: "category", label: "Category", type: "select", options: CATEGORIES.map((c) => ({ value: c, label: c })), required: true },
        { key: "description", label: "Description" },
        { key: "amount", label: "Amount (PKR)", type: "number", required: true },
        { key: "event_id", label: "Event", type: "select", options: events },
        { key: "vendor_id", label: "Vendor", type: "select", options: vendors },
        { key: "paid", label: "Paid", type: "checkbox" },
      ]}
    />
  );
}
