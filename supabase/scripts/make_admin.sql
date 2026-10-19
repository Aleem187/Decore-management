-- One-time script: make an existing user the admin.
-- Run in the Supabase SQL editor (or psql) as the project owner.
-- Replace the email below, then run. Safe to run again.
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'owner@example.com'
on conflict (user_id) do update set role = 'admin';
