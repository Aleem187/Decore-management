-- Accountants work with invoices, payments, expenses and vendor ledgers only.
-- Staff records, salaries, attendance, advances, team assignments and salary-generated expenses become admin-only.
-- Depends on 20261025000000_staff_payroll.sql. Back up before applying. Policies and function guards only; no data changes.

-- 1. Staff module tables: admin-only reads and writes
drop policy if exists staff_select on public.staff;
create policy staff_select on public.staff for select to authenticated
  using (public.has_role(auth.uid(), 'admin') and deleted_at is null);

drop policy if exists attendance_select on public.attendance;
drop policy if exists attendance_insert on public.attendance;
drop policy if exists attendance_update on public.attendance;
create policy attendance_select on public.attendance for select to authenticated
  using (public.has_role(auth.uid(), 'admin') and exists (select 1 from public.staff s where s.id = staff_id));
create policy attendance_insert on public.attendance for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));
create policy attendance_update on public.attendance for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists staff_advances_select on public.staff_advances;
drop policy if exists staff_advances_insert on public.staff_advances;
drop policy if exists staff_advances_update on public.staff_advances;
create policy staff_advances_select on public.staff_advances for select to authenticated
  using (public.has_role(auth.uid(), 'admin') and deleted_at is null and exists (select 1 from public.staff s where s.id = staff_id));
create policy staff_advances_insert on public.staff_advances for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin') and deleted_at is null);
create policy staff_advances_update on public.staff_advances for update to authenticated
  using (public.has_role(auth.uid(), 'admin') and deleted_at is null)
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists salary_payments_select on public.salary_payments;
create policy salary_payments_select on public.salary_payments for select to authenticated
  using (public.has_role(auth.uid(), 'admin') and exists (select 1 from public.staff s where s.id = staff_id));

-- 2. Team assignments on events
drop policy if exists event_staff_select on public.event_staff;
create policy event_staff_select on public.event_staff for select to authenticated
  using (public.has_role(auth.uid(), 'admin') and exists (select 1 from public.events e where e.id = event_id));

-- 3. Salary-generated expenses (advances, payouts) stay hidden from accountants; other expenses are unchanged
drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated
  using (
    public.is_staff(auth.uid()) and deleted_at is null
    and (source_table is null or public.has_role(auth.uid(), 'admin'))
  );

-- 4. Salary functions are security definer, so they bypass RLS: require admin inside them.
--    The bodies are rewritten from their current definitions, swapping only the is_staff check.
do $$
declare
  fn text; def text; patched text;
begin
  foreach fn in array array[
    'public.staff_salary_calc(uuid, date, numeric)',
    'public.record_salary_payment(uuid, date, numeric, numeric, text, text, date, text)'
  ] loop
    def := pg_get_functiondef(fn::regprocedure);
    patched := replace(def, 'not public.is_staff(auth.uid())', 'not public.has_role(auth.uid(), ''admin'')');
    if patched = def then
      raise exception 'Expected is_staff check not found in %', fn;
    end if;
    execute patched;
  end loop;
end $$;
