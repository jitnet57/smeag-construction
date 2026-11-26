-- Attendance photos: the camera photo taken at check-in / check-out and at
-- the start / end of the 10:00–10:15 break. Files live in the 'room-photos'
-- storage bucket under attendance/<date>/<employee>/.
-- Requires 20261128_team_leader_crew_rls.sql (_app_sees_employee).

create table if not exists public.attendance_photos (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null references public.employees(id) on delete cascade,
  date date not null,
  kind text not null check (kind in ('check_in', 'check_out', 'break_in', 'break_out')),
  path text not null,
  taken_at timestamptz not null default now()
);
create index if not exists attendance_photos_date on public.attendance_photos (date, employee_id);

alter table public.attendance_photos enable row level security;

-- Logged-in users see / add photos of the employees they may see (team
-- leaders: their own crew). Only admins / managers may delete.
drop policy if exists attendance_photos_read on public.attendance_photos;
create policy attendance_photos_read on public.attendance_photos
  for select to anon, authenticated using (public._app_sees_employee(employee_id));

drop policy if exists attendance_photos_insert on public.attendance_photos;
create policy attendance_photos_insert on public.attendance_photos
  for insert to anon, authenticated with check (public._app_sees_employee(employee_id));

drop policy if exists attendance_photos_delete on public.attendance_photos;
create policy attendance_photos_delete on public.attendance_photos
  for delete to anon, authenticated
  using (public._app_request_role() in ('admin', 'manager'));

grant select, insert, delete on public.attendance_photos to anon, authenticated;
