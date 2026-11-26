-- Attendance draft / confirmed state.
-- "Save Draft" writes rows with confirmed = false; "Confirm & Apply" writes
-- confirmed = true, after which the row is locked: any change to its data is
-- rejected until it is unlocked (confirmed set back to false with the data
-- unchanged — the app only offers that to admins).

alter table public.attendance
  add column if not exists confirmed boolean not null default false;

create or replace function public._attendance_lock()
returns trigger language plpgsql as $$
begin
  if old.confirmed and new.confirmed
     and (new.status, new.am_in, new.am_out, new.pm_in, new.pm_out, new.ot_hours,
          new.night_hours, new.late_minutes, new.holiday, new.is_rest_day)
         is distinct from
         (old.status, old.am_in, old.am_out, old.pm_in, old.pm_out, old.ot_hours,
          old.night_hours, old.late_minutes, old.holiday, old.is_rest_day)
  then
    raise exception 'attendance % % is confirmed and locked', old.employee_id, old.date;
  end if;
  if old.confirmed and not new.confirmed
     and (new.status, new.am_in, new.am_out, new.pm_in, new.pm_out, new.ot_hours,
          new.night_hours, new.late_minutes, new.holiday, new.is_rest_day)
         is distinct from
         (old.status, old.am_in, old.am_out, old.pm_in, old.pm_out, old.ot_hours,
          old.night_hours, old.late_minutes, old.holiday, old.is_rest_day)
  then
    raise exception 'unlock attendance % % before editing it', old.employee_id, old.date;
  end if;
  return new;
end $$;

drop trigger if exists attendance_lock on public.attendance;
create trigger attendance_lock before update on public.attendance
  for each row execute function public._attendance_lock();
