-- OT · Canteen · Holidays (admin screen), mirroring the BRIGHTEM payroll
-- workbook sheets OVERTIME, CANTEEN and HOLIDAYS.
--   holidays           company holiday calendar; a worker present on one gets
--                      the special (+30%) or legal (+100%) day premium
--   pay_daily_entries  per worker per day: OT hours (replaces the attendance
--                      OT of that day) and canteen charge (deducted every 2nd
--                      pay week, see config.data -> 'canteenCycle')
-- Requires 20261126_attendance_checkin_guard.sql (_app_request_role).
-- Read: any logged-in account. Write: admin / manager only.

create table if not exists public.holidays (
  date date primary key,
  name text not null default '',
  kind text not null check (kind in ('special', 'legal')),
  created_at timestamptz not null default now()
);

create table if not exists public.pay_daily_entries (
  employee_id text not null references public.employees(id) on delete cascade,
  date date not null,
  ot_hours numeric check (ot_hours is null or (ot_hours >= 0 and ot_hours <= 24)),
  canteen numeric check (canteen is null or canteen >= 0),
  updated_at timestamptz not null default now(),
  primary key (employee_id, date)
);
create index if not exists pay_daily_entries_date_idx on public.pay_daily_entries (date);

alter table public.holidays enable row level security;
alter table public.pay_daily_entries enable row level security;

drop policy if exists holidays_read on public.holidays;
drop policy if exists holidays_write on public.holidays;
create policy holidays_read on public.holidays
  for select to anon, authenticated
  using (public._app_request_role() is not null);
create policy holidays_write on public.holidays
  for all to anon, authenticated
  using (public._app_request_role() in ('admin', 'manager'))
  with check (public._app_request_role() in ('admin', 'manager'));

drop policy if exists pay_daily_entries_office on public.pay_daily_entries;
create policy pay_daily_entries_office on public.pay_daily_entries
  for all to anon, authenticated
  using (public._app_request_role() in ('admin', 'manager'))
  with check (public._app_request_role() in ('admin', 'manager'));
