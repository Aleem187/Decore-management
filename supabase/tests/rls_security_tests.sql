-- Plain-SQL security tests. Run against a LOCAL or throwaway database, never production:
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_security_tests.sql
-- Everything runs in one transaction that is rolled back at the end.
-- Any failed check raises an exception and stops the script; passes print NOTICE lines.

begin;

-- Fixtures (as the database owner) ------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'accountant@test.local'),
  ('00000000-0000-0000-0000-0000000000c3', 'norole@test.local');   -- signed up, never invited

insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000b2', 'accountant');

insert into public.events (id, name, event_date, client_name)
  values ('00000000-0000-0000-0000-00000000e001', 'Test Wedding', current_date + 30, 'Test Client');
insert into public.event_financials (event_id, package_price, estimated_cost)
  values ('00000000-0000-0000-0000-00000000e001', 500000, 300000);
insert into public.invoices (id, invoice_no, event_id, client_name, amount, amount_paid)
  values ('00000000-0000-0000-0000-00000000f001', 'T-001', '00000000-0000-0000-0000-00000000e001', 'Test Client', 100000, 0);

-- Event profitability fixtures (owner level) ----------------------------------
insert into public.hotels (id, name) values ('00000000-0000-0000-0000-0000000000d1', 'Test Hotel');
insert into public.events (id, name, event_date, client_name, hotel_id) values
  ('00000000-0000-0000-0000-00000000e002', 'PnL Wedding', current_date + 10, 'PnL Client', '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-00000000e003', 'PnL No Invoices', current_date + 11, 'Quiet Client', null),
  ('00000000-0000-0000-0000-00000000e004', 'PnL Out Of Range', current_date + 900, 'Far Client', null);
insert into public.events (id, name, event_date, client_name, deleted_at)
  values ('00000000-0000-0000-0000-00000000e005', 'PnL Deleted', current_date + 12, 'Gone Client', now());
-- e002: invoice A 100000 (payments 60000 + 5000 voided), invoice B 50000 voided with a 20000 payment
insert into public.invoices (id, invoice_no, event_id, client_name, amount) values
  ('00000000-0000-0000-0000-00000000f0a1', 'PNL-A', '00000000-0000-0000-0000-00000000e002', 'PnL Client', 100000),
  ('00000000-0000-0000-0000-00000000f0b1', 'PNL-B', '00000000-0000-0000-0000-00000000e002', 'PnL Client', 50000);
insert into public.payments (id, invoice_id, amount, method) values
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-00000000f0a1', 60000, 'cash'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-00000000f0a1', 5000, 'cash'),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-00000000f0b1', 20000, 'bank');
select set_config('app.void_payment', 'on', true);
update public.payments set voided_at = now(), void_by = '00000000-0000-0000-0000-0000000000a1', void_reason = 'fixture' where id = '00000000-0000-0000-0000-0000000000a6';
select set_config('app.void_payment', 'off', true);
update public.invoices set voided_at = now(), voided_by = '00000000-0000-0000-0000-0000000000a1' where id = '00000000-0000-0000-0000-00000000f0b1';
-- expenses: e002 30000 (+ a deleted 5000), e003 2000, general 7000, general outside any range we ask for
insert into public.expenses (id, category, amount, event_id, expense_date) values
  ('00000000-0000-0000-0000-0000000000e1', 'Flowers', 30000, '00000000-0000-0000-0000-00000000e002', current_date),
  ('00000000-0000-0000-0000-0000000000e2', 'Flowers', 2000, '00000000-0000-0000-0000-00000000e003', current_date),
  ('00000000-0000-0000-0000-0000000000e3', 'Other', 7000, null, current_date),
  ('00000000-0000-0000-0000-0000000000e4', 'Other', 9999, null, current_date - 2000);
insert into public.expenses (id, category, amount, event_id, deleted_at)
  values ('00000000-0000-0000-0000-0000000000e5', 'Flowers', 5000, '00000000-0000-0000-0000-00000000e002', now());

-- Calendar fixtures: a disabled team member and one existing assignment
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d4', 'disabled@test.local');
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000d4', 'accountant');
update public.profiles set disabled_at = now() where id = '00000000-0000-0000-0000-0000000000d4';
insert into public.event_staff (id, event_id, staff_id, role)
  values ('00000000-0000-0000-0000-0000000005f1', '00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000000b2', 'Lead decorator');

-- Staff / payroll fixtures (owner level). March 2026 is a fixed past month.
--   Monthly Mo   30000/month: 20 present, 2 absent, 1 leave, 2 half days -> deduction (2+1+1) days = 4000 -> earned 26000
--   Daily Dan    1500/day:    10 present, 4 half days -> 12 days = 18000
--   New Joiner   31000/month: joined 21 March, no marks -> 20 days before joining -> earned 10333.33
insert into public.staff (id, name, job_title, salary_type, rate, joining_date, active) values
  ('00000000-0000-0000-0000-0000000005a1', 'Monthly Mo', 'Supervisor', 'monthly', 30000, '2025-01-01', true),
  ('00000000-0000-0000-0000-0000000005a2', 'Daily Dan', 'Labor', 'daily_wage', 1500, '2025-01-01', true),
  ('00000000-0000-0000-0000-0000000005a3', 'New Joiner', 'Decorator', 'monthly', 31000, '2026-03-21', true),
  ('00000000-0000-0000-0000-0000000005a4', 'Left Lee', 'Driver', 'daily_wage', 1200, '2025-01-01', false);
insert into public.attendance (staff_id, work_date, status)
select '00000000-0000-0000-0000-0000000005a1', d::date, case when extract(day from d) <= 20 then 'present' when extract(day from d) <= 22 then 'absent'
                           when extract(day from d) = 23 then 'leave' else 'half_day' end
  from generate_series('2026-03-01'::date, '2026-03-25'::date, interval '1 day') d;
insert into public.attendance (staff_id, work_date, status)
select '00000000-0000-0000-0000-0000000005a2', d::date, case when extract(day from d) <= 10 then 'present' else 'half_day' end
  from generate_series('2026-03-01'::date, '2026-03-14'::date, interval '1 day') d;
insert into public.staff_advances (staff_id, amount, given_on) values ('00000000-0000-0000-0000-0000000005a1', 5000, '2026-03-05'), ('00000000-0000-0000-0000-0000000005a2', 25000, '2026-03-10');

-- ===========================================================================
-- ACCOUNTANT
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);

