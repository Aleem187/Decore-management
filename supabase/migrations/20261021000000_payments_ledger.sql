-- Payments ledger: invoices.amount_paid becomes a calculated value.
-- Depends on 20261020000000_security_hardening.sql. Back up before applying.
-- Nothing is dropped: the amount_paid column stays, but only the database can change it.

-- ---------------------------------------------------------------------------
-- 0. Pre-flight
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from public.invoices where amount_paid > amount;
  if n > 0 then
    raise exception '% invoice(s) have amount_paid above the invoice total. Fix them first: select invoice_no, amount, amount_paid from public.invoices where amount_paid > amount;', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('cash', 'bank', 'jazzcash', 'easypaisa', 'cheque')),
  reference_no text,
  paid_at date not null default current_date,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text,
  void_by uuid,
  constraint payments_void_fields_together check (
    (voided_at is null and void_by is null and void_reason is null)
    or (voided_at is not null and void_by is not null and length(btrim(coalesce(void_reason, ''))) > 0)
  )
);
create index payments_invoice_id_idx on public.payments (invoice_id);

-- ---------------------------------------------------------------------------
-- 2. Insert rules: stamp the author, block anything that exceeds the balance
-- ---------------------------------------------------------------------------
create or replace function public.payments_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare inv record; already numeric;
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.created_at := now();
  new.voided_at := null; new.void_by := null; new.void_reason := null;

  -- Lock the invoice so two simultaneous payments cannot both squeeze under the limit.
  select amount, voided_at, deleted_at into inv from public.invoices where id = new.invoice_id for update;
  if not found or inv.deleted_at is not null then
    raise exception 'Invoice not found' using errcode = 'foreign_key_violation';
  end if;
  if inv.voided_at is not null then
    raise exception 'Cannot record a payment on a voided invoice';
  end if;

  select coalesce(sum(amount), 0) into already
    from public.payments where invoice_id = new.invoice_id and voided_at is null;
  if new.amount > inv.amount - already then
    raise exception 'Payment of % exceeds the remaining balance of %', new.amount, inv.amount - already
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger payments_before_insert before insert on public.payments
  for each row execute function public.payments_before_insert();

-- ---------------------------------------------------------------------------
-- 3. Immutable: the only change ever allowed is void_payment() filling the void fields
-- ---------------------------------------------------------------------------
create or replace function public.payments_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'Payments cannot be deleted. An admin can void a payment instead.' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.void_payment', true), '') <> 'on' then
    raise exception 'Payments cannot be edited. An admin can void a payment instead.' using errcode = '42501';
  end if;
  if old.voided_at is not null then
    raise exception 'Payment is already voided' using errcode = '42501';
  end if;
  if (new.id, new.invoice_id, new.amount, new.method, new.reference_no, new.paid_at, new.note, new.created_by, new.created_at)
     is distinct from
     (old.id, old.invoice_id, old.amount, old.method, old.reference_no, old.paid_at, old.note, old.created_by, old.created_at) then
    raise exception 'Only the void fields of a payment can change' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger payments_immutable before update or delete on public.payments
  for each row execute function public.payments_immutable();
create trigger payments_no_truncate before truncate on public.payments
  for each statement execute function public.payments_immutable();

-- ---------------------------------------------------------------------------
-- 4. Invoice totals come from payments; nobody writes amount_paid / status directly
-- ---------------------------------------------------------------------------
create or replace function public.invoice_before_write()
returns trigger language plpgsql set search_path = public as $$
declare items_total numeric;
begin
  if tg_op = 'UPDATE' and old.voided_at is not null and new.voided_at is not null
     and (new.amount, new.invoice_no, new.client_name)
         is distinct from (old.amount, old.invoice_no, old.client_name) then
    raise exception 'A voided invoice cannot be edited';
  end if;

  if tg_op = 'UPDATE' then
    -- With line items, the invoice total is always their sum.
    select sum(quantity * unit_price) into items_total
      from public.invoice_items where invoice_id = new.id and deleted_at is null;
    if items_total is not null then new.amount := round(items_total, 2); end if;

    -- amount_paid is always the sum of non-voided payments.
    select coalesce(sum(amount), 0) into new.amount_paid
      from public.payments where invoice_id = new.id and voided_at is null;
  else
    new.amount_paid := 0;
  end if;

  if new.amount_paid > new.amount then
    raise exception 'Invoice total % cannot be lower than the % already paid', new.amount, new.amount_paid
      using errcode = 'check_violation';
  end if;

  new.status := public.compute_invoice_status(new.amount, new.amount_paid, new.due_date);
  return new;
