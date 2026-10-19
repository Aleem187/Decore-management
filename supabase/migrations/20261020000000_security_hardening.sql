-- Security hardening: invite-only access, admin-only delete/void, constraints,
-- append-only audit log, invoice items and admin-only event financials.
-- Review before applying. Do NOT run against production without a backup.

-- ---------------------------------------------------------------------------
-- 0. Pre-flight: refuse to run if existing data would break new unique rules.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.invoices group by lower(invoice_no) having count(*) > 1) then
    raise exception 'Duplicate invoice numbers exist. Rename them, then re-run this migration.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Users, roles and helper functions
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists disabled_at timestamptz;

-- A disabled user has no role for RLS purposes.
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles r
    join public.profiles p on p.id = r.user_id
    where r.user_id = _user_id and r.role = _role and p.disabled_at is null
  )
$$;

create or replace function public.is_staff(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles r
    join public.profiles p on p.id = r.user_id
    where r.user_id = _user_id and p.disabled_at is null
  )
$$;

revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
revoke execute on function public.is_staff(uuid) from public, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;
grant execute on function public.is_staff(uuid) to authenticated, service_role;

-- One role per user (admin wins if someone somehow has both).
delete from public.user_roles a using public.user_roles b
  where a.user_id = b.user_id and a.role = 'accountant' and b.role = 'admin';
create unique index if not exists user_roles_one_per_user on public.user_roles (user_id);

-- No more "first user becomes admin". New sign-ups get a profile and NO role,
-- so they cannot read or write anything. Admins are assigned manually
-- (supabase/scripts/make_admin.sql) or through the Users page.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), new.email)
  on conflict (id) do nothing;
  return new;
end $$;

-- The last admin can never be demoted or removed.
create or replace function public.protect_last_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin') then
    if not exists (select 1 from public.user_roles where role = 'admin' and id <> old.id) then
      raise exception 'The last admin cannot be removed or demoted';
    end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists protect_last_admin on public.user_roles;
create trigger protect_last_admin before update or delete on public.user_roles
  for each row execute function public.protect_last_admin();

-- ---------------------------------------------------------------------------
-- 2. Soft delete / void columns
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['hotels','vendors','events','invoices','expenses','vendor_payments','event_materials'] loop
    execute format('alter table public.%I add column if not exists deleted_at timestamptz', t);
    execute format('alter table public.%I add column if not exists deleted_by uuid', t);
  end loop;
end $$;
alter table public.invoices add column if not exists voided_at timestamptz;
alter table public.invoices add column if not exists voided_by uuid;

-- ---------------------------------------------------------------------------
-- 3. Event financials move to an admin-only table (profit data)
-- ---------------------------------------------------------------------------
create table if not exists public.event_financials (
  event_id uuid primary key references public.events(id) on delete cascade,
  package_price numeric(12,2) not null default 0 check (package_price >= 0),
  estimated_cost numeric(12,2) not null default 0 check (estimated_cost >= 0),
  updated_at timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'events' and column_name = 'package_price') then
    insert into public.event_financials (event_id, package_price, estimated_cost)
      select id, package_price, estimated_cost from public.events
      on conflict (event_id) do nothing;
    alter table public.events drop column package_price;
    alter table public.events drop column estimated_cost;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Invoice items
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null check (length(btrim(description)) > 0),
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price > 0),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid
);
create index if not exists invoice_items_invoice_id_idx on public.invoice_items (invoice_id);

-- ---------------------------------------------------------------------------
-- 5. Constraints
--    NOT VALID = enforced for every new or changed row, existing rows are not
--    re-checked. Run "alter table ... validate constraint ..." after cleaning data.
-- ---------------------------------------------------------------------------
alter table public.invoices drop constraint if exists invoices_amount_positive;
alter table public.invoices add constraint invoices_amount_positive check (amount > 0) not valid;
alter table public.invoices drop constraint if exists invoices_paid_not_negative;
alter table public.invoices add constraint invoices_paid_not_negative check (amount_paid >= 0) not valid;
alter table public.expenses drop constraint if exists expenses_amount_positive;
alter table public.expenses add constraint expenses_amount_positive check (amount > 0) not valid;