-- 1. cannot read audit_logs
do $$ declare n int; begin
  select count(*) into n from public.audit_logs;
  if n <> 0 then raise exception 'FAIL: accountant can read % audit_logs rows', n; end if;
  raise notice 'PASS: accountant cannot read audit_logs';
end $$;

-- 2. cannot delete invoices (hard delete, soft delete, or void)
do $$ begin
  begin delete from public.invoices where id = '00000000-0000-0000-0000-00000000f001';
    raise exception 'FAIL: accountant hard-deleted an invoice';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot DELETE invoices'; end;
end $$;
do $$ begin
  begin update public.invoices set deleted_at = now() where id = '00000000-0000-0000-0000-00000000f001';
    raise exception 'FAIL: accountant soft-deleted an invoice via UPDATE';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot set deleted_at'; end;
end $$;
do $$ begin
  begin perform public.soft_delete('invoices', '00000000-0000-0000-0000-00000000f001');
    raise exception 'FAIL: accountant used soft_delete()';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot call soft_delete()'; end;
end $$;
do $$ begin
  begin perform public.void_invoice('00000000-0000-0000-0000-00000000f001');
    raise exception 'FAIL: accountant voided an invoice';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot void invoices'; end;
end $$;

-- 3. cannot write user_roles
do $$ begin
  begin insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000c3', 'admin');
    raise exception 'FAIL: accountant inserted into user_roles';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot INSERT user_roles'; end;
  begin update public.user_roles set role = 'admin' where user_id = '00000000-0000-0000-0000-0000000000b2';
    raise exception 'FAIL: accountant promoted themselves';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot UPDATE user_roles'; end;
  begin delete from public.user_roles;
    raise exception 'FAIL: accountant deleted user_roles';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot DELETE user_roles'; end;
end $$;

-- 4. payments ledger: amount_paid / status are calculated, never written
do $$ begin
  begin update public.invoices set amount_paid = 100001 where id = '00000000-0000-0000-0000-00000000f001';
    raise exception 'FAIL: accountant wrote invoices.amount_paid';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot UPDATE invoices.amount_paid'; end;
  begin update public.invoices set status = 'paid' where id = '00000000-0000-0000-0000-00000000f001';
    raise exception 'FAIL: accountant wrote invoices.status';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot UPDATE invoices.status'; end;
  begin insert into public.invoices (invoice_no, client_name, amount, amount_paid) values ('T-002', 'X', 1000, 2000);
    raise exception 'FAIL: accountant inserted an invoice with amount_paid';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot INSERT invoices.amount_paid'; end;
end $$;

do $$ declare paid numeric; s public.invoice_status; begin
  insert into public.payments (invoice_id, amount, method, reference_no) values ('00000000-0000-0000-0000-00000000f001', 40000, 'cash', 'R-1');
  select amount_paid, status into paid, s from public.invoices where id = '00000000-0000-0000-0000-00000000f001';
  if paid <> 40000 or s <> 'partial' then raise exception 'FAIL: amount_paid=% status=% (expected 40000 / partial)', paid, s; end if;
  raise notice 'PASS: accountant added a payment; amount_paid and status are calculated';
end $$;

-- 4b. overpayment is blocked, exact remaining balance is allowed
do $$ begin
  begin insert into public.payments (invoice_id, amount, method) values ('00000000-0000-0000-0000-00000000f001', 60000.01, 'cash');
    raise exception 'FAIL: overpayment was accepted';
  exception when check_violation then raise notice 'PASS: payment above the remaining balance blocked'; end;
  insert into public.payments (invoice_id, amount, method, reference_no) values ('00000000-0000-0000-0000-00000000f001', 10000, 'bank', 'R-2');
  raise notice 'PASS: payment within the remaining balance accepted';
  begin update public.invoices set amount = 45000 where id = '00000000-0000-0000-0000-00000000f001';
    raise exception 'FAIL: invoice total lowered below the amount already paid';
  exception when check_violation then raise notice 'PASS: invoice total cannot drop below amount paid'; end;
  begin insert into public.payments (invoice_id, amount, method) values ('00000000-0000-0000-0000-00000000f001', 100, 'barter');
    raise exception 'FAIL: unknown payment method accepted';
  exception when check_violation then raise notice 'PASS: unknown payment method rejected'; end;
end $$;

-- 4c. payments are immutable and cannot be voided by an accountant
do $$ declare pid uuid; begin
  select id into pid from public.payments where reference_no = 'R-1';
  begin update public.payments set amount = 1 where id = pid;
    raise exception 'FAIL: accountant edited a payment';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot UPDATE payments'; end;
  begin delete from public.payments where id = pid;
    raise exception 'FAIL: accountant deleted a payment';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot DELETE payments'; end;
  begin perform public.void_payment(pid, 'trying to hide a payment');
    raise exception 'FAIL: accountant voided a payment';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot void payments'; end;
  begin update public.payments set voided_at = now(), void_by = auth.uid(), void_reason = 'x' where id = pid;
    raise exception 'FAIL: accountant voided a payment with a direct UPDATE';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot void with a direct UPDATE'; end;
end $$;

-- 5. other restrictions
do $$ declare n int; begin
  select count(*) into n from public.event_financials;
  if n <> 0 then raise exception 'FAIL: accountant can read event_financials'; end if;
  raise notice 'PASS: accountant cannot read event_financials (profit data)';
end $$;
do $$ begin
  begin insert into public.events (name, event_date, client_name) values ('x', current_date, 'y');
    raise exception 'FAIL: accountant created an event';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot create events'; end;
end $$;
do $$ begin
  begin insert into public.expenses (category, amount) values ('Flowers', 0);
    raise exception 'FAIL: zero-amount expense accepted';
  exception when check_violation then raise notice 'PASS: zero-amount expense rejected'; end;
end $$;
do $$ begin
  begin insert into public.invoices (invoice_no, client_name, amount) values ('t-001', 'Dup', 1000);
    raise exception 'FAIL: duplicate invoice number accepted';
  exception when unique_violation then raise notice 'PASS: duplicate invoice number rejected (case-insensitive)'; end;
end $$;
do $$ begin
  insert into public.expenses (category, amount, paid) values ('Flowers', 2500, false);
  insert into public.vendors (name) values ('Test Florist');
  raise notice 'PASS: accountant can add expenses and vendors';
end $$;

