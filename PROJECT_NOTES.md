# Décor Studio — Project Notes

Snapshot written on 2026-10-19 after reading the code and migrations. Nothing was run against a live database, so everything about Supabase is taken from the SQL files and `types.ts`, not from the real project.

## 0. Stack

The app is **not Next.js**. It is **TanStack Start** (`@tanstack/react-start`) with TanStack Router (file-based routes), built with **Vite** and deployed through Nitro (a Cloudflare worker config is generated). Other pieces:

- React 19, Tailwind CSS v4, shadcn/ui (46 components in `src/components/ui`)
- TanStack Query, Recharts
- Supabase (`@supabase/supabase-js`)
- `jspdf` and `jspdf-autotable` for PDFs
- Vitest (a single routing test)

The project is connected to Lovable (see `AGENTS.md`). Do not rewrite pushed git history.

## 1. Folder structure and key files

```
AGENTS.md                      Lovable sync warning
PROJECT_NOTES.md               this file
drizzle/                       schema.ts ("auto-generated, intentionally blank") + migrations/0000_migration.sql
supabase/config.toml           project_id only
supabase/migrations/           added by us: event_materials, vendor_payments (not yet applied)
src/
  routes/
    __root.tsx                 HTML shell, query provider, error/404 pages
    index.tsx                  public landing page
    auth.tsx                   sign in / sign up
    _authenticated/route.tsx   app shell: sidebar, role switcher, route guard
    _authenticated/dashboard.tsx  KPIs, cash-flow chart, hotel-performance chart
    _authenticated/events.tsx | hotels.tsx | invoices.tsx | expenses.tsx | vendors.tsx | team.tsx
  components/
    CrudPage.tsx               generic list + search + add/edit/delete + CSV export, used by most pages
    EventChecklist.tsx         event material checklist (packed/delivered/returned)
    VendorLedger.tsx           vendor payment ledger dialog
    WhatsAppButton.tsx         wa.me link button
    ui/                        shadcn components
  lib/
    auth.ts                    useMe(), role "view as" override
    format.ts                  pkr(), fmtDate()
    csv.ts                     CSV download helper
    invoice-pdf.ts             invoice and receipt PDF
    whatsapp.ts                phone sanitising + message
    vendor-ledger.ts           payable/paid/pending maths
  integrations/supabase/       client.ts, client.server.ts, auth-middleware.ts, auth-attacher.ts, cron-auth.ts, types.ts
                               (mostly generated, "do not edit"; types.ts was edited by hand for our two new tables)
  start.ts, server.ts, router.tsx, routeTree.gen.ts (generated)
  test/app-routing.test.tsx    the only test
```

Routes and access:

| Route | Who sees it |
|---|---|
| `/dashboard` (different view per role), `/clients`, `/invoices`, `/expenses`, `/vendors` | admin and accountant |
| `/events`, `/hotels`, `/calendar`, `/staff`, `/attendance`, `/event-profitability`, `/users` | admin only (`beforeLoad` redirect, sidebar, and RLS for staff data) |
| `/team` | admin only (`beforeLoad` redirect) |

## 2. Supabase tables

All are in schema `public`. Source: `drizzle/migrations/0000_migration.sql` plus our two new files.

Enums:

- `app_role`: admin, accountant
- `event_status`: upcoming, in_progress, completed, paid
- `invoice_status`: unpaid, partial, paid, overdue

| Table | Columns | Relationships |
|---|---|---|
| `profiles` | id (PK), full_name, email, created_at | id → auth.users (cascade) |
| `user_roles` | id (PK), user_id, role, unique(user_id, role) | user_id → auth.users (cascade) |
| `hotels` | id, name, address, contact_person, contact_phone, hall_name, guidelines, created_at | — |
| `vendors` | id, name, category, phone, created_at | — |
| `events` | id, name, event_date, client_name, client_phone, hotel_id, event_type (default Wedding), status, estimated_cost, package_price, notes, created_at | hotel_id → hotels (set null) |
| `invoices` | id, invoice_no, event_id, client_name, kind (default Advance), amount, amount_paid, due_date, status, created_at | event_id → events (set null) |
| `expenses` | id, expense_date, category, description, amount, event_id, vendor_id, paid (default true), created_at | event_id → events (set null); vendor_id → vendors (set null) |
| `audit_logs` | id, user_id, table_name, action, record_id, created_at | none (user_id is not a foreign key) |
| `event_materials` (new) | id, event_id, item_name, quantity (>0), status (packed/delivered/returned), created_at | event_id → events (cascade) |
| `vendor_payments` (new) | id, vendor_id, payment_date, amount (>0), method, notes, created_at | vendor_id → vendors (cascade) |

Database functions and triggers:

- `has_role(user, role)` and `is_staff(user)`: security definer, check `user_roles`.
- `handle_new_user` on `auth.users` insert: creates the profile. **The first user ever becomes admin, everyone after is accountant.**
- `log_change()` is attached to invoices, expenses, vendors, events and hotels (and to our two new tables). It stores only user, table, action and record id. It does not store old or new values.
- `set_invoice_status` before insert or update on invoices: sets status from amount_paid, amount and due_date.

## 3. Row Level Security

RLS is **enabled on every table**. Nothing is unprotected.

| Table | Policies |
|---|---|
| profiles | select: own row or admin. update: own row |
| user_roles | select: own roles or admin. **No insert, update or delete policy**, so roles cannot be changed from the client |
| hotels | select: staff. all: admin only |
| events | select: staff. all: admin only |
| vendors | all: staff |
| invoices | all: staff |
| expenses | all: staff |
| audit_logs | select: admin only (writes only through the security-definer trigger) |
| event_materials (new) | all: staff |
| vendor_payments (new) | all: staff |

