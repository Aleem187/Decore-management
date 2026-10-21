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

---

# Clients module (branch `clients-module`)

Migration: `supabase/migrations/20261022000000_clients.sql` (after the hardening and payments migrations).

## Rollout
1. Staging first, with a backup. The migration prints a notice such as "N clients created, X events and Y invoices linked by name".
2. Existing columns are untouched. Clients are created from distinct names (ignoring case and extra spaces) on events and invoices; phones come from events and are cleaned to 92xxxxxxxxxx (invalid ones are dropped). Two different people with the same name become ONE client: review the Clients list afterwards.
3. Invoices or events with a blank name stay unlinked.
4. From now on, picking a client on an event or invoice copies the client's name (and phone, for events) into the old columns, and renaming a client updates them (void invoices keep their old name).

## Manual tests — Accountant
1. Clients page: list loads, search by name, by email and by phone typed as 0300… (finds numbers stored as 92300…). Next/Previous change pages; with more than 20 clients the counter reads "Showing 21–40 of N".
2. Add client: blank name → error; phone "12345" → error; phone "0300-1234567" shows "Will be saved as +92 300 1234567"; saved list shows +92 300 1234567.
3. Edit a client. There is no Delete button anywhere.
4. Invoices → add an invoice choosing the client; leave "Client name" empty. It saves, and the Client column shows the client's name. Same on Events (admin).
5. Open the client: totals Invoiced / Received / Outstanding match the invoices and payments. Record a payment on one of their invoices and reload: Received goes up and Outstanding down.
6. WhatsApp buttons open WhatsApp with the client's number and the message.

## Manual tests — Admin
1. Everything above, plus a Delete (trash) icon on the list and a Delete button on the detail page. After deleting, the client disappears from the list and pickers; their events and invoices keep their name and still accept payments.
2. Rename a client: their events and open invoices show the new name.
3. Team & Audit → Activity log shows client inserts, updates and deletes.
4. At 375px: the clients table hides Email/Added columns, buttons wrap, the detail page cards stack.

---

# Event profitability (branch `event-profitability`)

Migration: `supabase/migrations/20261023000000_event_profitability.sql` (after the clients migration).

## Rollout
1. Staging first, with a backup. The migration only adds indexes, a trigger and three functions; no column is changed.
2. Cash and profit figures come only from `event_pnl()`, `event_pnl_one()` and `general_expenses_total()`. They check for the admin role inside the database and raise "permission denied" for everyone else. Every call is written to the audit log (`VIEW_EVENT_PNL`).
3. Known limit: accountants still read raw invoices and expenses (their normal work), including each expense's event link. Someone determined could add those up by hand. Hiding that would mean hiding the event link on expenses from accountants, which changes existing data and the Expenses page; ask if you want it.

## Manual tests — Admin
1. Expenses: add an expense and pick an event and a vendor; add another with no event.
2. Events → click an event name: tiles Total invoiced / Total received / Total expenses / Profit (or Loss, in red) with a margin note; invoice and expense tables below.
3. Void a payment on one of its invoices (Invoices → Payments → Void): Received drops. Void an invoice: Invoiced drops.
4. Event Profitability (sidebar): pick This month / Last month / This year / Custom. Rows show client, hotel, invoiced, received, expenses, profit, margin; totals row at the bottom; "General expenses" and "Net after general expenses" cards. An event with no invoices shows zero income, a loss and "—" margin.
5. Export Report (CSV): open in Excel. Give a client the name `=1+1` first: it must appear as text `'=1+1`, not 2. Losses are negative numbers.
6. Team & Audit → Activity log shows `VIEW_EVENT_PNL` entries.
7. At 375px the table keeps Event / Received / Expenses / Profit and scrolls sideways; client and hotel move under the event name.

## Manual tests — Accountant (real accountant login)
1. Expenses: link an expense to an event and to a vendor. Saving works.
2. Sidebar has no Event Profitability. Opening /event-profitability or /events goes back to the dashboard.
3. Invoices → click an event name: the event page shows only Total invoiced and Total received and the invoice list, with the note that costs and profit are admin only. No expenses, no profit.
4. In the browser console, calling the profit functions (for example `event_pnl`) through the API is refused (permission denied).

---

# Events calendar (branch `calendar`)

Migration: `supabase/migrations/20261024000000_events_calendar.sql` (after the event profitability migration).

## What it adds
- A `cancelled` event status, optional `start_time` / `end_time` on events (both or neither; an end at or before the start means the event runs past midnight), and an `event_staff` table that assigns existing team members (rows of `profiles`, people with a login and a role) to events.
- Admins create, change and remove assignments; admins and accountants can read them. Removing an assignment really deletes the row (it is a link table); the audit log keeps the record.
- Names of assigned people are shown to admins only, because accountants cannot read other people's profiles.

## Clash rules (src/lib/clashes.ts)
- Only live events count: cancelled and soft-deleted events are ignored. Completed and paid events still count.
- Same date is required. Times overlap when each starts before the other ends; back-to-back events (11:00 end, 11:00 start) do not clash.
- An event with no times is treated as all day, so it clashes with anything else that day.
- A venue clash needs the same hotel; an event with no hotel never clashes on venue. Staff clashes compare events the person is already assigned to.
- Clashes only warn. Admins can continue after a confirmation; the database does not block double-booking.

## Rollout
1. Staging first, with a backup. Adding an enum value cannot be undone in Postgres.
2. `alter type ... add value` and the first use of `cancelled` must be in separate transactions; the migration does not use it itself.