-- 6. clients: accountants can view, add and edit, never delete
do $$ declare cid uuid; ph text; nm text; begin
  insert into public.clients (name, phone, whatsapp, email)
  values ('  Ayesha Khan ', '0300-1234567', '+92 321 7654321', 'ayesha@example.com') returning id, phone, name into cid, ph, nm;
  if ph <> '923001234567' or nm <> 'Ayesha Khan' then raise exception 'FAIL: stored phone=% name=%', ph, nm; end if;
  raise notice 'PASS: accountant added a client; phone normalised to 92xxxxxxxxxx, name trimmed';

  update public.clients set notes = 'VIP', phone = '0092 300 1234567' where id = cid;
  select phone into ph from public.clients where id = cid;
  if ph <> '923001234567' then raise exception 'FAIL: phone after edit %', ph; end if;
  raise notice 'PASS: accountant edited a client';

  begin insert into public.clients (name, phone) values ('Bad Phone', '12345');
    raise exception 'FAIL: invalid phone accepted';
  exception when check_violation then raise notice 'PASS: invalid phone rejected'; end;
  begin insert into public.clients (name) values ('   ');
    raise exception 'FAIL: blank name accepted';
  exception when check_violation then raise notice 'PASS: blank name rejected'; end;
  begin insert into public.clients (name, email) values ('Bad Email', 'not-an-email');
    raise exception 'FAIL: invalid email accepted';
  exception when check_violation then raise notice 'PASS: invalid email rejected'; end;

  begin delete from public.clients where id = cid;
    raise exception 'FAIL: accountant deleted a client';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot DELETE clients'; end;
  begin update public.clients set deleted_at = now() where id = cid;
    raise exception 'FAIL: accountant soft-deleted a client with UPDATE';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot set clients.deleted_at'; end;
  begin perform public.soft_delete('clients', cid);
    raise exception 'FAIL: accountant used soft_delete on a client';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot call soft_delete() on clients'; end;
  begin update public.clients set created_by = null where id = cid;
    raise exception 'FAIL: accountant rewrote created_by';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot change created_by'; end;
end $$;

-- phone normaliser (must match src/lib/phone.ts)
do $$ declare c text; begin
  foreach c in array array['0300-1234567','+92 300 1234567','0092 300 1234567','923001234567','3001234567','+92 (0)300 1234567','(0300) 123 4567'] loop
    if public.normalize_pk_phone(c) is distinct from '923001234567' then raise exception 'FAIL: % -> %', c, public.normalize_pk_phone(c); end if;
  end loop;
  foreach c in array array['030012345','12345','+1 202 555 0100','92300123456','abc',''] loop
    if public.normalize_pk_phone(c) is not null then raise exception 'FAIL: % should be invalid', c; end if;
  end loop;
  raise notice 'PASS: normalize_pk_phone accepts 03xx / +92 / 0092 / spaces / dashes and rejects bad lengths';
end $$;

-- linking keeps the copied name in step, and renames propagate
do $$ declare cid uuid; nm text; begin
  select id into cid from public.clients where name = 'Ayesha Khan';
  update public.invoices set client_id = cid where id = '00000000-0000-0000-0000-00000000f001';
  select client_name into nm from public.invoices where id = '00000000-0000-0000-0000-00000000f001';
  if nm <> 'Ayesha Khan' then raise exception 'FAIL: invoice client_name=% after linking', nm; end if;
  update public.clients set name = 'Ayesha K. Khan' where id = cid;
  select client_name into nm from public.invoices where id = '00000000-0000-0000-0000-00000000f001';
  if nm <> 'Ayesha K. Khan' then raise exception 'FAIL: rename did not propagate, got %', nm; end if;
  raise notice 'PASS: linking an invoice copies the client name; renaming the client updates it';
  insert into public.invoices (invoice_no, client_id, amount) values ('T-CLI', cid, 5000);
  select client_name into nm from public.invoices where invoice_no = 'T-CLI';
  if nm <> 'Ayesha K. Khan' then raise exception 'FAIL: invoice created with only client_id has client_name=%', nm; end if;
  raise notice 'PASS: an invoice can be created with just a client (name filled in by the database)';
  begin insert into public.invoices (invoice_no, amount) values ('T-NOCLIENT', 1000);
    raise exception 'FAIL: invoice without client or name accepted';
  exception when not_null_violation or check_violation then raise notice 'PASS: invoice needs a client or a name'; end;
end $$;

-- 7. event profitability: an accountant can link expenses to events but cannot read profit data
do $$ begin
  update public.expenses set event_id = '00000000-0000-0000-0000-00000000e003' where id = '00000000-0000-0000-0000-0000000000e3';
  update public.expenses set event_id = null where id = '00000000-0000-0000-0000-0000000000e3';
  raise notice 'PASS: accountant can link and unlink an expense to an event';
  begin update public.expenses set event_id = '00000000-0000-0000-0000-00000000e005' where id = '00000000-0000-0000-0000-0000000000e3';
    raise exception 'FAIL: expense linked to a deleted event';
  exception when check_violation then raise notice 'PASS: an expense cannot be linked to a deleted event'; end;
  begin insert into public.expenses (category, amount, event_id) values ('Flowers', 100, '00000000-0000-0000-0000-0000000000ff');
    raise exception 'FAIL: expense linked to an unknown event';
  exception when check_violation or foreign_key_violation then raise notice 'PASS: an expense cannot be linked to an unknown event'; end;
end $$;
do $$ begin
  begin perform * from public.event_pnl(current_date - 1, current_date + 400);
    raise exception 'FAIL: accountant read the event profit report';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot call event_pnl()'; end;
  begin perform * from public.event_pnl_one('00000000-0000-0000-0000-00000000e002');
    raise exception 'FAIL: accountant read one event''s profit data';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot call event_pnl_one()'; end;
  begin perform public.general_expenses_total(current_date - 1, current_date + 1);
    raise exception 'FAIL: accountant read general expense totals';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot call general_expenses_total()'; end;
end $$;

