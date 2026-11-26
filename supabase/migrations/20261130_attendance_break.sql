-- Break time (10:00–10:15) on the attendance row: when a worker took the
-- "Break time in" / "Break time out" camera check, as a 24h decimal hour like
-- am_in (10.05 = 10:03). The photos themselves stay on the phone.
-- Confirmed rows lock the break times too.
-- Requires 20261126_attendance_confirm.sql.

alter table public.attendance
  add column if not exists break_in numeric,
  add column if not exists break_out numeric;

create or replace function public._attendance_lock()
returns trigger language plpgsql as $$
begin
  if old.confirmed and new.confirmed
     and (new.status, new.am_in, new.am_out, new.pm_in, new.pm_out, new.ot_hours,
          new.night_hours, new.late_minutes, new.holiday, new.is_rest_day,
          new.break_in, new.break_out)
         is distinct from
         (old.status, old.am_in, old.am_out, old.pm_in, old.pm_out, old.ot_hours,
          old.night_hours, old.late_minutes, old.holiday, old.is_rest_day,
          old.break_in, old.break_out)
  then
    raise exception 'attendance % % is confirmed and locked', old.employee_id, old.date;
  end if;
  if old.confirmed and not new.confirmed
     and (new.status, new.am_in, new.am_out, new.pm_in, new.pm_out, new.ot_hours,
          new.night_hours, new.late_minutes, new.holiday, new.is_rest_day,
          new.break_in, new.break_out)
         is distinct from
         (old.status, old.am_in, old.am_out, old.pm_in, old.pm_out, old.ot_hours,
          old.night_hours, old.late_minutes, old.holiday, old.is_rest_day,
          old.break_in, old.break_out)
  then
    raise exception 'unlock attendance % % before editing it', old.employee_id, old.date;
  end if;
  return new;
end $$;
