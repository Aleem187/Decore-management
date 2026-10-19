-- Staff module: staff members (no login), attendance, advances and salary payouts.
-- Depends on the earlier migrations (security hardening ... events calendar). Back up before applying.
-- Additive only: no column is dropped; event_staff.staff_id only loses its NOT NULL so a row can
-- point at a staff member instead of a login user.
--
-- SALARY RULES (the same numbers are produced by src/lib/salary.ts):
--   present = 1 day worked, half_day = 0.5, absent and leave = 0 (all leave is unpaid).
--   Daily wage:  earned = days worked x rate.
--   Monthly:     earned = rate - deduction, where deduction = (absent + leave + 0.5 x half_day
--                + days before the joining date in the joining month, max 30) x rate / 30,
--                never more than the rate. Days with no attendance mark are NOT deducted.
--                A staff member who joins after the month ends earns 0 for it.
--   Advances:    outstanding = advances given up to the end of the month - advances already recovered
--                by earlier payouts. Recovered now = min(outstanding, earned + bonus), so net pay is
--                never negative and any remainder carries forward.
--   Net pay = earned + bonus - advance recovered. Amounts are rounded to 2 decimals once, at the end.

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------
-- CNIC: 13 digits, stored as 12345-1234567-1. NULL when it is not 13 digits.
create or replace function public.normalize_cnic(_raw text)
returns text language plpgsql immutable set search_path = public as $$
declare d text;
begin
  if _raw is null then return null; end if;
  d := regexp_replace(_raw, '\D', '', 'g');
  if length(d) <> 13 then return null; end if;
  return substr(d, 1, 5) || '-' || substr(d, 6, 7) || '-' || substr(d, 13, 1);
end $$;

-- "today" in Pakistan, whatever time zone the database runs in
create or replace function public.karachi_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'Asia/Karachi')::date
$$;

-- ---------------------------------------------------------------------------
-- 2. staff
-- ---------------------------------------------------------------------------
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  job_title text not null default 'Helper' check (length(btrim(job_title)) between 1 and 60),
  phone text check (phone is null or phone ~ '^92[0-9]{10}$'),
  cnic text check (cnic is null or cnic ~ '^[0-9]{5}-[0-9]{7}-[0-9]$'),
  salary_type text not null default 'monthly' check (salary_type in ('monthly', 'daily_wage')),
  rate numeric(12,2) not null default 0 check (rate >= 0),
  joining_date date,
  active boolean not null default true,
  notes text check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);
create index staff_name_idx on public.staff (lower(name));
create unique index staff_cnic_key on public.staff (cnic) where cnic is not null and deleted_at is null;

create or replace function public.staff_before_write()
returns trigger language plpgsql set search_path = public as $$
begin
  new.name := btrim(new.name);
  new.job_title := btrim(new.job_title);
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.phone := nullif(btrim(coalesce(new.phone, '')), '');
  if new.phone is not null then
    new.phone := public.normalize_pk_phone(new.phone);
    if new.phone is null then raise exception 'Invalid phone number. Use a Pakistani number like 0300 1234567.' using errcode = 'check_violation'; end if;
  end if;
  new.cnic := nullif(btrim(coalesce(new.cnic, '')), '');
  if new.cnic is not null then
    new.cnic := public.normalize_cnic(new.cnic);
    if new.cnic is null then raise exception 'Invalid CNIC. It must have 13 digits, like 35202-1234567-1.' using errcode = 'check_violation'; end if;
  end if;
  return new;
end $$;
create trigger staff_before_write before insert or update on public.staff
  for each row execute function public.staff_before_write();

-- ---------------------------------------------------------------------------
-- 3. Event assignments can point at a staff member (login-user rows keep working)
-- ---------------------------------------------------------------------------
alter table public.event_staff add column staff_member_id uuid references public.staff(id) on delete cascade;
alter table public.event_staff alter column staff_id drop not null;
alter table public.event_staff add constraint event_staff_one_person
  check ((staff_id is null) <> (staff_member_id is null));