-- 8. staff module, team assignments and salaries are admin-only: an accountant sees and changes nothing
do $$ declare n int; sid uuid; begin
  select count(*) into n from public.event_staff;
  if n <> 0 then raise exception 'FAIL: accountant can read % team assignments', n; end if;
  select count(*) into n from public.staff;
  if n <> 0 then raise exception 'FAIL: accountant can read % staff records', n; end if;
  select count(*) into n from public.attendance;
  if n <> 0 then raise exception 'FAIL: accountant can read attendance'; end if;
  select count(*) into n from public.staff_advances;
  if n <> 0 then raise exception 'FAIL: accountant can read staff advances'; end if;
  select count(*) into n from public.salary_payments;
  if n <> 0 then raise exception 'FAIL: accountant can read salary payments'; end if;
  select count(*) into n from public.expenses where source_table is not null or category = 'Salary';
  if n <> 0 then raise exception 'FAIL: accountant can read % salary-generated expenses', n; end if;
  raise notice 'PASS: accountant cannot read staff, attendance, advances, salary payments, team assignments or salary expenses';

  sid := '00000000-0000-0000-0000-0000000005a1';
  begin perform public.staff_salary_calc(sid, '2026-03-01', 0);
    raise exception 'FAIL: accountant ran staff_salary_calc';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot call staff_salary_calc()'; end;
  begin perform public.record_salary_payment(sid, '2026-03-01', 0, 0, 'cash', null, null, null);
    raise exception 'FAIL: accountant recorded a salary payment';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot call record_salary_payment()'; end;
  begin insert into public.event_staff (event_id, staff_id, role)
    values ('00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-0000000000a1', 'Helper');
    raise exception 'FAIL: accountant created an assignment';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot assign staff'; end;
  begin insert into public.staff (name, job_title, salary_type, rate) values ('Intruder', 'Helper', 'monthly', 1);
    raise exception 'FAIL: accountant created a staff member';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot add staff members'; end;
  begin insert into public.attendance (staff_id, work_date, status) values (sid, current_date - 1, 'present');
    raise exception 'FAIL: accountant marked attendance';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot mark attendance'; end;
  begin insert into public.staff_advances (staff_id, amount, given_on) values (sid, 1000, current_date);
    raise exception 'FAIL: accountant added an advance';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot add advances'; end;
  begin insert into public.events (name, event_date, client_name, start_time, end_time) values ('x', current_date, 'y', '10:00', '12:00');
    raise exception 'FAIL: accountant created an event from the calendar';
  exception when insufficient_privilege then raise notice 'PASS: accountant cannot create events'; end;
end $$;

-- ===========================================================================
-- USER WITH NO ROLE (e.g. someone who found the sign-up page)
-- ===========================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', true);
do $$ declare n int; begin
  select count(*) into n from public.invoices;
  if n <> 0 then raise exception 'FAIL: role-less user can read invoices'; end if;
  select count(*) into n from public.payments;
  if n <> 0 then raise exception 'FAIL: role-less user can read payments'; end if;
  select count(*) into n from public.clients;
  if n <> 0 then raise exception 'FAIL: role-less user can read clients'; end if;
  select count(*) into n from public.event_staff;
  if n <> 0 then raise exception 'FAIL: role-less user can read event_staff'; end if;
  select count(*) into n from public.staff;
  if n <> 0 then raise exception 'FAIL: role-less user can read staff'; end if;
  select count(*) into n from public.salary_payments;
  if n <> 0 then raise exception 'FAIL: role-less user can read salary payments'; end if;
  begin insert into public.expenses (category, amount) values ('Flowers', 100);
    raise exception 'FAIL: role-less user inserted an expense';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS: user without a role sees and writes nothing';
end $$;

-- ===========================================================================
-- ANON
-- ===========================================================================
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.invoices;
    raise exception 'FAIL: anon can query invoices';
  exception when insufficient_privilege then raise notice 'PASS: anon has no table access'; end;
end $$;

do $$ begin
  begin perform * from public.event_pnl(current_date - 1, current_date + 1);
    raise exception 'FAIL: anon can call event_pnl';
  exception when insufficient_privilege then raise notice 'PASS: anon cannot call event_pnl()'; end;
end $$;

-- ===========================================================================
-- ADMIN
-- ===========================================================================
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

-- ADMIN: salary calculation and payouts (accountants can no longer run these)
-- salary figures (the same cases are unit-tested in src/test/salary.test.ts)
do $$ declare c jsonb; begin
  c := public.staff_salary_calc('00000000-0000-0000-0000-0000000005a1', '2026-03-01', 0);
  if (c->>'gross')::numeric <> 26000 or (c->>'advance_deducted')::numeric <> 5000 or (c->>'net')::numeric <> 21000 then
    raise exception 'FAIL: monthly staff calc %', c; end if;
  c := public.staff_salary_calc('00000000-0000-0000-0000-0000000005a1', '2026-03-17', 500);
  if (c->>'net')::numeric <> 21500 then raise exception 'FAIL: monthly staff with bonus %', c; end if;
  c := public.staff_salary_calc('00000000-0000-0000-0000-0000000005a2', '2026-03-01', 0);
  if (c->>'gross')::numeric <> 18000 or (c->>'days_worked')::numeric <> 12 or (c->>'advance_deducted')::numeric <> 18000
     or (c->>'net')::numeric <> 0 or (c->>'advance_carried_forward')::numeric <> 7000 then
    raise exception 'FAIL: daily wage staff with advance above salary %', c; end if;
  c := public.staff_salary_calc('00000000-0000-0000-0000-0000000005a3', '2026-03-01', 0);
  if (c->>'gross')::numeric <> 10333.33 then raise exception 'FAIL: mid-month joiner %', c; end if;
  c := public.staff_salary_calc('00000000-0000-0000-0000-0000000005a3', '2026-02-01', 0);
  if (c->>'gross')::numeric <> 0 then raise exception 'FAIL: staff earned before joining %', c; end if;
  c := public.staff_salary_calc('00000000-0000-0000-0000-0000000005a2', '2026-01-01', 0);
  if (c->>'gross')::numeric <> 0 or (c->>'days_worked')::numeric <> 0 then raise exception 'FAIL: daily wage, no attendance %', c; end if;
  c := public.staff_salary_calc('00000000-0000-0000-0000-0000000005a1', '2026-01-01', 0);
  if (c->>'gross')::numeric <> 30000 then raise exception 'FAIL: monthly staff with no marks should get the full rate %', c; end if;
  raise notice 'PASS: salary calculation (monthly, daily wage, half days, bonus, advances above salary, no attendance, joiners)';
  begin perform public.staff_salary_calc('00000000-0000-0000-0000-0000000005a1', '2026-03-01', -5);
    raise exception 'FAIL: negative bonus accepted';
  exception when check_violation then raise notice 'PASS: a negative bonus is rejected'; end;
end $$;

