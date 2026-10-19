# Security hardening — rollout and test steps

Branch: `security-hardening`. Nothing here has been applied to a real database.

## Rollout order (use a staging copy first, back up production)
1. Apply the migrations in `supabase/migrations/` in filename order (the last one is `20261020000000_security_hardening.sql`).
   It refuses to run if duplicate invoice numbers exist. It moves `package_price` / `estimated_cost` from `events` into the admin-only `event_financials` table.
2. In the Supabase dashboard: Authentication → Sign In / Providers → turn OFF "Allow new users to sign up".
   Authentication → URL Configuration → add `<your site>/set-password` to the redirect allow-list.
3. Set `SUPABASE_SERVICE_ROLE_KEY` as a server-side secret on the host (never a `VITE_` variable).
4. Make yourself admin: edit the e-mail in `supabase/scripts/make_admin.sql`, run it once in the SQL editor.
5. Deploy this branch.

## Automated checks
- `supabase/tests/rls_security_tests.sql` (run against a throwaway DB with psql, see the file header).
- `bun run test` (unit tests), `bun run build`.

## Manual tests — Admin
1. Sign in. Sidebar shows Dashboard, Events, Hotels, Invoices, Expenses, Vendors, Users, Team & Audit.
2. Dashboard shows profit KPIs and Hotel performance; events without a hotel appear as "Unassigned"; with no events the chart says "No events yet".
3. Users → invite a test accountant (use a real inbox). The row shows "Invited". Open the e-mail link, set a password, you land on the dashboard.
4. Change that user's role to Admin and back; try changing your own role or disabling yourself (both refused).
5. Disable the test accountant: row shows Disabled. Enable again.
6. Invoices → Items on an invoice: add "Stage Decor", qty 1, price 120000. The invoice amount becomes the item total. Download the PDF: it lists your items. On an invoice with no items the PDF shows one line, "Decoration services".
7. Try to set Amount paid above the amount: error "Overpayment blocked". Try a duplicate invoice number: refused.
8. Void an invoice: it shows "voided" and drops out of the totals, and cannot be edited.
9. Delete an expense (trash icon): it disappears. Team & Audit → Activity log shows the actions.
10. Events → edit an event: Package price / Estimated cost save and show in the list.
11. Hotel performance → Export Report (CSV) downloads.

## Manual tests — Accountant (invited account, or "View as Accountant" for a quick UI preview only)
1. Sidebar shows only Dashboard, Invoices, Expenses, Vendors. Typing /events, /hotels, /users or /team in the address bar sends you back to the dashboard.
2. Dashboard shows the accounts desk only: no profit, no hotel performance, no upcoming events.
3. Invoices: you can add, edit, add Items and download PDFs. There is no delete button and no Void button.
4. Expenses / Vendors: add and edit work; no delete button. Vendor ledger: payments can be added, not deleted.
5. Add an invoice with a duplicate number, or a payment above the amount: refused with a clear message.
6. A person who signs up some other way (or an account with no role) is sent to the "No access" page.
7. Real enforcement check (the "View as" switch only changes the screen): sign in as the real accountant and confirm the above, because the database enforces it.

## Not done / needs your decision
- Drizzle files untouched (see the question in the hand-off message).
- Restoring a soft-deleted record is SQL only: `update public.<table> set deleted_at = null, deleted_by = null where id = '…';` run as the database owner.

---

# Payments ledger (branch `payments-ledger`)

Migration: `supabase/migrations/20261021000000_payments_ledger.sql` (needs the hardening migration first).

## Rollout
1. Staging first. Back up. The migration stops with a clear error if any invoice has `amount_paid` above its total; fix those rows and re-run.
2. Each invoice with `amount_paid > 0` gets one payment: method cash, reference `MIGRATED`, note "Opening balance (migrated)", dated on the invoice's creation date. The migration checks that ledger totals equal the old stored values before it finishes.
3. The `amount_paid` column is kept (the database now fills it in). Nothing is dropped; dropping or renaming it is a separate decision.

## Manual tests — Accountant
1. Invoices → Payments on an invoice. Totals show total / paid / remaining.
2. Record a part payment (e.g. cash, reference "R-1"). Paid goes up, status becomes partial, remaining goes down.
3. Try an amount above the remaining balance: refused. Exact remaining balance: accepted, status becomes paid.
4. The history has Receipt buttons (one PDF per payment) and no Void button. There is no edit or delete anywhere.
5. The invoice form no longer has an "Amount paid" field. Lowering the invoice amount below what is already paid is refused.
6. Download the Invoice PDF: payments list, totals and a PAID IN FULL / PARTIALLY PAID / UNPAID stamp.

## Manual tests — Admin
1. Same as above, plus a Void button per payment. Click it, enter a reason (3+ characters), confirm.
2. The payment is struck through with the reason; paid and remaining update; the status moves back (e.g. paid → partial). The voided payment has no Receipt button.
3. Record a new payment for the freed balance. It is accepted.
4. Team & Audit → Activity log shows the payment entries and a `VOID_PAYMENT` row.
5. A voided invoice accepts no new payments.