drop index if exists public.invoices_invoice_no_unique;
create unique index invoices_invoice_no_unique on public.invoices (lower(invoice_no)) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 6. Invoice status is always calculated; overpayment is blocked
-- ---------------------------------------------------------------------------
create or replace function public.compute_invoice_status(_amount numeric, _paid numeric, _due date)
returns public.invoice_status language sql stable set search_path = public as $$
  select case
    when _amount > 0 and _paid >= _amount then 'paid'::public.invoice_status
    when _due is not null and _due < current_date then 'overdue'::public.invoice_status
    when _paid > 0 then 'partial'::public.invoice_status
    else 'unpaid'::public.invoice_status
  end
$$;

create or replace function public.invoice_before_write()
returns trigger language plpgsql set search_path = public as $$
declare items_total numeric;
begin
  if tg_op = 'UPDATE' and old.voided_at is not null and new.voided_at is not null
     and (new.amount, new.amount_paid, new.invoice_no, new.client_name)
         is distinct from (old.amount, old.amount_paid, old.invoice_no, old.client_name) then
    raise exception 'A voided invoice cannot be edited';
  end if;

  -- With line items, the invoice total is always their sum.
  if tg_op = 'UPDATE' then
    select sum(quantity * unit_price) into items_total
      from public.invoice_items where invoice_id = new.id and deleted_at is null;
    if items_total is not null then new.amount := round(items_total, 2); end if;
  end if;

  if new.amount_paid > new.amount then
    raise exception 'Overpayment blocked: paid % exceeds invoice total %', new.amount_paid, new.amount
      using errcode = 'check_violation';
  end if;

  new.status := public.compute_invoice_status(new.amount, new.amount_paid, new.due_date);
  return new;
end $$;

drop trigger if exists invoice_status on public.invoices;
drop trigger if exists invoice_before_write on public.invoices;
create trigger invoice_before_write before insert or update on public.invoices
  for each row execute function public.invoice_before_write();

create or replace function public.sync_invoice_total()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Touch the invoice so invoice_before_write recalculates amount and status.
  update public.invoices set amount = amount where id = coalesce(new.invoice_id, old.invoice_id);
  return coalesce(new, old);
end $$;
drop trigger if exists sync_invoice_total on public.invoice_items;
create trigger sync_invoice_total after insert or update or delete on public.invoice_items
  for each row execute function public.sync_invoice_total();

-- Overdue only changes with the calendar, so refresh it daily.
create or replace function public.refresh_invoice_statuses()
returns void language sql set search_path = public as $$
  update public.invoices
     set status = public.compute_invoice_status(amount, amount_paid, due_date)
   where deleted_at is null
     and status is distinct from public.compute_invoice_status(amount, amount_paid, due_date);
$$;
revoke execute on function public.refresh_invoice_statuses() from public, anon, authenticated;
grant execute on function public.refresh_invoice_statuses() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('refresh-invoice-statuses', '5 0 * * *', 'select public.refresh_invoice_statuses()');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Only admins can delete (soft) or void
-- ---------------------------------------------------------------------------
create or replace function public.guard_admin_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.has_role(auth.uid(), 'admin') then
    if to_jsonb(new)->'deleted_at' is distinct from to_jsonb(old)->'deleted_at'
       or to_jsonb(new)->'deleted_by' is distinct from to_jsonb(old)->'deleted_by'
       or to_jsonb(new)->'voided_at' is distinct from to_jsonb(old)->'voided_at'
       or to_jsonb(new)->'voided_by' is distinct from to_jsonb(old)->'voided_by' then
      raise exception 'Only admins can delete or void records' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['hotels','vendors','events','invoices','expenses','vendor_payments','event_materials','invoice_items'] loop
    execute format('drop trigger if exists guard_admin_columns on public.%I', t);
    execute format('create trigger guard_admin_columns before update on public.%I for each row execute function public.guard_admin_columns()', t);
  end loop;
end $$;