-- payouts: admin records them, nobody edits them, only an admin voids them
do $$ declare pid uuid; n int; a numeric; e record; begin
  begin perform public.record_salary_payment('00000000-0000-0000-0000-0000000005a1', '2026-03-01', 500, 99999, 'cash', null, current_date, null);
    raise exception 'FAIL: payout accepted with figures the user did not review';
  exception when raise_exception then raise notice 'PASS: a payout is refused when the reviewed figures no longer match'; end;
  begin perform public.record_salary_payment('00000000-0000-0000-0000-0000000005a1', date_trunc('month', current_date + 70)::date, 0, 0, 'cash', null, current_date, null);
    raise exception 'FAIL: future month paid';
  exception when check_violation then raise notice 'PASS: a future month cannot be paid'; end;
  begin insert into public.salary_payments (staff_id, period_month, gross, bonus, advance_deducted, amount, method, calc)
    values ('00000000-0000-0000-0000-0000000005a1', '2026-03-01', 1, 0, 0, 1, 'cash', '{}');
    raise exception 'FAIL: direct insert into salary_payments';
  exception when insufficient_privilege then raise notice 'PASS: salary payments cannot be inserted directly'; end;

  pid := public.record_salary_payment('00000000-0000-0000-0000-0000000005a1', '2026-03-01', 500, 21500, 'bank', 'TRX-1', current_date, 'March');
  select amount into a from public.salary_payments where id = pid;
  if a <> 21500 then raise exception 'FAIL: stored amount %', a; end if;
  select * into e from public.expenses where source_table = 'salary_payments' and source_id = pid;
  if e.category <> 'Salary' or e.amount <> 21500 or e.deleted_at is not null then raise exception 'FAIL: salary expense wrong: %', e; end if;
  raise notice 'PASS: admin recorded a salary payout; one Salary expense of the net amount was booked';

  begin perform public.record_salary_payment('00000000-0000-0000-0000-0000000005a1', '2026-03-01', 0, 21000, 'cash', null, current_date, null);
    raise exception 'FAIL: month paid twice';
  exception when unique_violation then raise notice 'PASS: a month cannot be paid twice'; end;

  pid := public.record_salary_payment('00000000-0000-0000-0000-0000000005a2', '2026-03-01', 1000, 0, 'cash', null, current_date, null);
  select count(*) into n from public.expenses where source_id = pid;
  if n <> 0 then raise exception 'FAIL: a zero net payout must not book an expense'; end if;
  select advance_deducted into a from public.salary_payments where id = pid;
  if a <> 19000 then raise exception 'FAIL: advance recovered % (expected 19000)', a; end if;
  raise notice 'PASS: advances above the salary are recovered only up to the pay; net is 0 and nothing is double counted';

  begin update public.expenses set amount = 1 where source_table = 'salary_payments' and amount = 21500;
    raise exception 'FAIL: admin edited a generated Salary expense';
  exception when insufficient_privilege then raise notice 'PASS: a generated Salary expense cannot be edited'; end;
  begin update public.salary_payments set amount = 1 where id = pid;
    raise exception 'FAIL: salary payment edited';
  exception when insufficient_privilege then raise notice 'PASS: admin cannot UPDATE salary payments'; end;
  begin delete from public.salary_payments where id = pid;
    raise exception 'FAIL: salary payment deleted';
  exception when insufficient_privilege then raise notice 'PASS: admin cannot DELETE salary payments'; end;
end $$;


do $$ declare n int; begin
  select count(*) into n from public.audit_logs;
  if n = 0 then raise exception 'FAIL: admin cannot read audit_logs'; end if;
  select count(*) into n from public.event_financials;
  if n = 0 then raise exception 'FAIL: admin cannot read event_financials'; end if;
  select count(*) into n from public.audit_logs where table_name = 'clients';
  if n = 0 then raise exception 'FAIL: client changes are not audited'; end if;
  raise notice 'PASS: admin can read audit_logs (including client changes) and event_financials';
end $$;
do $$ begin
  begin insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000c3', 'accountant');
    raise exception 'FAIL: admin wrote user_roles directly (only the service role should)';
  exception when insufficient_privilege then raise notice 'PASS: even admins cannot write user_roles through the API'; end;
end $$;
-- ADMIN: calendar, times, cancelled status and team assignments
do $$ declare n int; r text; begin
  update public.events set status = 'cancelled' where id = '00000000-0000-0000-0000-00000000e003';
  select count(*) into n from public.events where id = '00000000-0000-0000-0000-00000000e003' and status = 'cancelled';
  if n <> 1 then raise exception 'FAIL: cannot cancel an event'; end if;
  raise notice 'PASS: events can be cancelled';

  update public.events set start_time = '19:00', end_time = '01:00' where id = '00000000-0000-0000-0000-00000000e003';
  raise notice 'PASS: an event can run past midnight (19:00 to 01:00)';
  begin update public.events set start_time = '19:00', end_time = null where id = '00000000-0000-0000-0000-00000000e003';
    raise exception 'FAIL: start time without end time accepted';
  exception when check_violation then raise notice 'PASS: start and end time must be set together'; end;
  begin update public.events set start_time = '19:00', end_time = '19:00' where id = '00000000-0000-0000-0000-00000000e003';
    raise exception 'FAIL: zero-length event accepted';
  exception when check_violation then raise notice 'PASS: end time must differ from start time'; end;
  insert into public.events (name, event_date, client_name, start_time, end_time)
    values ('Calendar Click', current_date + 3, 'Click Client', '10:00', '14:00');
  raise notice 'PASS: admin created an event with times';

  -- assignments
  insert into public.event_staff (event_id, staff_id, role)
    values ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000000a1', '  Supervisor ');
  select role into r from public.event_staff where staff_id = '00000000-0000-0000-0000-0000000000a1';
  if r <> 'Supervisor' then raise exception 'FAIL: role stored as [%]', r; end if;
  raise notice 'PASS: admin assigned a team member (role trimmed)';
  begin insert into public.event_staff (event_id, staff_id, role)
    values ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000000a1', 'Again');
    raise exception 'FAIL: duplicate assignment accepted';
  exception when unique_violation then raise notice 'PASS: the same person cannot be assigned to an event twice'; end;
  begin insert into public.event_staff (event_id, staff_id, role)
    values ('00000000-0000-0000-0000-00000000e004', '00000000-0000-0000-0000-0000000000d4', 'Helper');
    raise exception 'FAIL: a disabled user was assigned';
  exception when check_violation then raise notice 'PASS: a disabled user cannot be assigned'; end;
  begin insert into public.event_staff (event_id, staff_id, role)
    values ('00000000-0000-0000-0000-00000000e004', '00000000-0000-0000-0000-0000000000c3', 'Helper');
    raise exception 'FAIL: a user without a role was assigned';
  exception when check_violation then raise notice 'PASS: a user with no role cannot be assigned'; end;
  begin insert into public.event_staff (event_id, staff_id, role)
    values ('00000000-0000-0000-0000-00000000e005', '00000000-0000-0000-0000-0000000000b2', 'Helper');
    raise exception 'FAIL: assigned to a deleted event';
  exception when check_violation then raise notice 'PASS: nobody can be assigned to a deleted event'; end;
  begin insert into public.event_staff (event_id, staff_id, role)
    values ('00000000-0000-0000-0000-00000000e004', '00000000-0000-0000-0000-0000000000b2', '   ');
    raise exception 'FAIL: blank role accepted';
  exception when check_violation then raise notice 'PASS: a blank role is rejected'; end;
  begin update public.event_staff set staff_id = '00000000-0000-0000-0000-0000000000b2' where staff_id = '00000000-0000-0000-0000-0000000000a1';
    raise exception 'FAIL: assignment moved to another person';
  exception when insufficient_privilege then raise notice 'PASS: an assignment cannot be re-pointed (remove and add instead)'; end;

  update public.event_staff set role = 'Lead' where staff_id = '00000000-0000-0000-0000-0000000000a1';
  select role into r from public.event_staff where staff_id = '00000000-0000-0000-0000-0000000000a1';
  if r <> 'Lead' then raise exception 'FAIL: admin could not change a role'; end if;
  delete from public.event_staff where staff_id = '00000000-0000-0000-0000-0000000000a1';
  select count(*) into n from public.event_staff where staff_id = '00000000-0000-0000-0000-0000000000a1';
  if n <> 0 then raise exception 'FAIL: admin could not remove an assignment'; end if;
  raise notice 'PASS: admin can change a role and remove an assignment';

  select count(*) into n from public.audit_logs where table_name = 'event_staff';
  if n < 3 then raise exception 'FAIL: assignments are not audited (% rows)', n; end if;
  raise notice 'PASS: assignment changes are audited';