"Staff" means any user with a row in `user_roles`.

## 4. Authentication and roles

- Email and password through Supabase Auth (`auth.tsx`). Sign-up is open to anyone and sets `full_name` in user metadata.
- `_authenticated` route (`ssr: false`): `beforeLoad` calls `supabase.auth.getUser()` and redirects to `/auth` if there is no user.
- `meQuery` (`lib/auth.ts`) loads the user's roles and profile. Role = admin if the user has an admin row, otherwise the first role found.
- `useMe()` returns the role stored in the database. There is no "View as" switcher; to see the accountant experience, sign in as an accountant.
- The UI hides pages by role: the sidebar filter, a redirect effect for accountants, and the `/team` guard. **The actual enforcement is the RLS policies above.**
- Server-side helpers exist (`auth-middleware.ts` for server functions, `cron-auth.ts` for cron secrets) but no server functions use them yet. The app talks to Supabase directly from the browser.

## 5. Existing features

- Dashboard: admin KPIs (revenue, expenses, net profit, outstanding), 6-month cash flow, hotel performance chart with CSV export, upcoming events. The accountant gets a separate invoices-and-expenses view (unpaid/overdue invoices, today's expenses, recent invoices and expenses) with no profit, cash flow or staff figures; it runs its own queries.
- Hotels and Events CRUD (admin writes). Events also have the material checklist and the WhatsApp update button.
- Invoices CRUD, automatic status, PDF invoice and receipt, WhatsApp button, CSV export.
- Expenses CRUD with day, month and unpaid totals, and CSV export.
- Vendors CRUD plus the ledger with payments and history.
- Team and audit page (admin): staff list and activity log.
- Role switcher, PKR formatting, responsive sidebar (top bar on mobile).

## 6. Bugs and risks

Roughly in order of importance.

**Security and data integrity**
1. **Open sign-up gives anyone staff access.** Any visitor can sign up and becomes an accountant with full read and write on invoices, expenses and vendors, and read on events and hotels. Consider disabling public sign-up or requiring an invite or approval.
2. **"First user is admin" is fragile.** If the admin row is ever deleted, the next sign-up becomes admin. The check also has no lock, so two simultaneous first sign-ups could both become admin.
3. **No way to manage roles or staff.** `user_roles` has no write policy and `/team` is read-only, so promoting, demoting or removing staff needs the Supabase dashboard.
4. **Accountants can delete financial records.** Invoices, expenses, vendors, vendor payments and checklist items allow delete for all staff. Consider restricting delete to admins.
5. **Accountants can read events and hotels** through RLS even though the UI hides those pages. Anyone with the API key and an accountant login can fetch them.
6. **The audit log is thin.** It records who, which table and which record, but not what changed. It does not cover `user_roles` or `profiles`. `user_id` is not a foreign key.
7. **No validation in the database.** Amounts can be negative. `amount_paid` can exceed `amount`. `invoice_no` is not unique. The default number `INV-` plus the last 6 digits of `Date.now()` can collide.
8. **Invoice "overdue" is only computed when a row is written.** An invoice that becomes overdue later stays "unpaid" until someone edits it.
9. **`profiles` update policy has no WITH CHECK**, so a user can edit their own `email` and `full_name` freely. Low impact, but worth tightening.

**Correctness and accuracy**
10. **Fake data can look real.** From Step 1, events without a hotel are shown under a made-up hotel name (Marriott Banquet, etc.) on the dashboard, and an empty dashboard shows invented sample hotels. This is demo data in a financial view. Replace with "Unassigned" before real use.
11. **Invoice PDFs invent line items.** The database has one amount per invoice, so the PDF splits it 40/20/25/15 into Stage Decor, Lighting, Floral Setup and Mandap. Clients would see these as real charges. A real invoice-items table is needed.
12. **Cash flow is based on `invoices.created_at`**, not on when money was received, and `amount_paid` is a running total with no payment dates. Monthly "Cash in" is therefore approximate.
13. **Vendor "paid" has two sources.** An expense marked paid counts as paid, and ledger payments are added on top. The Expenses page card "Unpaid to vendors" still ignores ledger payments, while the dashboard uses the ledger-aware figure. The two can disagree.
14. **Role cache can go stale.** `meQuery` is fetched once and reused by route guards, so a role change in the database needs a reload.

**Code quality and tooling**
15. **Lint and type noise.** About 84 `TS4111` errors ("comes from an index signature") come from `CrudPage` rows being typed as `Record<string, any>`. There are also many Prettier errors because the code is written in a dense style Prettier rejects. `CrudPage` is the cause of most `any` use.
16. **`CrudPage` details.** After any save or delete it invalidates the whole query cache. Search is `JSON.stringify` of the row. It has no pagination, and dashboard queries load whole tables, which is fine for a small studio and slow later. There is no error state when a query fails.
17. **Migrations live in two places.** The original is in `drizzle/migrations`; our two new files are in `supabase/migrations`. They are **not applied** and the Drizzle journal and snapshot do not know about them. Decide how Lovable should apply them.
18. **Lockfile drift.** Both `bun.lock` and `package-lock.json` exist. `jspdf` and `jspdf-autotable` were added with npm, so only `package-lock.json` has them. Update `bun.lock` too (for example with `bun install`) if Lovable builds with bun.
19. **Almost no tests.** One routing test. Nothing covers the money maths, phone sanitising, or role logic.
20. **Landing page claim.** "Profit insight: margin per hotel" promises something the dashboard only partly shows (revenue and cost bars, no margin figure).

## 7. Open questions for the next steps

- Should sign-up be closed or invite-only?
- Should accountants be able to delete records?
- Do you want real invoice line items?
- Should the fake sample hotels be removed?
- How should the two new migrations be applied?