create unique index event_staff_event_member_key on public.event_staff (event_id, staff_member_id) where staff_member_id is not null;
create index event_staff_staff_member_id_idx on public.event_staff (staff_member_id);

create or replace function public.event_staff_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.role := btrim(new.role);
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    if not exists (select 1 from public.events where id = new.event_id and deleted_at is null) then
      raise exception 'Event not found' using errcode = 'check_violation';
    end if;
    if new.staff_member_id is not null then
      if not exists (select 1 from public.staff where id = new.staff_member_id and deleted_at is null and active) then
        raise exception 'That staff member is not active' using errcode = 'check_violation';
      end if;
    elsif not public.is_staff(new.staff_id) then
      raise exception 'That person is not an active team member' using errcode = 'check_violation';
    end if;
  else
    if new.event_id <> old.event_id
       or new.staff_id is distinct from old.staff_id
       or new.staff_member_id is distinct from old.staff_member_id then
      raise exception 'Remove the assignment and add a new one instead' using errcode = 'check_violation';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

grant insert (staff_member_id) on public.event_staff to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Attendance: one mark per person per day
-- ---------------------------------------------------------------------------
create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  work_date date not null,
  status text not null check (status in ('present', 'absent', 'half_day', 'leave')),
  event_id uuid references public.events(id) on delete set null,
  note text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  constraint attendance_one_per_day unique (staff_id, work_date)
);
create index attendance_work_date_idx on public.attendance (work_date);
create index attendance_event_id_idx on public.attendance (event_id);

create or replace function public.attendance_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    if not exists (select 1 from public.staff where id = new.staff_id and deleted_at is null) then
      raise exception 'Staff member not found' using errcode = 'check_violation';
    end if;
  else
    if new.staff_id <> old.staff_id or new.work_date <> old.work_date then
      raise exception 'Change the status instead of moving a mark to another person or day' using errcode = 'check_violation';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  if new.work_date > public.karachi_today() then
    raise exception 'Attendance cannot be marked for a future date' using errcode = 'check_violation';
  end if;
  if new.event_id is not null and (tg_op = 'INSERT' or new.event_id is distinct from old.event_id) then
    if not exists (select 1 from public.events where id = new.event_id and deleted_at is null) then
      raise exception 'The linked event was not found' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger attendance_before_write before insert or update on public.attendance
  for each row execute function public.attendance_before_write();

-- ---------------------------------------------------------------------------
-- 5. Generated expenses ("Salary" category). One expense per advance and per payout,
--    so the dashboard (which reads expenses only) counts every rupee once.
-- ---------------------------------------------------------------------------
alter table public.expenses add column if not exists source_table text;
alter table public.expenses add column if not exists source_id uuid;
create unique index if not exists expenses_source_key on public.expenses (source_table, source_id) where source_table is not null;

-- Generated expenses change only through the salary functions.
create or replace function public.expenses_protect_generated()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.source_table is not null and coalesce(current_setting('app.salary_sync', true), '') <> 'on' then
    raise exception 'This expense comes from a salary record. Void the salary payment or advance instead of editing it here.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists expenses_protect_generated on public.expenses;
create trigger expenses_protect_generated before update on public.expenses
  for each row execute function public.expenses_protect_generated();

-- ---------------------------------------------------------------------------
-- 6. Advances. Staff add them (amount cannot be edited), admins delete (soft) them.
-- ---------------------------------------------------------------------------
create table public.staff_advances (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  given_on date not null default current_date,
  note text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now(),
  created_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);
create index staff_advances_staff_idx on public.staff_advances (staff_id, given_on);

