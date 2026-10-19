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

-- 4. cannot overpay an invoice, and cannot edit the calculated status
do $$ begin
  begin update public.invoices set amount_paid = 100001 where id = '00000000-0000-0000-0000-00000000f001';
    raise exception 'FAIL: overpayment was accepted';
  exception when check_violation then raise notice 'PASS: overpayment blocked on UPDATE'; end;
  begin insert into public.invoices (invoice_no, client_name, amount, amount_paid) values ('T-002', 'X', 1000, 2000);
    raise exception 'FAIL: overpaid invoice was inserted';
  exception when check_violation then raise notice 'PASS: overpayment blocked on INSERT'; end;
end $$;
do $$ declare s public.invoice_status; begin
  update public.invoices set amount_paid = 40000, status = 'paid' where id = '00000000-0000-0000-0000-00000000f001';
  select status into s from public.invoices where id = '00000000-0000-0000-0000-00000000f001';
  if s <> 'partial' then raise exception 'FAIL: status is % (expected partial, manual edit must be ignored)', s; end if;
  raise notice 'PASS: partial payment accepted, status calculated as partial';
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

-- ===========================================================================
-- USER WITH NO ROLE (e.g. someone who found the sign-up page)
-- ===========================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', true);
do $$ declare n int; begin
  select count(*) into n from public.invoices;
  if n <> 0 then raise exception 'FAIL: role-less user can read invoices'; end if;
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

-- ===========================================================================
-- ADMIN
-- ===========================================================================
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

do $$ declare n int; begin
  select count(*) into n from public.audit_logs;
  if n = 0 then raise exception 'FAIL: admin cannot read audit_logs'; end if;
  select count(*) into n from public.event_financials;
  if n = 0 then raise exception 'FAIL: admin cannot read event_financials'; end if;
  raise notice 'PASS: admin can read audit_logs and event_financials';
end $$;
do $$ begin
  begin insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000c3', 'accountant');
    raise exception 'FAIL: admin wrote user_roles directly (only the service role should)';
  exception when insufficient_privilege then raise notice 'PASS: even admins cannot write user_roles through the API'; end;
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
  begin update public.user_roles set role = 'accountant' where role = 'admin';
    raise exception 'FAIL: last admin was demoted';
  exception when raise_exception then raise notice 'PASS: the last admin cannot be demoted'; end;
end $$;

rollback;
