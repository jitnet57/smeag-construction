-- Phone login (pelham-shift style): a team leader / manager types only the
-- last 4 digits of their phone number. The server shows the matching name so
-- they can confirm it is them, then logs them in. Admin accounts never log in
-- this way — they keep user ID + password.
--
-- Because the last 4 digits are the whole credential, two active accounts may
-- not share them (enforced in app_save_account). If they ever do, phone login
-- for those digits is refused instead of picking one of them.

alter table public.app_accounts add column if not exists phone text;

-- Last 4 digits of a phone number ('' when it has fewer than 4 digits).
create or replace function public._app_phone_last4(p text)
returns text language sql immutable as $$
  select case when length(d) >= 4 then right(d, 4) else '' end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

create or replace function public._app_account_json(a public.app_accounts)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'username', a.username, 'displayName', a.display_name, 'role', a.role,
    'crewId', a.crew_id, 'phone', coalesce(a.phone, ''),
    'active', a.active, 'createdAt', a.created_at)
$$;

-- Accounts that phone login with these digits would reach.
create or replace function public._app_phone_matches(p_digits text)
returns setof public.app_accounts
language sql stable security definer set search_path = public
as $$
  select * from app_accounts
  where active and role <> 'admin'
    and p_digits ~ '^\d{4}$'
    and _app_phone_last4(phone) = p_digits
$$;
revoke all on function public._app_phone_matches(text) from public, anon, authenticated;

-- Name shown on the login screen once 4 digits are typed (null when no
-- single account matches).
create or replace function public.app_phone_lookup(p_digits text)
returns text language plpgsql stable security definer set search_path = public
as $$
declare n int; name text;
begin
  select count(*), min(display_name) into n, name from _app_phone_matches(trim(p_digits));
  if n = 1 then return name; end if;
  return null;
end $$;

create or replace function public.app_login_phone(p_digits text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare a app_accounts; n int; t uuid;
begin
  select count(*) into n from _app_phone_matches(trim(p_digits));
  if n <> 1 then return null; end if;
  select * into a from _app_phone_matches(trim(p_digits));
  delete from app_sessions where expires_at < now();
  insert into app_sessions(username) values (a.username) returning token into t;
  return _app_account_json(a) || jsonb_build_object('token', t);
end $$;

-- app_save_account gains p_phone.
drop function if exists public.app_save_account(uuid, text, text, text, text, text, boolean);
create or replace function public.app_save_account(
  p_token uuid, p_username text, p_display_name text, p_role text,
  p_crew_id text, p_password text, p_active boolean, p_phone text)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare me app_accounts; a app_accounts; u text := lower(trim(p_username));
        ph text := nullif(trim(coalesce(p_phone, '')), '');
begin
  me := _app_account_for(p_token);
  if me.role is distinct from 'admin' then raise exception 'not authorized'; end if;
  if u !~ '^[a-z0-9._@+-]{3,64}$' then raise exception 'invalid username'; end if;
  if p_role = 'team_leader' and coalesce(p_crew_id, '') = '' then
    raise exception 'team leader needs a crew';
  end if;
  if u = me.username and (p_role <> 'admin' or not p_active) then
    raise exception 'cannot demote or disable yourself';
  end if;
  if ph is not null and _app_phone_last4(ph) = '' then
    raise exception 'phone needs at least 4 digits';
  end if;
  if ph is not null and p_active and exists (
    select 1 from app_accounts
    where username <> u and active and _app_phone_last4(phone) = _app_phone_last4(ph)
  ) then
    raise exception 'phone last 4 digits already used';
  end if;
  if exists (select 1 from app_accounts where username = u) then
    update app_accounts set
      display_name = p_display_name, role = p_role,
      crew_id = case when p_role = 'team_leader' then p_crew_id else null end,
      phone = ph,
      active = p_active,
      password_hash = case when coalesce(p_password, '') = '' then password_hash
                           else crypt(p_password, gen_salt('bf')) end
    where username = u returning * into a;
    if not p_active then delete from app_sessions where username = u; end if;
  else
    if length(coalesce(p_password, '')) < 6 then raise exception 'password too short'; end if;
    insert into app_accounts(username, display_name, role, crew_id, phone, password_hash, active)
    values (u, p_display_name, p_role,
            case when p_role = 'team_leader' then p_crew_id else null end,
            ph, crypt(p_password, gen_salt('bf')), p_active)
    returning * into a;
  end if;
  return _app_account_json(a);
end $$;

grant execute on function public.app_phone_lookup(text),
  public.app_login_phone(text),
  public.app_save_account(uuid, text, text, text, text, text, boolean, text)
  to anon, authenticated;
