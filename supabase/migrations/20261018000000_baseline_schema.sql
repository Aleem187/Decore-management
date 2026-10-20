-- BASELINE SCHEMA: the tables, enums, functions, triggers and policies that existed before any file in
-- this folder. Every later migration builds on this one, so on an EMPTY database it must run first.
--
-- It is a verbatim copy of drizzle/migrations/0000_migration.sql (the original Lovable schema) with the
-- guard below added. Nothing here is new: the first-user-becomes-admin trigger, the original policies and
-- grants are all still in place and are replaced, step by step, by 20261020000000_security_hardening.sql.
--
-- EXISTING DATABASES (the project that already has these tables): do NOT run this file. Tell the Supabase CLI
-- it is already applied:   supabase migration repair --status applied 20261018000000
--
-- Needs what every Supabase project has: the auth schema (auth.users, auth.uid()) and the roles
-- anon, authenticated and service_role.

do $$
begin
  if to_regclass('public.events') is not null or to_regclass('public.profiles') is not null then
    raise exception 'The base tables already exist, so this baseline must not run. On an existing database run: supabase migration repair --status applied 20261018000000';
  end if;
end $$;

create type public.app_role as enum ('admin','accountant');
create type public.event_status as enum ('upcoming','in_progress','completed','paid');
create type public.invoice_status as enum ('unpaid','partial','paid','overdue');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  created_at timestamptz not null default now()
);
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role app_role not null,
  unique (user_id, role)
);
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id=_user_id and role=_role)
$$;
create or replace function public.is_staff(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id=_user_id)
$$;

create policy "own or admin read profiles" on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "own update profile" on public.profiles for update to authenticated using (id = auth.uid());
create policy "read own roles or admin" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));

-- first user = admin, rest = accountant
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), new.email);
  if not exists (select 1 from public.user_roles where role='admin') then
    insert into public.user_roles(user_id, role) values (new.id,'admin');
  else
    insert into public.user_roles(user_id, role) values (new.id,'accountant');
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.hotels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  contact_person text,
  contact_phone text,
  hall_name text,
  guidelines text,
  created_at timestamptz not null default now()
);
create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  phone text,
  created_at timestamptz not null default now()
);
create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_date date not null,
  client_name text not null,
  client_phone text,
  hotel_id uuid references public.hotels(id) on delete set null,
  event_type text not null default 'Wedding',
  status event_status not null default 'upcoming',
  estimated_cost numeric(12,2) not null default 0,
  package_price numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null,
  event_id uuid references public.events(id) on delete set null,
  client_name text not null,
  kind text not null default 'Advance',
  amount numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  due_date date,
  status invoice_status not null default 'unpaid',
  created_at timestamptz not null default now()
);
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category text not null,
  description text,
  amount numeric(12,2) not null default 0,
  event_id uuid references public.events(id) on delete set null,
  vendor_id uuid references public.vendors(id) on delete set null,
  paid boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  table_name text not null,
  action text not null,
  record_id uuid,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.hotels, public.vendors, public.events, public.invoices, public.expenses to authenticated;
grant select on public.audit_logs to authenticated;
grant all on public.hotels, public.vendors, public.events, public.invoices, public.expenses, public.audit_logs to service_role;

alter table public.hotels enable row level security;
alter table public.vendors enable row level security;
alter table public.events enable row level security;
alter table public.invoices enable row level security;
alter table public.expenses enable row level security;
alter table public.audit_logs enable row level security;

create policy "staff read hotels" on public.hotels for select to authenticated using (public.is_staff(auth.uid()));
create policy "admin write hotels" on public.hotels for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create policy "staff read events" on public.events for select to authenticated using (public.is_staff(auth.uid()));
create policy "admin write events" on public.events for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create policy "staff all vendors" on public.vendors for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "staff all invoices" on public.invoices for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "staff all expenses" on public.expenses for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "admin read audit" on public.audit_logs for select to authenticated using (public.has_role(auth.uid(),'admin'));

create or replace function public.log_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs(user_id, table_name, action, record_id)
  values (auth.uid(), tg_table_name, tg_op, coalesce(new.id, old.id));
  return coalesce(new, old);
end $$;
create trigger audit_invoices after insert or update or delete on public.invoices for each row execute function public.log_change();
create trigger audit_expenses after insert or update or delete on public.expenses for each row execute function public.log_change();
create trigger audit_vendors after insert or update or delete on public.vendors for each row execute function public.log_change();
create trigger audit_events after insert or update or delete on public.events for each row execute function public.log_change();
create trigger audit_hotels after insert or update or delete on public.hotels for each row execute function public.log_change();

-- auto invoice status
create or replace function public.set_invoice_status()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.amount_paid >= new.amount and new.amount > 0 then new.status := 'paid';
  elsif new.amount_paid > 0 then new.status := 'partial';
  elsif new.due_date is not null and new.due_date < current_date then new.status := 'overdue';
  else new.status := 'unpaid';
  end if;
  return new;
end $$;
create trigger invoice_status before insert or update on public.invoices for each row execute function public.set_invoice_status();
