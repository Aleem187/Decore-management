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
