-- Clients module. Depends on the security hardening and payments ledger migrations.
-- Existing columns (events.client_name, events.client_phone, invoices.client_name) are NOT changed or dropped.
-- Back up before applying; review the "linked by name" summary notices it prints.

-- ---------------------------------------------------------------------------
-- 1. Phone normaliser: Pakistan format 92xxxxxxxxxx (12 digits) or NULL when unusable.
--    Keep in sync with normalizePkPhone() in src/lib/phone.ts.
-- ---------------------------------------------------------------------------
create or replace function public.normalize_pk_phone(_raw text)
returns text language plpgsql immutable set search_path = public as $$
declare d text;
begin
  if _raw is null then return null; end if;
  d := regexp_replace(_raw, '\D', '', 'g');
  if d like '0092%' then d := substr(d, 3); end if;                        -- 0092 300 ...
  if d ~ '^92[0-9]{10}$' then return d; end if;                             -- 92 300 1234567
  if d ~ '^920[0-9]{10}$' then return '92' || substr(d, 4); end if;         -- +92 (0)300 ...
  if d ~ '^0[0-9]{10}$' then return '92' || substr(d, 2); end if;           -- 0300 1234567
  if d ~ '^3[0-9]{9}$' then return '92' || d; end if;                       -- 300 1234567
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. clients
-- ---------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  phone text check (phone is null or phone ~ '^92[0-9]{10}$'),
  whatsapp text check (whatsapp is null or whatsapp ~ '^92[0-9]{10}$'),
  email text check (email is null or (length(email) <= 254 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  address text check (address is null or length(address) <= 500),
  notes text check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);
create index clients_name_idx on public.clients (lower(name));
create index clients_created_at_idx on public.clients (created_at desc);

-- Author is stamped by the database; phone numbers are normalised here too, so no client can bypass the format.
create or replace function public.clients_before_write()
returns trigger language plpgsql set search_path = public as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.phone := nullif(btrim(coalesce(new.phone, '')), '');
  new.whatsapp := nullif(btrim(coalesce(new.whatsapp, '')), '');
  new.email := nullif(btrim(coalesce(new.email, '')), '');
  if new.phone is not null then
    new.phone := public.normalize_pk_phone(new.phone);
    if new.phone is null then raise exception 'Invalid phone number. Use a Pakistani number like 0300 1234567.' using errcode = 'check_violation'; end if;
  end if;
  if new.whatsapp is not null then
    new.whatsapp := public.normalize_pk_phone(new.whatsapp);
    if new.whatsapp is null then raise exception 'Invalid WhatsApp number. Use a Pakistani number like 0300 1234567.' using errcode = 'check_violation'; end if;
  end if;
  return new;
end $$;
create trigger clients_before_write before insert or update on public.clients
  for each row execute function public.clients_before_write();

-- ---------------------------------------------------------------------------
-- 3. Link columns (nullable, additive)
-- ---------------------------------------------------------------------------
alter table public.events add column client_id uuid references public.clients(id) on delete restrict;
alter table public.invoices add column client_id uuid references public.clients(id) on delete restrict;
create index events_client_id_idx on public.events (client_id);
create index invoices_client_id_idx on public.invoices (client_id);

-- ---------------------------------------------------------------------------
-- 4. Backfill from existing names (safe: only runs on an empty clients table).
--    One client per distinct name (case/space-insensitive). Two different people who share a
--    name are merged into one client: review the result. Phone comes from the newest event that has a valid one.
-- ---------------------------------------------------------------------------
alter table public.events disable trigger user;
alter table public.invoices disable trigger user;

do $$
declare made int := 0; ev int := 0; inv int := 0;
begin
  if not exists (select 1 from public.clients) then
    insert into public.clients (name, phone)
    select distinct on (lower(btrim(s.client_name))) btrim(s.client_name), public.normalize_pk_phone(s.client_phone)
      from (
        select client_name, client_phone, created_at from public.events where deleted_at is null
        union all
        select client_name, null::text, created_at from public.invoices where deleted_at is null
      ) s
     where btrim(coalesce(s.client_name, '')) <> ''
     order by lower(btrim(s.client_name)), (public.normalize_pk_phone(s.client_phone) is not null) desc, s.created_at desc;
    get diagnostics made = row_count;

    update public.events e set client_id = c.id
      from public.clients c
     where e.client_id is null and lower(btrim(e.client_name)) = lower(btrim(c.name));
    get diagnostics ev = row_count;

    update public.invoices i set client_id = c.id
      from public.clients c
     where i.client_id is null and lower(btrim(i.client_name)) = lower(btrim(c.name));
    get diagnostics inv = row_count;
  end if;
  raise notice 'Clients backfill: % clients created, % events and % invoices linked by name', made, ev, inv;
end $$;

alter table public.events enable trigger user;
alter table public.invoices enable trigger user;

-- ---------------------------------------------------------------------------
-- 5. Keep the existing name/phone columns in step with the linked client
-- ---------------------------------------------------------------------------
create or replace function public.events_sync_client()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record;
begin
  -- Only when the link is new or changed, so editing an event of a since-deleted client keeps working.
  if new.client_id is not null and (tg_op = 'INSERT' or new.client_id is distinct from old.client_id) then
    select name, phone into c from public.clients where id = new.client_id and deleted_at is null;
    if not found then raise exception 'Client not found'; end if;
    new.client_name := c.name;
    new.client_phone := coalesce(c.phone, new.client_phone);
  end if;
  if btrim(coalesce(new.client_name, '')) = '' then
    raise exception 'Select a client or enter a client name' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger events_sync_client before insert or update on public.events
  for each row execute function public.events_sync_client();

create or replace function public.invoices_sync_client()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if new.client_id is not null and (tg_op = 'INSERT' or new.client_id is distinct from old.client_id) then
    select name into c from public.clients where id = new.client_id and deleted_at is null;
    if not found then raise exception 'Client not found'; end if;
    new.client_name := c.name;
  end if;
  if btrim(coalesce(new.client_name, '')) = '' then
    raise exception 'Select a client or enter a client name' using errcode = 'check_violation';
  end if;
  return new;
end $$;
-- Named so it fires before invoice_before_write (alphabetical order).
create trigger invoice_a_sync_client before insert or update on public.invoices
  for each row execute function public.invoices_sync_client();

-- Renaming a client updates the copied name on their events and open invoices (void invoices are frozen).
create or replace function public.clients_propagate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.name is distinct from old.name or new.phone is distinct from old.phone then
    update public.events set client_name = new.name, client_phone = coalesce(new.phone, client_phone) where client_id = new.id;
  end if;
  if new.name is distinct from old.name then
    update public.invoices set client_name = new.name where client_id = new.id and voided_at is null;
  end if;
  return new;
end $$;
create trigger clients_propagate after update on public.clients
  for each row execute function public.clients_propagate();

-- ---------------------------------------------------------------------------
-- 6. Delete / audit
-- ---------------------------------------------------------------------------
create trigger guard_admin_columns before update on public.clients
  for each row execute function public.guard_admin_columns();
create trigger audit_clients after insert or update or delete on public.clients
  for each row execute function public.log_change();

create or replace function public.soft_delete(_table text, _id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can delete records' using errcode = '42501';
  end if;
  if _table not in ('hotels','vendors','events','invoices','expenses','vendor_payments','event_materials','invoice_items','clients') then
    raise exception 'Unsupported table %', _table;
  end if;
  execute format('update public.%I set deleted_at = now(), deleted_by = auth.uid() where id = $1 and deleted_at is null', _table)
    using _id;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Privileges and RLS
-- ---------------------------------------------------------------------------
revoke all on public.clients from anon, authenticated;
grant select on public.clients to authenticated;
grant insert (name, phone, whatsapp, email, address, notes) on public.clients to authenticated;
grant update (name, phone, whatsapp, email, address, notes) on public.clients to authenticated;
grant all on public.clients to service_role;

-- invoices has column-level grants since the payments ledger: add the new column.
grant insert (client_id), update (client_id) on public.invoices to authenticated;

alter table public.clients enable row level security;
create policy clients_select on public.clients for select to authenticated
  using (public.is_staff(auth.uid()) and deleted_at is null);
create policy clients_insert on public.clients for insert to authenticated
  with check (public.is_staff(auth.uid()) and deleted_at is null);
create policy clients_update on public.clients for update to authenticated
  using (public.is_staff(auth.uid()) and deleted_at is null)
  with check (public.is_staff(auth.uid()));
-- No delete policy and no delete grant: removal is soft_delete(), admin only.