end $$;

-- ADMIN: staff records, assignments of staff members, voiding payouts
do $$ declare n int; r record; a numeric; pid uuid; c jsonb; aid uuid; begin
  insert into public.staff (name, job_title, phone, cnic, salary_type, rate)
  values ('  Test Driver ', 'Driver', '0300-7654321', '3520212345671', 'daily_wage', 1000);
  select * into r from public.staff where name = 'Test Driver';
  if r.phone <> '923007654321' or r.cnic <> '35202-1234567-1' then raise exception 'FAIL: phone=% cnic=%', r.phone, r.cnic; end if;
  raise notice 'PASS: admin added staff; name trimmed, phone and CNIC normalised';
  begin insert into public.staff (name, job_title, cnic) values ('Dup', 'Helper', '35202-1234567-1');
    raise exception 'FAIL: duplicate CNIC accepted';
  exception when unique_violation then raise notice 'PASS: a CNIC can belong to only one staff member'; end;
  begin insert into public.staff (name, job_title, cnic) values ('Bad', 'Helper', '12345');
    raise exception 'FAIL: invalid CNIC accepted';
  exception when check_violation then raise notice 'PASS: invalid CNIC rejected'; end;
  begin insert into public.staff (name, job_title, phone) values ('Bad', 'Helper', '12345');
    raise exception 'FAIL: invalid phone accepted';
  exception when check_violation then raise notice 'PASS: invalid staff phone rejected'; end;
  begin insert into public.staff (name, job_title, rate) values ('Bad', 'Helper', -1);
    raise exception 'FAIL: negative rate accepted';
  exception when check_violation then raise notice 'PASS: a negative rate is rejected'; end;
  begin insert into public.staff (name, job_title, salary_type) values ('Bad', 'Helper', 'weekly');
    raise exception 'FAIL: unknown salary type accepted';
  exception when check_violation then raise notice 'PASS: salary type must be monthly or daily_wage'; end;
  update public.staff set rate = 1200 where name = 'Test Driver';
  perform public.soft_delete('staff', r.id);
  select count(*) into n from public.staff where id = r.id;
  if n <> 0 then raise exception 'FAIL: deleted staff member still visible'; end if;
  raise notice 'PASS: admin edited and soft-deleted a staff member';

  -- event assignments use staff members; login users already assigned keep working
  insert into public.event_staff (event_id, staff_member_id, role) values ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000005a1', 'Supervisor');
  raise notice 'PASS: a staff member can be assigned to an event';
  begin insert into public.event_staff (event_id, staff_member_id, role) values ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000005a1', 'Again');
    raise exception 'FAIL: same staff member assigned twice';
  exception when unique_violation then raise notice 'PASS: a staff member cannot be assigned to an event twice'; end;
  begin insert into public.event_staff (event_id, staff_member_id, role) values ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000005a4', 'Driver');
    raise exception 'FAIL: inactive staff assigned';
  exception when check_violation then raise notice 'PASS: an inactive staff member cannot be assigned'; end;
  begin insert into public.event_staff (event_id, staff_id, staff_member_id, role)
    values ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000005a2', 'Both');
    raise exception 'FAIL: assignment pointing at two people';
  exception when check_violation then raise notice 'PASS: an assignment names exactly one person'; end;
  begin insert into public.event_staff (event_id, role) values ('00000000-0000-0000-0000-00000000e002', 'Nobody');
    raise exception 'FAIL: assignment pointing at nobody';
  exception when check_violation then raise notice 'PASS: an assignment must name a person'; end;
  select count(*) into n from public.event_staff where staff_id = '00000000-0000-0000-0000-0000000000b2';
  if n < 1 then raise exception 'FAIL: the existing login-user assignment disappeared'; end if;
  raise notice 'PASS: existing login-user assignments still work';

  -- voiding a payout frees the advance, removes the expense and is audited
  select id into pid from public.salary_payments where staff_id = '00000000-0000-0000-0000-0000000005a1' and voided_at is null;
  begin perform public.void_salary_payment(pid, 'x');
    raise exception 'FAIL: void without a proper reason';
  exception when raise_exception then raise notice 'PASS: voiding a payout needs a reason'; end;
  c := public.staff_salary_calc('00000000-0000-0000-0000-0000000005a1', '2026-03-01', 0);
  if (c->>'outstanding_advance')::numeric <> 0 then raise exception 'FAIL: advance should be fully recovered before the void: %', c; end if;
  perform public.void_salary_payment(pid, 'Wrong bonus entered');
  c := public.staff_salary_calc('00000000-0000-0000-0000-0000000005a1', '2026-03-01', 0);
  if (c->>'outstanding_advance')::numeric <> 5000 or (c->>'net')::numeric <> 21000 then raise exception 'FAIL: after the void %', c; end if;
  select count(*) into n from public.expenses where source_id = pid;
  if n <> 0 then raise exception 'FAIL: the voided payout still counts as an expense'; end if;
  select count(*) into n from public.audit_logs where action = 'VOID_SALARY_PAYMENT' and record_id = pid and details->>'reason' = 'Wrong bonus entered';
  if n <> 1 then raise exception 'FAIL: salary void not audited'; end if;
  raise notice 'PASS: voiding a payout restores the advance, removes its expense and is audited';
  begin perform public.void_salary_payment(pid, 'second try');
    raise exception 'FAIL: voided twice';
  exception when raise_exception then raise notice 'PASS: a payout cannot be voided twice'; end;
  begin update public.salary_payments set note = 'edited' where id = pid;
    raise exception 'FAIL: admin edited a salary payment';
  exception when insufficient_privilege then raise notice 'PASS: even admins cannot UPDATE salary payments'; end;
  pid := public.record_salary_payment('00000000-0000-0000-0000-0000000005a1', '2026-03-01', 0, 21000, 'cash', null, current_date, 'Re-paid');
  raise notice 'PASS: the month can be paid again after a void';

  -- advances: one already recovered cannot be deleted, an unused one can
  select id into aid from public.staff_advances where staff_id = '00000000-0000-0000-0000-0000000005a2';
  begin perform public.soft_delete('staff_advances', aid);
    raise exception 'FAIL: deleted an advance that a payout already recovered';
  exception when check_violation then raise notice 'PASS: an advance recovered by a payout cannot be deleted'; end;
  select id into aid from public.staff_advances where staff_id = '00000000-0000-0000-0000-0000000005a3';
  perform public.soft_delete('staff_advances', aid);
  select count(*) into n from public.expenses where source_table = 'staff_advances' and source_id = aid and deleted_at is null;
  if n <> 0 then raise exception 'FAIL: deleting an advance left its expense behind'; end if;
  raise notice 'PASS: deleting an unused advance also removes its Salary expense';
  begin perform public.soft_delete('expenses', (select id from public.expenses where source_table = 'salary_payments' and deleted_at is null limit 1));
    raise exception 'FAIL: generated expense deleted from the Expenses page';
  exception when insufficient_privilege then raise notice 'PASS: a generated Salary expense cannot be deleted on its own'; end;

  -- attendance delete is admin only
  delete from public.attendance where staff_id = '00000000-0000-0000-0000-0000000005a3' and work_date = current_date - 1;
  select count(*) into n from public.attendance where staff_id = '00000000-0000-0000-0000-0000000005a3' and work_date = current_date - 1;
  if n <> 0 then raise exception 'FAIL: admin could not delete an attendance mark'; end if;
  raise notice 'PASS: admin can delete an attendance mark';

  select count(*) into n from public.audit_logs where table_name in ('staff', 'attendance', 'staff_advances', 'salary_payments');
  if n < 5 then raise exception 'FAIL: staff changes are not audited'; end if;
  raise notice 'PASS: staff, attendance, advances and payouts are audited';