## Manual tests — Admin
1. Calendar (sidebar). Switch Month / Week / List; Previous / Today / Next; statuses are coloured and a legend is shown.
2. Month view on a laptop: click an empty day → "New event" dialog for that date. On a phone: tap a day → a panel lists its events and has "Add event".
3. Create an event with a start and end time and a hotel. Create a second one at the same hotel, overlapping: a yellow warning appears; "Create event" turns into a confirmation, "Create anyway" saves it. A different hotel, a different day, or non-overlapping times shows no warning. Mark one cancelled and the warning disappears.
4. Click an event → /events/<id>. Its Team section: choose a person and a role, Assign. Assign the same person to an overlapping event on the same day → warning with the other event, "Assign anyway" / "Cancel". The first event now shows "Also on …" under that person.
5. Events page: edit an event's date, hotel or times; if it double-books the venue the browser asks for confirmation before saving.
6. Set an event to cancelled: it is greyed and struck through on the calendar, and no longer appears in "Upcoming events" or Hotel performance on the dashboard.

## Manual tests — Accountant
1. Calendar loads in all three views; there is no "New event" button, clicking a day only selects it.
2. Click an event → its page shows times, invoiced and received, and any venue-clash warning, but no Team section, expenses or profit.
3. At 375px the month grid shows coloured dots, the week view stacks day by day, the list view scrolls normally.

---

# Staff, attendance and payroll (branch `staff-module`)

Migration: `supabase/migrations/20261025000000_staff_payroll.sql` (after the events calendar migration).

## What it adds
- `staff` (people without a login), `attendance` (one mark per person per day), `staff_advances`, `salary_payments`. Phones are cleaned to 92xxxxxxxxxx and CNICs to 12345-1234567-1 by the database too.
- `event_staff` can now point at a staff member (`staff_member_id`) or, as before, a login user (`staff_id`); exactly one of the two. Existing rows are untouched. `event_staff.staff_id` only lost its NOT NULL. Nothing was dropped.
- New assignments on the event page use staff members. Clash detection treats a staff member and a login user as different people, so a person who is both could be double-booked unnoticed.

## Salary rules (also shown on each staff page)
- Present = 1 day, half day = 0.5, absent and leave = 0 (all leave is unpaid).
- Daily wage: days worked × daily rate.
- Monthly: salary − (absent + leave + 0.5 × half days + days before joining) × salary ÷ 30, never below 0. Days with no mark are not deducted; if nothing is marked a monthly person is shown the full salary with a warning.
- Advances given up to the end of the month, minus what earlier payouts already recovered, are recovered from the pay (at most the pay); the rest carries forward. Net = earned + bonus − recovered.

## Money flow, no double counting
- An advance books one `Salary` expense for its amount on the day it is given. A payout books one `Salary` expense for its net cash amount. Together they equal earned + bonus. The dashboard and reports read expenses only, so each rupee is counted once. A payout with net 0 books nothing.
- These generated expenses cannot be edited or deleted on the Expenses page. Void the payout, or have an admin delete the advance, and the expense is removed with it.
- Salary expenses have no event, so they show under "General expenses" in the event profitability report.

## Permissions
- Admin: everything. Accountant: no access to staff, rates, salaries, attendance, advances, salary payments or team assignments (superseded by migration 20261026000000_accountant_restrictions.sql; see "Accountant restrictions" at the end).
- Salary payments are created only by `record_salary_payment()`, which recalculates everything in the database and refuses if the figures differ from what the user reviewed.
- Voiding (admin only, with a reason) is audited. A payout can be paid again after a void.

## Rollout
Staging first, with a backup. No existing data is changed.

## Manual tests — Admin
1. Staff → Add staff: a daily-wage driver (0300-1234567, CNIC 3520212345671) and a monthly supervisor. Phone and CNIC show cleaned hints; a wrong CNIC or negative rate is refused.
2. Attendance (sidebar): pick a day, tap Present / Half day / Absent / Leave for each person; tapping again changes it. "Mark everyone unmarked as present" works. A future date is refused.
3. Staff page → pick the person: tap days in the month grid to correct marks (Clear removes one).
4. Advances: record 5,000. Check Expenses: a `Salary` row "Salary advance - name". Try editing it: refused.
5. Salary section: bonus 500 → figures change; "Record payment" asks for confirmation. Check Expenses for the new `Salary` row (net amount only) and the dashboard's expenses.
6. Download the salary slip from the payments table, and a draft slip before paying.
7. Void the payment with a reason: the Salary expense disappears, the advance is owed again, the month can be paid again.
8. Events → an event → Team: assign a staff member; assign the same person to an overlapping event to see the clash warning.

## Manual tests — Accountant
1. Staff and Attendance are in the sidebar. The staff list shows pay rates. There is no Add / Edit / Delete.
2. Mark and correct attendance; add an advance; record a salary payment. There is no Void button and no Delete (advances, attendance marks, payments).
3. The Events page and event Team section stay admin-only.


## Accountant restrictions (20261026000000_accountant_restrictions.sql)
- Accountants work with invoices, payments, expenses, vendors and clients only.
- `staff`, `attendance`, `staff_advances`, `salary_payments` and `event_staff` are admin-only for reads and writes (RLS).
- Expenses generated by salary payments and advances (`source_table is not null`) are hidden from accountants.
- `staff_salary_calc()` and `record_salary_payment()` are security definer, so they check for the admin role inside.
- The "View as" switcher was removed; the UI follows the role in `user_roles`.
- Tests: `supabase/tests/rls_security_tests.sql` (accountant denial section 8) against a throwaway database.

## Manual tests — Accountant (restricted)
1. Sidebar shows only Dashboard, Clients, Invoices, Expenses, Vendors. No role switcher.
2. Dashboard shows "Accounts desk" with unpaid/overdue invoices and expenses; no net profit, cash flow or hotel performance.
3. Typing /staff, /attendance, /calendar, /events or /event-profitability redirects to /dashboard.
4. The Expenses list shows no "Salary" rows.
