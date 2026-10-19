-- Event-wise profit and loss.
-- Depends on the security hardening, payments ledger and clients migrations.
-- No existing column is altered. Profit and cost figures are produced only by the admin-only
-- functions below, so an accountant cannot obtain them through the API.

-- ---------------------------------------------------------------------------
-- 1. Expense links (no-ops where the columns already exist, as in the base schema) + indexes
-- ---------------------------------------------------------------------------
alter table public.expenses add column if not exists event_id uuid references public.events(id) on delete set null;
alter table public.expenses add column if not exists vendor_id uuid references public.vendors(id) on delete set null;

create index if not exists expenses_event_id_idx on public.expenses (event_id);
create index if not exists expenses_vendor_id_idx on public.expenses (vendor_id);
create index if not exists invoices_event_id_idx on public.invoices (event_id);
create index if not exists events_event_date_idx on public.events (event_date);

-- An expense can only be linked to an event that exists and has not been deleted.
-- (Accountants may link expenses to events; they just cannot read the resulting cost/profit figures.)
create or replace function public.expenses_check_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.event_id is not null and (tg_op = 'INSERT' or new.event_id is distinct from old.event_id) then
    if not exists (select 1 from public.events where id = new.event_id and deleted_at is null) then
      raise exception 'The linked event was not found' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists expenses_check_event on public.expenses;
create trigger expenses_check_event before insert or update of event_id on public.expenses
  for each row execute function public.expenses_check_event();

-- ---------------------------------------------------------------------------
-- 2. Admin-only profit functions
--    invoiced = non-void, non-deleted invoices of the event
--    received = non-voided payments on those invoices
--    expenses = non-deleted expenses linked to the event
--    Profit (cash basis) = received - expenses is derived by the caller.
--    Each call is written to the audit log, because it exposes profit data.
-- ---------------------------------------------------------------------------
create or replace function public.event_pnl(_from date, _to date)
returns table (
  event_id uuid, event_name text, event_date date, client_name text, hotel_name text,
  invoiced numeric, received numeric, expenses numeric
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can view event profitability' using errcode = '42501';
  end if;
  if _from is null or _to is null or _from > _to then
    raise exception 'Invalid date range';
  end if;
  insert into public.audit_logs (user_id, table_name, action, details)
  values (auth.uid(), 'events', 'VIEW_EVENT_PNL', jsonb_build_object('from', _from, 'to', _to));

  return query
  select e.id, e.name, e.event_date, e.client_name, h.name,
         coalesce((select sum(i.amount) from public.invoices i
                    where i.event_id = e.id and i.deleted_at is null and i.voided_at is null), 0),
         coalesce((select sum(p.amount) from public.payments p
                     join public.invoices i on i.id = p.invoice_id
                    where i.event_id = e.id and i.deleted_at is null and i.voided_at is null and p.voided_at is null), 0),
         coalesce((select sum(x.amount) from public.expenses x
                    where x.event_id = e.id and x.deleted_at is null), 0)
    from public.events e
    left join public.hotels h on h.id = e.hotel_id and h.deleted_at is null
   where e.deleted_at is null and e.event_date between _from and _to
   order by e.event_date, e.name;
end $$;

-- Expenses that belong to no event, dated within the range.
create or replace function public.general_expenses_total(_from date, _to date)
returns numeric language plpgsql security definer set search_path = public as $$
declare total numeric;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can view event profitability' using errcode = '42501';
  end if;
  if _from is null or _to is null or _from > _to then
    raise exception 'Invalid date range';
  end if;
  select coalesce(sum(amount), 0) into total from public.expenses
   where event_id is null and deleted_at is null and expense_date between _from and _to;
  return total;
end $$;

create or replace function public.event_pnl_one(_event_id uuid)
returns table (invoiced numeric, received numeric, expenses numeric)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can view event profitability' using errcode = '42501';
  end if;
  insert into public.audit_logs (user_id, table_name, action, record_id, details)
  values (auth.uid(), 'events', 'VIEW_EVENT_PNL', _event_id, jsonb_build_object('event_id', _event_id));

  return query
  select coalesce((select sum(i.amount) from public.invoices i
                    where i.event_id = _event_id and i.deleted_at is null and i.voided_at is null), 0),
         coalesce((select sum(p.amount) from public.payments p
                     join public.invoices i on i.id = p.invoice_id
                    where i.event_id = _event_id and i.deleted_at is null and i.voided_at is null and p.voided_at is null), 0),
         coalesce((select sum(x.amount) from public.expenses x
                    where x.event_id = _event_id and x.deleted_at is null), 0);
end $$;

revoke execute on function public.event_pnl(date, date) from public, anon;
revoke execute on function public.general_expenses_total(date, date) from public, anon;
revoke execute on function public.event_pnl_one(uuid) from public, anon;
grant execute on function public.event_pnl(date, date) to authenticated, service_role;
grant execute on function public.general_expenses_total(date, date) to authenticated, service_role;
grant execute on function public.event_pnl_one(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. RLS / audit: expenses already has staff-only policies with WITH CHECK (security hardening)
--    and an audit trigger; make sure both are still in place.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'expenses' and cmd = 'UPDATE' and with_check is not null) then
    raise exception 'expenses UPDATE policy with WITH CHECK is missing; apply 20261020000000_security_hardening.sql first';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.expenses'::regclass and tgname = 'audit_expenses') then
    create trigger audit_expenses after insert or update or delete on public.expenses
      for each row execute function public.log_change();
  end if;
end $$;