end $$;

-- After a payment is added or voided, touch the invoice so the trigger above recalculates it.
create or replace function public.payments_recalc_invoice()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.invoices set amount = amount where id = new.invoice_id;
  return new;
end $$;
create trigger payments_recalc_invoice after insert or update on public.payments
  for each row execute function public.payments_recalc_invoice();

-- ---------------------------------------------------------------------------
-- 5. Migrate existing amount_paid into one opening-balance payment per invoice
--    (triggers off just for this insert; the pre-flight above guarantees they fit)
-- ---------------------------------------------------------------------------
alter table public.payments disable trigger user;
insert into public.payments (invoice_id, amount, method, reference_no, paid_at, note, created_by)
select id, amount_paid, 'cash', 'MIGRATED', created_at::date, 'Opening balance (migrated)', null
  from public.invoices where amount_paid > 0;
alter table public.payments enable trigger user;

-- Sanity check: ledger totals must equal the old stored values.
do $$
declare n int;
begin
  select count(*) into n from public.invoices i
   where i.amount_paid <> coalesce((select sum(p.amount) from public.payments p where p.invoice_id = i.id and p.voided_at is null), 0);
  if n > 0 then raise exception 'Migration check failed: % invoice(s) do not match their payments', n; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Voiding (admin only, audited)
-- ---------------------------------------------------------------------------
alter table public.audit_logs add column if not exists details jsonb;

create or replace function public.void_payment(_id uuid, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare p public.payments;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can void payments' using errcode = '42501';
  end if;
  if length(btrim(coalesce(_reason, ''))) < 3 then
    raise exception 'A reason of at least 3 characters is required';
  end if;
  select * into p from public.payments where id = _id for update;
  if not found then raise exception 'Payment not found'; end if;
  if p.voided_at is not null then raise exception 'Payment is already voided'; end if;

  perform set_config('app.void_payment', 'on', true);
  update public.payments
     set voided_at = now(), void_by = auth.uid(), void_reason = btrim(_reason)
   where id = _id;
  perform set_config('app.void_payment', 'off', true);

  insert into public.audit_logs (user_id, table_name, action, record_id, details)
  values (auth.uid(), 'payments', 'VOID_PAYMENT', _id,
          jsonb_build_object('reason', btrim(_reason), 'invoice_id', p.invoice_id, 'amount', p.amount));
end $$;
revoke execute on function public.void_payment(uuid, text) from public, anon;
grant execute on function public.void_payment(uuid, text) to authenticated, service_role;

create trigger audit_payments after insert or update on public.payments
  for each row execute function public.log_change();

-- ---------------------------------------------------------------------------
-- 7. Privileges and RLS
-- ---------------------------------------------------------------------------
revoke all on public.payments from anon, authenticated;
grant select, insert on public.payments to authenticated;
grant select, insert on public.payments to service_role;

-- Accountants (and admins) can no longer write amount_paid or status at all.
revoke insert, update on public.invoices from authenticated;
grant insert (invoice_no, event_id, client_name, kind, amount, due_date) on public.invoices to authenticated;
grant update (invoice_no, event_id, client_name, kind, amount, due_date) on public.invoices to authenticated;

alter table public.payments enable row level security;
create policy payments_select on public.payments for select to authenticated
  using (public.is_staff(auth.uid()) and exists (select 1 from public.invoices i where i.id = invoice_id));
create policy payments_insert on public.payments for insert to authenticated
  with check (public.is_staff(auth.uid()) and voided_at is null);
-- No update or delete policy: payments are immutable through the API.
