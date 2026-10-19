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

-- ===========================================================================
-- USER WITH NO ROLE (e.g. someone who found the sign-up page)
-- ===========================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', true);
do $$ declare n int; begin
  select count(*) into n from public.invoices;
  if n <> 0 then raise exception 'FAIL: role-less user can read invoices'; end if;
  select count(*) into n from public.payments;
  if n <> 0 then raise exception 'FAIL: role-less user can read payments'; end if;
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
  begin update public.user_roles set role = 'accountant' where role = 'admin';
    raise exception 'FAIL: last admin was demoted';
  exception when raise_exception then raise notice 'PASS: the last admin cannot be demoted'; end;
end $$;

rollback;