end $$;

-- ADMIN: event profit report counts the right rows
do $$ declare r record; n int; g numeric; a1 int; a2 int; begin
  select count(*) into a1 from public.audit_logs where action = 'VIEW_EVENT_PNL';
  select * into r from public.event_pnl(current_date, current_date + 400) where event_id = '00000000-0000-0000-0000-00000000e002';
  if r.event_name <> 'PnL Wedding' or r.client_name <> 'PnL Client' or r.hotel_name <> 'Test Hotel' then
    raise exception 'FAIL: event row details wrong: %', r; end if;
  if r.invoiced <> 100000 then raise exception 'FAIL: invoiced=% (void invoice must not count; expected 100000)', r.invoiced; end if;
  if r.received <> 60000 then raise exception 'FAIL: received=% (voided payment and void-invoice payment must not count; expected 60000)', r.received; end if;
  if r.expenses <> 30000 then raise exception 'FAIL: expenses=% (deleted expense must not count; expected 30000)', r.expenses; end if;
  raise notice 'PASS: invoiced / received / expenses ignore void invoices, voided payments and deleted expenses';

  select * into r from public.event_pnl(current_date, current_date + 400) where event_id = '00000000-0000-0000-0000-00000000e003';
  if r.invoiced <> 0 or r.received <> 0 or r.expenses <> 2000 then raise exception 'FAIL: event with no invoices: %', r; end if;
  raise notice 'PASS: an event with no invoices reports zero income and its expenses';

  select count(*) into n from public.event_pnl(current_date, current_date + 400)
   where event_id in ('00000000-0000-0000-0000-00000000e004', '00000000-0000-0000-0000-00000000e005');
  if n <> 0 then raise exception 'FAIL: out-of-range or deleted events listed'; end if;
  raise notice 'PASS: events outside the range and deleted events are not listed';

  g := public.general_expenses_total(current_date - 1, current_date + 1);
  -- 7000 fixture + 2500 accountant test + 21000 re-paid salary (a Salary expense belongs to no event);
  -- linked, deleted (voided payout, deleted advance) and out-of-range expenses must not count
  if g <> 30500 then raise exception 'FAIL: general expenses=% (expected 30500)', g; end if;
  raise notice 'PASS: general expenses = only unlinked expenses inside the range';

  select * into r from public.event_pnl_one('00000000-0000-0000-0000-00000000e002');
  if (r.invoiced, r.received, r.expenses) <> (100000::numeric, 60000::numeric, 30000::numeric) then raise exception 'FAIL: event_pnl_one %', r; end if;
  raise notice 'PASS: event_pnl_one matches the report';

  begin perform * from public.event_pnl(current_date + 5, current_date);
    raise exception 'FAIL: reversed range accepted';
  exception when raise_exception then raise notice 'PASS: reversed date range rejected'; end;

  select count(*) into a2 from public.audit_logs where action = 'VIEW_EVENT_PNL';
  if a2 <= a1 then raise exception 'FAIL: viewing profit data is not audited'; end if;
  raise notice 'PASS: viewing profit data is written to the audit log';
end $$;

