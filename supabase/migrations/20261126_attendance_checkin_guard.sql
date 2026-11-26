-- Server-side enforcement of the 07:00 morning check-in cutoff.
-- Requires 20261126_app_accounts.sql and 20261126_attendance_confirm.sql.
--
-- The app sends its login session token in the `x-app-token` request header
-- (also stored with queued offline writes, so they replay as the same user).
-- Rules, checked by the database clock (now(), Asia/Manila), not the phone:
--   * writing attendance requires a valid login
--   * after 07:00 on the work date, AM IN can only be changed by a team leader
--   * team leaders can only write rows for workers in their own crew
--   * only admins can unlock a confirmed row
--   * only admins / managers can delete attendance rows
-- Direct database sessions (SQL editor, service role) are not restricted.

-- Server clock for the app (so the on-screen lock ignores the phone's clock).
create or replace function public.app_server_time()
returns timestamptz language sql stable as $$ select now() $$;
grant execute on function public.app_server_time() to anon, authenticated;

-- Account behind the current HTTP request's x-app-token header, if any.
create or replace function public._app_request_account()
returns public.app_accounts
language plpgsql stable security definer set search_path = public
as $$
declare tok text;
begin
  tok := nullif(current_setting('request.headers', true), '')::json ->> 'x-app-token';
  if tok is null or tok !~ '^[0-9a-fA-F-]{36}$' then return null; end if;
  return _app_account_for(tok::uuid);
end $$;
revoke all on function public._app_request_account() from public;
grant execute on function public._app_request_account() to anon, authenticated;

create or replace function public._app_request_role()
returns text language sql stable security definer set search_path = public
as $$ select (public._app_request_account()).role $$;
grant execute on function public._app_request_role() to anon, authenticated;

-- RLS: anyone may read attendance (payroll screens), only logged-in app
-- users may write it.
drop policy if exists anon_all on public.attendance;
drop policy if exists attendance_read on public.attendance;
drop policy if exists attendance_insert on public.attendance;
drop policy if exists attendance_update on public.attendance;
drop policy if exists attendance_delete on public.attendance;
create policy attendance_read on public.attendance
  for select to anon, authenticated using (true);
create policy attendance_insert on public.attendance
  for insert to anon, authenticated with check (public._app_request_role() is not null);
create policy attendance_update on public.attendance
  for update to anon, authenticated
  using (public._app_request_role() is not null)
  with check (public._app_request_role() is not null);
create policy attendance_delete on public.attendance
  for delete to anon, authenticated
  using (public._app_request_role() in ('admin', 'manager'));

create or replace function public._attendance_checkin_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  me app_accounts;
  old_am numeric;
  old_confirmed boolean := false;
  closed boolean;
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
  else
    old_am := old.am_in;
    old_confirmed := old.confirmed;
  end if;

  if me.role = 'team_leader' and not exists (
       select 1 from employees where id = new.employee_id and crew_id = me.crew_id) then
    raise exception 'team leader % can only edit crew %', me.username, me.crew_id;
  end if;

  closed := now() >= ((new.date::date + time '07:00') at time zone 'Asia/Manila');
  if closed and me.role <> 'team_leader' and new.am_in is distinct from old_am then
    raise exception 'CHECKIN_CLOSED: AM IN for % on % closed at 07:00; only a team leader can change it',
      new.employee_id, new.date;
  end if;

  if old_confirmed and not new.confirmed and me.role <> 'admin' then
    raise exception 'only an admin can unlock confirmed attendance';
  end if;
  return new;
end $$;

drop trigger if exists attendance_checkin_guard on public.attendance;
create trigger attendance_checkin_guard before insert or update on public.attendance
  for each row execute function public._attendance_checkin_guard();
