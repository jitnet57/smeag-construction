-- Admin phone login: admin accounts may now also log in with the last 4 digits
-- of their phone (admin → 2222, admin1 → 3333). After login the app lets an
-- admin choose the staff (field) screen or the admin screen.
-- User ID + password login keeps working for everyone.
--
-- Because 4 digits now open an admin account, failed phone attempts are
-- throttled per client IP: after 10 misses in 10 minutes, phone lookup and
-- phone login are refused for that IP until the window passes.
-- Requires 20261127_app_accounts_phone_login.sql.

-- Accounts that phone login with these digits would reach (admins included).
create or replace function public._app_phone_matches(p_digits text)
returns setof public.app_accounts
language sql stable security definer set search_path = public
as $$
  select * from app_accounts
  where active
    and p_digits ~ '^\d{4}$'
    and _app_phone_last4(phone) = p_digits
$$;
revoke all on function public._app_phone_matches(text) from public, anon, authenticated;

-- Failed phone attempts, for throttling.
create table if not exists public.app_phone_attempts (
  id bigserial primary key,
  client text not null,
  at timestamptz not null default now()
);
create index if not exists app_phone_attempts_client_at on public.app_phone_attempts (client, at);
alter table public.app_phone_attempts enable row level security;
revoke all on public.app_phone_attempts from anon, authenticated;

-- Caller's IP as forwarded by the API gateway ('' when unknown).
create or replace function public._app_client_ip()
returns text language sql stable
as $$
  select coalesce(split_part(
    (nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for'),
    ',', 1), '')
$$;

create or replace function public._app_phone_blocked()
returns boolean language sql stable security definer set search_path = public
as $$
  select count(*) >= 10 from app_phone_attempts
  where client = _app_client_ip() and at > now() - interval '10 minutes'
$$;
revoke all on function public._app_phone_blocked() from public, anon, authenticated;

create or replace function public._app_phone_failed()
returns void language sql volatile security definer set search_path = public
as $$
  delete from app_phone_attempts where at < now() - interval '1 day';
  insert into app_phone_attempts(client) values (_app_client_ip());
$$;
revoke all on function public._app_phone_failed() from public, anon, authenticated;

-- Name shown on the login screen once 4 digits are typed.
create or replace function public.app_phone_lookup(p_digits text)
returns text language plpgsql volatile security definer set search_path = public
as $$
declare n int; name text;
begin
  if _app_phone_blocked() then return null; end if;
  select count(*), min(display_name) into n, name from _app_phone_matches(trim(p_digits));
  if n = 1 then return name; end if;
  perform _app_phone_failed();
  return null;
end $$;

create or replace function public.app_login_phone(p_digits text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare a app_accounts; n int; t uuid;
begin
  if _app_phone_blocked() then return null; end if;
  select count(*) into n from _app_phone_matches(trim(p_digits));
  if n <> 1 then
    perform _app_phone_failed();
    return null;
  end if;
  select * into a from _app_phone_matches(trim(p_digits));
  delete from app_sessions where expires_at < now();
  insert into app_sessions(username) values (a.username) returning token into t;
  return _app_account_json(a) || jsonb_build_object('token', t);
end $$;

grant execute on function public.app_phone_lookup(text), public.app_login_phone(text)
  to anon, authenticated;

-- Give the two admin accounts their 4 digits (only if nobody else uses them).
update public.app_accounts a set phone = v.phone
from (values ('admin', '2222'), ('admin1', '3333')) as v(username, phone)
where a.username = v.username
  and not exists (
    select 1 from public.app_accounts o
    where o.username <> v.username and o.active
      and public._app_phone_last4(o.phone) = v.phone);
