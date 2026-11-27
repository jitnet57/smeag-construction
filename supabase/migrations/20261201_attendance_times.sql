-- Check-in / check-out windows from Settings (config.data -> 'attendanceTimes').
--   checkIn           "07:00"  AM IN closes at this time on the work date
--   checkOut          "17:00"  scheduled check-out time
--   checkOutGraceMin  15       PM OUT closes checkOut + this many minutes
-- After a cutoff only the override accounts can change that time:
-- 'admin' (Emmeline Hwang) and 'carloongos23@gmail.com' (Carlo Ongos).
-- Team leaders lose the AM IN override they had before. Keep the list in sync
-- with TIME_OVERRIDE_USERS in apps/web/src/auth.tsx. Judged by the database clock, Asia/Manila. Missing / invalid values
-- fall back to the defaults above.
-- Replaces the guard from 20261126_attendance_checkin_guard.sql.

create or replace function public._attendance_times()
returns table (check_in time, check_out_close time)
language plpgsql stable security definer set search_path = public
as $$
declare
  a jsonb;
  ci text; co text; grace int;
begin
  select c.data::jsonb -> 'attendanceTimes' into a from config c where c.id = 1;
  ci := a ->> 'checkIn';
  co := a ->> 'checkOut';
  if ci is null or ci !~ '^([01]\d|2[0-3]):[0-5]\d$' then ci := '07:00'; end if;
  if co is null or co !~ '^([01]\d|2[0-3]):[0-5]\d$' then co := '17:00'; end if;
  begin
    grace := round((a ->> 'checkOutGraceMin')::numeric);
  exception when others then grace := null;
  end;
  if grace is null or grace < 0 then grace := 15; end if;
  check_in := ci::time;
  -- Capped at 23:59 so a large grace never wraps past midnight.
  check_out_close := time '00:00' + make_interval(mins => least(
    extract(hour from co::time)::int * 60 + extract(minute from co::time)::int + grace,
    23 * 60 + 59));
  return next;
end $$;
revoke all on function public._attendance_times() from public;

create or replace function public._attendance_checkin_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  me app_accounts;
  old_am numeric;
  old_pm numeric;
  old_confirmed boolean := false;
  win record;
begin
  -- Only requests coming through the API as anon/authenticated are checked.
  if current_user not in ('anon', 'authenticated') then return new; end if;

  me := _app_request_account();
  if me.username is null then raise exception 'login required'; end if;

  if tg_op = 'INSERT' then
    -- An upsert that hits an existing row is checked by the UPDATE trigger.
    if exists (select 1 from attendance
               where employee_id = new.employee_id and date = new.date) then
      return new;
    end if;
    old_am := null;
    old_pm := null;
  else
    old_am := old.am_in;
    old_pm := old.pm_out;
    old_confirmed := old.confirmed;
  end if;

  if me.role = 'team_leader' and not exists (
       select 1 from employees where id = new.employee_id and crew_id = me.crew_id) then
    raise exception 'team leader % can only edit crew %', me.username, me.crew_id;
  end if;

  select * into win from _attendance_times();

  if me.username not in ('admin', 'carloongos23@gmail.com') then
    if new.am_in is distinct from old_am
       and now() >= ((new.date::date + win.check_in) at time zone 'Asia/Manila') then
      raise exception 'CHECKIN_CLOSED: AM IN for % on % closed at %; only Emmeline Hwang or Carlo can change it',
        new.employee_id, new.date, to_char(win.check_in, 'HH24:MI');
    end if;
    if new.pm_out is distinct from old_pm
       and now() >= ((new.date::date + win.check_out_close) at time zone 'Asia/Manila') then
      raise exception 'CHECKOUT_CLOSED: PM OUT for % on % closed at %; only Emmeline Hwang or Carlo can change it',
        new.employee_id, new.date, to_char(win.check_out_close, 'HH24:MI');
    end if;
  end if;

  if old_confirmed and not new.confirmed and me.role <> 'admin' then
    raise exception 'only an admin can unlock confirmed attendance';
  end if;
  return new;
end $$;

drop trigger if exists attendance_checkin_guard on public.attendance;
create trigger attendance_checkin_guard before insert or update on public.attendance
  for each row execute function public._attendance_checkin_guard();
