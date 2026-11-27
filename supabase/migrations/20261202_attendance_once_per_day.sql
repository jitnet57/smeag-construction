-- One check-in and one check-out per worker per day: once AM IN / PM OUT is
-- saved, only the override accounts ('admin' = Emmeline Hwang,
-- 'carloongos23@gmail.com' = Carlo Ongos) can change or clear it.
-- Raises CHECKIN_DONE / CHECKOUT_DONE. Replaces the guard from
-- 20261201_attendance_times.sql (same rules plus this one).

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
    if old_am is not null and new.am_in is distinct from old_am then
      raise exception 'CHECKIN_DONE: % already checked in on %', new.employee_id, new.date;
    end if;
    if old_pm is not null and new.pm_out is distinct from old_pm then
      raise exception 'CHECKOUT_DONE: % already checked out on %', new.employee_id, new.date;
    end if;
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
