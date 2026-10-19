create table public.event_materials (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  item_name text not null,
  quantity integer not null default 1 check (quantity > 0),
  status text not null default 'packed' check (status in ('packed', 'delivered', 'returned')),
  created_at timestamptz not null default now()
);
create index event_materials_event_id_idx on public.event_materials (event_id);

grant select, insert, update, delete on public.event_materials to authenticated;
grant all on public.event_materials to service_role;

alter table public.event_materials enable row level security;
create policy "staff all event_materials" on public.event_materials for all to authenticated
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

create trigger audit_event_materials after insert or update or delete on public.event_materials
  for each row execute function public.log_change();