-- Total of advances recovered by (non-voided) payouts (plpgsql: salary_payments is created further down)
create or replace function public.advance_recovered(_staff_id uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
begin
  return (select coalesce(sum(advance_deducted), 0) from public.salary_payments where staff_id = _staff_id and voided_at is null);
end $$;

create or replace function public.staff_advances_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    if not exists (select 1 from public.staff where id = new.staff_id and deleted_at is null) then
      raise exception 'Staff member not found' using errcode = 'check_violation';
    end if;
    if new.given_on > public.karachi_today() then
      raise exception 'An advance cannot be dated in the future' using errcode = 'check_violation';
    end if;
  else
    if (new.staff_id, new.amount, new.given_on) is distinct from (old.staff_id, old.amount, old.given_on) then
      raise exception 'An advance cannot be edited. Ask an admin to delete it and add it again.' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
create trigger staff_advances_before_write before insert or update on public.staff_advances
  for each row execute function public.staff_advances_before_write();
create trigger guard_admin_columns before update on public.staff_advances
  for each row execute function public.guard_admin_columns();
create trigger guard_admin_columns before update on public.staff
  for each row execute function public.guard_admin_columns();

-- Cash leaves the business when an advance is handed over: book it under "Salary".
create or replace function public.staff_advances_expense()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  select name into who from public.staff where id = new.staff_id;
  if tg_op = 'INSERT' then
    insert into public.expenses (category, description, amount, expense_date, paid, source_table, source_id)
    values ('Salary', 'Salary advance - ' || who, new.amount, new.given_on, true, 'staff_advances', new.id);
  elsif new.deleted_at is not null and old.deleted_at is null then
    perform set_config('app.salary_sync', 'on', true);
    update public.expenses set deleted_at = now(), deleted_by = auth.uid()
     where source_table = 'staff_advances' and source_id = new.id and deleted_at is null;
    perform set_config('app.salary_sync', 'off', true);
  end if;
  return new;
end $$;
create trigger staff_advances_expense after insert or update on public.staff_advances
  for each row execute function public.staff_advances_expense();

-- ---------------------------------------------------------------------------
-- 7. Salary payments: immutable, created only by record_salary_payment()
-- ---------------------------------------------------------------------------
create table public.salary_payments (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  period_month date not null check (extract(day from period_month) = 1),
  gross numeric(12,2) not null check (gross >= 0),
  bonus numeric(12,2) not null default 0 check (bonus >= 0),
  advance_deducted numeric(12,2) not null default 0 check (advance_deducted >= 0),
  amount numeric(12,2) not null check (amount >= 0),
  method text not null check (method in ('cash', 'bank', 'jazzcash', 'easypaisa', 'cheque')),
  reference_no text,
  paid_on date not null default current_date,
  note text,
  calc jsonb not null,
  expense_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text,
  void_by uuid,
  constraint salary_amount_adds_up check (amount = gross + bonus - advance_deducted),
  constraint salary_void_fields_together check (
    (voided_at is null and void_by is null and void_reason is null)
    or (voided_at is not null and void_by is not null and length(btrim(coalesce(void_reason, ''))) > 0)
  )
);
create unique index salary_one_payout_per_month on public.salary_payments (staff_id, period_month) where voided_at is null;
create index salary_payments_staff_idx on public.salary_payments (staff_id, period_month);

create or replace function public.salary_payments_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'Salary payments cannot be deleted. An admin can void one instead.' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.void_salary_payment', true), '') <> 'on' then
    raise exception 'Salary payments cannot be edited. An admin can void one instead.' using errcode = '42501';
  end if;
  if old.voided_at is not null then
    raise exception 'Payment is already voided' using errcode = '42501';
  end if;
  if (new.id, new.staff_id, new.period_month, new.gross, new.bonus, new.advance_deducted, new.amount, new.method,
      new.reference_no, new.paid_on, new.note, new.calc, new.expense_id, new.created_by, new.created_at)
     is distinct from
     (old.id, old.staff_id, old.period_month, old.gross, old.bonus, old.advance_deducted, old.amount, old.method,
      old.reference_no, old.paid_on, old.note, old.calc, old.expense_id, old.created_by, old.created_at) then
    raise exception 'Only the void fields of a salary payment can change' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger salary_payments_immutable before update or delete on public.salary_payments
  for each row execute function public.salary_payments_immutable();
create trigger salary_payments_no_truncate before truncate on public.salary_payments
  for each statement execute function public.salary_payments_immutable();

-- An advance that a payout already recovered cannot be deleted (it would make the books negative).
create or replace function public.staff_advances_check_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare remaining numeric;
begin
  if new.deleted_at is not null and old.deleted_at is null then
    select coalesce(sum(amount), 0) into remaining from public.staff_advances
     where staff_id = new.staff_id and deleted_at is null and id <> new.id;
    if remaining < public.advance_recovered(new.staff_id) then
      raise exception 'This advance was already recovered from a salary payout. Void that payout first.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger staff_advances_check_delete before update on public.staff_advances
  for each row execute function public.staff_advances_check_delete();

-- ---------------------------------------------------------------------------
-- 8. Salary calculation and payout
-- ---------------------------------------------------------------------------
create or replace function public.staff_salary_calc(_staff_id uuid, _month date, _bonus numeric default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.staff;
  m date := date_trunc('month', _month)::date;
  mend date := (date_trunc('month', _month) + interval '1 month' - interval '1 day')::date;
  n_present int; n_half int; n_absent int; n_leave int;
  days2 int; ded2 int; pre_join int := 0; total2 int;
  gross numeric; outstanding numeric; recovered numeric; net numeric; bonus numeric := coalesce(_bonus, 0);
begin
  if auth.uid() is null or not public.is_staff(auth.uid()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if bonus < 0 then raise exception 'Bonus cannot be negative' using errcode = 'check_violation'; end if;
  select * into s from public.staff where id = _staff_id and deleted_at is null;
  if not found then raise exception 'Staff member not found'; end if;

  select count(*) filter (where status = 'present'), count(*) filter (where status = 'half_day'),
         count(*) filter (where status = 'absent'), count(*) filter (where status = 'leave')
    into n_present, n_half, n_absent, n_leave
    from public.attendance where staff_id = _staff_id and work_date between m and mend;

  days2 := 2 * n_present + n_half;               -- days worked x 2
  ded2 := 2 * n_absent + 2 * n_leave + n_half;   -- unpaid days x 2

  if s.salary_type = 'daily_wage' then
    gross := round(days2 * s.rate / 2, 2);
  elsif s.joining_date is not null and s.joining_date > mend then
    gross := 0;
  else
    if s.joining_date is not null and s.joining_date >= m then
      pre_join := least(extract(day from s.joining_date)::int - 1, 30);
    end if;
    total2 := 2 * pre_join + ded2;
    gross := s.rate - least(s.rate, round(total2 * s.rate / 60, 2));
  end if;

  select coalesce(sum(amount), 0) into outstanding from public.staff_advances
   where staff_id = _staff_id and deleted_at is null and given_on <= mend;
  outstanding := greatest(outstanding - public.advance_recovered(_staff_id), 0);
  recovered := least(outstanding, gross + bonus);
  net := gross + bonus - recovered;

  return jsonb_build_object(
    'salary_type', s.salary_type, 'rate', s.rate,
    'present', n_present, 'half_days', n_half, 'absent', n_absent, 'leave', n_leave,
    'days_worked', days2 / 2.0, 'unpaid_days', ded2 / 2.0, 'pre_join_days', pre_join,
    'gross', gross, 'bonus', bonus, 'outstanding_advance', outstanding,
    'advance_deducted', recovered, 'net', net, 'advance_carried_forward', outstanding - recovered);
end $$;

create or replace function public.record_salary_payment(
  _staff_id uuid, _month date, _bonus numeric, _expected_net numeric,
  _method text, _reference_no text, _paid_on date, _note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  m date := date_trunc('month', _month)::date;
  calc jsonb; pid uuid := gen_random_uuid(); eid uuid; who text; net numeric;
begin
  if auth.uid() is null or not public.is_staff(auth.uid()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if m > date_trunc('month', public.karachi_today())::date then
    raise exception 'A future month cannot be paid yet' using errcode = 'check_violation';
  end if;
  -- serialise payouts for one person
  select name into who from public.staff where id = _staff_id and deleted_at is null for update;
  if not found then raise exception 'Staff member not found'; end if;
  if exists (select 1 from public.salary_payments where staff_id = _staff_id and period_month = m and voided_at is null) then
    raise exception 'This month is already paid. An admin must void the payment before it can be paid again.' using errcode = 'unique_violation';
  end if;

  calc := public.staff_salary_calc(_staff_id, m, _bonus);
  net := (calc->>'net')::numeric;
  if _expected_net is null or net <> _expected_net then
    raise exception 'The figures changed since you reviewed them (you saw %, it is now %). Reload and review again.', _expected_net, net;
  end if;

  if net > 0 then eid := gen_random_uuid(); end if;
  insert into public.salary_payments (id, staff_id, period_month, gross, bonus, advance_deducted, amount, method, reference_no, paid_on, note, calc, expense_id, created_by)
  values (pid, _staff_id, m, (calc->>'gross')::numeric, (calc->>'bonus')::numeric, (calc->>'advance_deducted')::numeric, net,
          _method, nullif(btrim(coalesce(_reference_no, '')), ''), coalesce(_paid_on, public.karachi_today()),
          nullif(btrim(coalesce(_note, '')), ''), calc, eid, auth.uid());
  if eid is not null then
    insert into public.expenses (id, category, description, amount, expense_date, paid, source_table, source_id)
    values (eid, 'Salary', 'Salary ' || to_char(m, 'Mon YYYY') || ' - ' || who, net, coalesce(_paid_on, public.karachi_today()), true, 'salary_payments', pid);
  end if;
  return pid;
end $$;

alter table public.audit_logs add column if not exists details jsonb;

create or replace function public.void_salary_payment(_id uuid, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare p public.salary_payments;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can void salary payments' using errcode = '42501';
  end if;
  if length(btrim(coalesce(_reason, ''))) < 3 then
    raise exception 'A reason of at least 3 characters is required';
  end if;
  select * into p from public.salary_payments where id = _id for update;
  if not found then raise exception 'Salary payment not found'; end if;
  if p.voided_at is not null then raise exception 'Payment is already voided'; end if;

  perform set_config('app.void_salary_payment', 'on', true);
  update public.salary_payments set voided_at = now(), void_by = auth.uid(), void_reason = btrim(_reason) where id = _id;
  perform set_config('app.void_salary_payment', 'off', true);

  if p.expense_id is not null then
    perform set_config('app.salary_sync', 'on', true);
    update public.expenses set deleted_at = now(), deleted_by = auth.uid() where id = p.expense_id and deleted_at is null;
    perform set_config('app.salary_sync', 'off', true);
  end if;

  insert into public.audit_logs (user_id, table_name, action, record_id, details)
  values (auth.uid(), 'salary_payments', 'VOID_SALARY_PAYMENT', _id,
          jsonb_build_object('reason', btrim(_reason), 'staff_id', p.staff_id, 'month', p.period_month, 'amount', p.amount));
end $$;

revoke execute on function public.staff_salary_calc(uuid, date, numeric) from public, anon;
revoke execute on function public.record_salary_payment(uuid, date, numeric, numeric, text, text, date, text) from public, anon;
revoke execute on function public.void_salary_payment(uuid, text) from public, anon;
revoke execute on function public.advance_recovered(uuid) from public, anon, authenticated;
grant execute on function public.staff_salary_calc(uuid, date, numeric) to authenticated, service_role;
grant execute on function public.record_salary_payment(uuid, date, numeric, numeric, text, text, date, text) to authenticated, service_role;
grant execute on function public.void_salary_payment(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Delete (soft) support for staff and advances
-- ---------------------------------------------------------------------------
create or replace function public.soft_delete(_table text, _id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can delete records' using errcode = '42501';
  end if;
  if _table not in ('hotels','vendors','events','invoices','expenses','vendor_payments','event_materials','invoice_items','clients','staff','staff_advances') then
    raise exception 'Unsupported table %', _table;
  end if;
  execute format('update public.%I set deleted_at = now(), deleted_by = auth.uid() where id = $1 and deleted_at is null', _table)
    using _id;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Audit triggers
-- ---------------------------------------------------------------------------
create trigger audit_staff after insert or update or delete on public.staff for each row execute function public.log_change();
create trigger audit_attendance after insert or update or delete on public.attendance for each row execute function public.log_change();
create trigger audit_staff_advances after insert or update or delete on public.staff_advances for each row execute function public.log_change();
create trigger audit_salary_payments after insert or update on public.salary_payments for each row execute function public.log_change();

-- ---------------------------------------------------------------------------
-- 11. Privileges and RLS
--     Admin: everything. Accountant: reads everything (including rates and salaries), marks attendance,
--     adds advances and records salary payments; no deleting, voiding or staff-record changes.
-- ---------------------------------------------------------------------------
revoke all on public.staff, public.attendance, public.staff_advances, public.salary_payments from anon, authenticated;

grant select on public.staff, public.attendance, public.staff_advances, public.salary_payments to authenticated;
grant insert (name, job_title, phone, cnic, salary_type, rate, joining_date, active, notes) on public.staff to authenticated;
grant update (name, job_title, phone, cnic, salary_type, rate, joining_date, active, notes) on public.staff to authenticated;
grant insert (staff_id, work_date, status, event_id, note) on public.attendance to authenticated;
grant update (status, event_id, note) on public.attendance to authenticated;
grant delete on public.attendance to authenticated;
grant insert (staff_id, amount, given_on, note) on public.staff_advances to authenticated;
grant update (note) on public.staff_advances to authenticated;
grant all on public.staff, public.attendance, public.staff_advances to service_role;
grant select, insert on public.salary_payments to service_role;
-- salary_payments: no insert/update/delete for authenticated; rows come from record_salary_payment()

alter table public.staff enable row level security;
alter table public.attendance enable row level security;
alter table public.staff_advances enable row level security;
alter table public.salary_payments enable row level security;

create policy staff_select on public.staff for select to authenticated
  using (public.is_staff(auth.uid()) and deleted_at is null);
create policy staff_insert on public.staff for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin') and deleted_at is null);
create policy staff_update on public.staff for update to authenticated
  using (public.has_role(auth.uid(), 'admin') and deleted_at is null)
  with check (public.has_role(auth.uid(), 'admin'));

create policy attendance_select on public.attendance for select to authenticated
  using (public.is_staff(auth.uid()) and exists (select 1 from public.staff s where s.id = staff_id));
create policy attendance_insert on public.attendance for insert to authenticated
  with check (public.is_staff(auth.uid()));
create policy attendance_update on public.attendance for update to authenticated
  using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));
create policy attendance_delete on public.attendance for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create policy staff_advances_select on public.staff_advances for select to authenticated
  using (public.is_staff(auth.uid()) and deleted_at is null and exists (select 1 from public.staff s where s.id = staff_id));
create policy staff_advances_insert on public.staff_advances for insert to authenticated
  with check (public.is_staff(auth.uid()) and deleted_at is null);
create policy staff_advances_update on public.staff_advances for update to authenticated
  using (public.is_staff(auth.uid()) and deleted_at is null)
  with check (public.is_staff(auth.uid()));

create policy salary_payments_select on public.salary_payments for select to authenticated
  using (public.is_staff(auth.uid()) and exists (select 1 from public.staff s where s.id = staff_id));
