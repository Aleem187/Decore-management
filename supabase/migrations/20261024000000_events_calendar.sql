-- Events calendar: optional event times, a "cancelled" status, and team assignments.
-- Depends on the earlier migrations (security hardening, clients, event profitability).
-- Additive only: no existing column is changed or dropped.

-- ---------------------------------------------------------------------------
-- 1. "cancelled" status. (Not used elsewhere in this file: a new enum value cannot be
--    used in the same transaction that adds it.)
-- ---------------------------------------------------------------------------
alter type public.event_status add value if not exists 'cancelled';

-- ---------------------------------------------------------------------------
-- 2. Optional start/end time. Both or neither. An end time at or before the start time
--    means the event runs past midnight (a late reception, 19:00 to 01:00).
-- ---------------------------------------------------------------------------
alter table public.events add column if not exists start_time time;
alter table public.events add column if not exists end_time time;

alter table public.events drop constraint if exists events_times_together;
alter table public.events add constraint events_times_together
  check ((start_time is null) = (end_time is null) and (start_time is null or end_time <> start_time));

create or replace function public.events_check_times()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.start_time is null) <> (new.end_time is null) then
    raise exception 'Set both a start time and an end time, or leave both empty' using errcode = 'check_violation';
  end if;
  if new.start_time is not null and new.start_time = new.end_time then
    raise exception 'The end time must differ from the start time' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists events_check_times on public.events;
create trigger events_check_times before insert or update on public.events
  for each row execute function public.events_check_times();

-- Clash look-ups: same hotel and date.
create index if not exists events_hotel_date_idx on public.events (hotel_id, event_date) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 3. Team assignments. The "team" is the existing profiles table (people with an app login
--    and a role); nothing new is created for people.
-- ---------------------------------------------------------------------------
create table public.event_staff (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  staff_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'Team member' check (length(btrim(role)) between 1 and 60),
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (event_id, staff_id)
);
create index event_staff_event_id_idx on public.event_staff (event_id);
create index event_staff_staff_id_idx on public.event_staff (staff_id);

-- Stamp the author; only an active team member (has a role, not disabled) on a live event can be assigned.
create or replace function public.event_staff_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.role := btrim(new.role);
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    -- Only the role can change: moving an assignment to another person or event is a new assignment.
    if new.event_id <> old.event_id or new.staff_id <> old.staff_id then
      raise exception 'Remove the assignment and add a new one instead' using errcode = 'check_violation';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.events where id = new.event_id and deleted_at is null) then
      raise exception 'Event not found' using errcode = 'check_violation';
    end if;
    if not public.is_staff(new.staff_id) then
      raise exception 'That person is not an active team member' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger event_staff_before_write before insert or update on public.event_staff
  for each row execute function public.event_staff_before_write();

create trigger audit_event_staff after insert or update or delete on public.event_staff
  for each row execute function public.log_change();

-- ---------------------------------------------------------------------------
-- 4. Privileges and RLS. Everyone on the team can see assignments; only admins change them.
--    Assignments are a link table, so admins may remove them for real (the audit log keeps the record).
-- ---------------------------------------------------------------------------
revoke all on public.event_staff from anon, authenticated;
grant select on public.event_staff to authenticated;
grant insert (event_id, staff_id, role) on public.event_staff to authenticated;
grant update (role) on public.event_staff to authenticated;
grant delete on public.event_staff to authenticated;
grant all on public.event_staff to service_role;

alter table public.event_staff enable row level security;
create policy event_staff_select on public.event_staff for select to authenticated
  using (public.is_staff(auth.uid()) and exists (select 1 from public.events e where e.id = event_id));
create policy event_staff_insert on public.event_staff for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));
create policy event_staff_update on public.event_staff for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));
create policy event_staff_delete on public.event_staff for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'));