create or replace function public.soft_delete(_table text, _id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can delete records' using errcode = '42501';
  end if;
  if _table not in ('hotels','vendors','events','invoices','expenses','vendor_payments','event_materials','invoice_items') then
    raise exception 'Unsupported table %', _table;
  end if;
  execute format('update public.%I set deleted_at = now(), deleted_by = auth.uid() where id = $1 and deleted_at is null', _table)
    using _id;
end $$;

create or replace function public.void_invoice(_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can void invoices' using errcode = '42501';
  end if;
  update public.invoices set voided_at = now(), voided_by = auth.uid() where id = _id and voided_at is null;
end $$;

revoke execute on function public.soft_delete(text, uuid) from public, anon;
revoke execute on function public.void_invoice(uuid) from public, anon;
grant execute on function public.soft_delete(text, uuid) to authenticated, service_role;
grant execute on function public.void_invoice(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Audit log: append-only, filled by triggers
-- ---------------------------------------------------------------------------
create or replace function public.log_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare rec jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_logs (user_id, table_name, action, record_id)
  values (auth.uid(), tg_table_name, tg_op, nullif(coalesce(rec->>'id', rec->>'event_id'), '')::uuid);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['invoice_items','event_financials','user_roles'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.log_change()', t);
  end loop;
end $$;

create or replace function public.prevent_audit_changes()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_logs is append-only' using errcode = '42501';
end $$;
drop trigger if exists audit_logs_append_only on public.audit_logs;
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function public.prevent_audit_changes();
drop trigger if exists audit_logs_no_truncate on public.audit_logs;
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function public.prevent_audit_changes();

-- ---------------------------------------------------------------------------
-- 9. Privileges: nobody but service_role gets more than select/insert/update,
--    and nothing at all for anon.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on public.profiles, public.user_roles, public.hotels, public.vendors, public.events,
  public.invoices, public.expenses, public.audit_logs, public.event_materials, public.vendor_payments,
  public.event_financials, public.invoice_items from authenticated;

grant select on public.user_roles, public.audit_logs to authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant select, insert, update on public.hotels, public.vendors, public.events, public.invoices,
  public.expenses, public.event_materials, public.vendor_payments, public.event_financials,
  public.invoice_items to authenticated;
grant all on public.event_financials, public.invoice_items to service_role;

-- ---------------------------------------------------------------------------
-- 10. Row Level Security: drop every old policy, then recreate explicitly
-- ---------------------------------------------------------------------------
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public'
             and tablename in ('profiles','user_roles','hotels','vendors','events','invoices','expenses',
                               'audit_logs','event_materials','vendor_payments','event_financials','invoice_items')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.hotels enable row level security;
alter table public.vendors enable row level security;
alter table public.events enable row level security;
alter table public.invoices enable row level security;
alter table public.expenses enable row level security;
alter table public.audit_logs enable row level security;
alter table public.event_materials enable row level security;
alter table public.vendor_payments enable row level security;
alter table public.event_financials enable row level security;
alter table public.invoice_items enable row level security;

-- Identity tables (writes only through admin-checked server functions using service_role)
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- Audit log: admins read, nobody writes through the API
create policy audit_logs_select_admin on public.audit_logs for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Admin-only data
create policy event_financials_select on public.event_financials for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
create policy event_financials_insert on public.event_financials for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));
create policy event_financials_update on public.event_financials for update to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- Staff read, admin write
do $$
declare t text;
begin
  foreach t in array array['hotels','events'] loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (public.is_staff(auth.uid()) and deleted_at is null)', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.has_role(auth.uid(), ''admin'') and deleted_at is null)', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (public.has_role(auth.uid(), ''admin'') and deleted_at is null) with check (public.has_role(auth.uid(), ''admin''))', t);
  end loop;
end $$;

-- Staff (admin + accountant) read, add and edit; delete is admin-only via soft_delete()
do $$
declare t text;
begin
  foreach t in array array['vendors','invoices','expenses','vendor_payments','event_materials','invoice_items'] loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (public.is_staff(auth.uid()) and deleted_at is null)', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.is_staff(auth.uid()) and deleted_at is null)', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (public.is_staff(auth.uid()) and deleted_at is null) with check (public.is_staff(auth.uid()))', t);
  end loop;
end $$;
