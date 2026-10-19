create table public.vendor_payments (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  payment_date date not null default current_date,
  amount numeric(12,2) not null check (amount > 0),
  method text not null default 'Cash',
  notes text,
  created_at timestamptz not null default now()
);
create index vendor_payments_vendor_id_idx on public.vendor_payments (vendor_id);

grant select, insert, update, delete on public.vendor_payments to authenticated;
grant all on public.vendor_payments to service_role;

alter table public.vendor_payments enable row level security;
-- Admins and accountants both manage vendor ledgers.
create policy "staff all vendor_payments" on public.vendor_payments for all to authenticated
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

create trigger audit_vendor_payments after insert or update or delete on public.vendor_payments
  for each row execute function public.log_change();
