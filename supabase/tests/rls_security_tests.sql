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
  select count(*) into n from public.audit_logs where table_name = 'clients';
  if n = 0 then raise exception 'FAIL: client changes are not audited'; end if;
  raise notice 'PASS: admin can read audit_logs (including client changes) and event_financials';
end $$;
do $$ begin
  begin insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000c3', 'accountant');
    raise exception 'FAIL: admin wrote user_roles directly (only the service role should)';
  exception when insufficient_privilege then raise notice 'PASS: even admins cannot write user_roles through the API'; end;
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
  begin update public.user_roles set role = 'accountant' where role = 'admin';
    raise exception 'FAIL: last admin was demoted';
  exception when raise_exception then raise notice 'PASS: the last admin cannot be demoted'; end;
end $$;

rollback;