-- ADMIN: soft-delete a client; the linked invoice keeps working afterwards
do $$ declare cid uuid; n int; nm text; begin
  select id into cid from public.clients where name = 'Ayesha K. Khan';
  insert into public.events (name, event_date, client_id) values ('Linked Event', current_date + 5, cid);
  select client_name into nm from public.events where name = 'Linked Event';
  if nm <> 'Ayesha K. Khan' then raise exception 'FAIL: event created with only client_id has client_name=%', nm; end if;
  raise notice 'PASS: an event can be created with just a client';
  perform public.soft_delete('clients', cid);
  select count(*) into n from public.clients where id = cid;
  if n <> 0 then raise exception 'FAIL: soft-deleted client is still visible'; end if;
  select client_name into nm from public.invoices where id = '00000000-0000-0000-0000-00000000f001';
  if nm <> 'Ayesha K. Khan' then raise exception 'FAIL: invoice lost its client name'; end if;
  begin delete from public.clients;
    raise exception 'FAIL: admin hard-deleted clients';
  exception when insufficient_privilege then raise notice 'PASS: nobody can hard-delete clients'; end;
  raise notice 'PASS: admin soft-deleted a client; the invoice keeps its copied name';
end $$;

-- ADMIN: voiding a payment is audited and restores the balance
do $$ declare pid uuid; paid numeric; st public.invoice_status; n int; begin
  select id into pid from public.payments where reference_no = 'R-1';
  begin perform public.void_payment(pid, 'x');
    raise exception 'FAIL: void without a proper reason accepted';
  exception when raise_exception then raise notice 'PASS: void requires a reason'; end;

  perform public.void_payment(pid, 'Entered twice by mistake');
  select amount_paid, status into paid, st from public.invoices where id = '00000000-0000-0000-0000-00000000f001';
  if paid <> 10000 or st <> 'partial' then raise exception 'FAIL: after void amount_paid=% status=% (expected 10000 / partial)', paid, st; end if;
  raise notice 'PASS: admin voided a payment; balance restored (amount_paid back to 10000)';

  begin perform public.void_payment(pid, 'second attempt');
    raise exception 'FAIL: a payment was voided twice';
  exception when raise_exception then raise notice 'PASS: a payment cannot be voided twice'; end;

  select count(*) into n from public.audit_logs
   where action = 'VOID_PAYMENT' and record_id = pid and details->>'reason' = 'Entered twice by mistake';
  if n <> 1 then raise exception 'FAIL: void not found in audit_logs with its reason'; end if;
  raise notice 'PASS: void is recorded in audit_logs with the reason';

  begin update public.payments set note = 'edited' where id = pid;
    raise exception 'FAIL: admin edited a payment directly';
  exception when insufficient_privilege then raise notice 'PASS: even admins cannot UPDATE payments directly'; end;
  begin delete from public.payments where id = pid;
    raise exception 'FAIL: admin deleted a payment';
  exception when insufficient_privilege then raise notice 'PASS: even admins cannot DELETE payments'; end;

  -- the restored balance can be paid again, up to the invoice total
  insert into public.payments (invoice_id, amount, method) values ('00000000-0000-0000-0000-00000000f001', 90000, 'jazzcash');
  select amount_paid, status into paid, st from public.invoices where id = '00000000-0000-0000-0000-00000000f001';
  if paid <> 100000 or st <> 'paid' then raise exception 'FAIL: expected 100000 / paid, got % / %', paid, st; end if;
  begin insert into public.payments (invoice_id, amount, method) values ('00000000-0000-0000-0000-00000000f001', 1, 'cash');
    raise exception 'FAIL: payment on a fully paid invoice accepted';
  exception when check_violation then raise notice 'PASS: fully paid invoice accepts no more payments (voided payment not counted)'; end;
end $$;

do $$ declare n int; begin
  perform public.soft_delete('invoices', '00000000-0000-0000-0000-00000000f001');
  select count(*) into n from public.invoices where id = '00000000-0000-0000-0000-00000000f001';
  if n <> 0 then raise exception 'FAIL: soft-deleted invoice is still visible'; end if;
  raise notice 'PASS: admin soft delete works and hides the row';
end $$;
do $$ begin
  begin delete from public.invoices;
    raise exception 'FAIL: admin hard-deleted invoices';
  exception when insufficient_privilege then raise notice 'PASS: nobody can hard-delete invoices through the API'; end;
end $$;
do $$ begin
  begin update public.audit_logs set action = 'x';
    raise exception 'FAIL: audit_logs updated';
  exception when insufficient_privilege then raise notice 'PASS: audit_logs cannot be updated through the API'; end;
  begin delete from public.audit_logs;
    raise exception 'FAIL: audit_logs deleted';
  exception when insufficient_privilege then raise notice 'PASS: audit_logs cannot be deleted through the API'; end;
end $$;

-- ===========================================================================
-- DATABASE OWNER / SERVICE ROLE: audit log is append-only for everyone
-- ===========================================================================
reset role;
do $$ begin
  begin delete from public.audit_logs;
    raise exception 'FAIL: audit_logs rows deleted by owner';
  exception when insufficient_privilege then raise notice 'PASS: audit_logs append-only trigger blocks owner DELETE'; end;
  begin update public.audit_logs set action = 'x';
    raise exception 'FAIL: audit_logs rows updated by owner';
  exception when insufficient_privilege then raise notice 'PASS: audit_logs append-only trigger blocks owner UPDATE'; end;
end $$;
do $$ begin
  begin update public.payments set note = 'edited by owner';
    raise exception 'FAIL: owner updated payments';
  exception when insufficient_privilege then raise notice 'PASS: payments immutable trigger blocks owner UPDATE'; end;
  begin delete from public.payments;
    raise exception 'FAIL: owner deleted payments';
  exception when insufficient_privilege then raise notice 'PASS: payments immutable trigger blocks owner DELETE'; end;
end $$;
do $$ begin
  begin update public.salary_payments set note = 'edited by owner';
    raise exception 'FAIL: owner updated salary payments';
  exception when insufficient_privilege then raise notice 'PASS: salary payments immutable trigger blocks owner UPDATE'; end;
  begin delete from public.salary_payments;
    raise exception 'FAIL: owner deleted salary payments';
  exception when insufficient_privilege then raise notice 'PASS: salary payments immutable trigger blocks owner DELETE'; end;
end $$;
do $$ begin
  begin update public.user_roles set role = 'accountant' where role = 'admin';
    raise exception 'FAIL: last admin was demoted';
  exception when raise_exception then raise notice 'PASS: the last admin cannot be demoted'; end;
end $$;

rollback;
