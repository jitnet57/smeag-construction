-- App login accounts (admin / manager / team leader).
-- The tables have RLS on and NO policies, so the public anon key cannot read
-- or write them directly. All access goes through the SECURITY DEFINER
-- functions below; passwords are bcrypt-hashed with pgcrypto.

create table if not exists public.app_accounts (
  username      text primary key,
  display_name  text not null,
  role          text not null check (role in ('admin', 'manager', 'team_leader')),
  crew_id       text references public.crews(id) on update cascade on delete set null,
  password_hash text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table public.app_accounts enable row level security;

create table if not exists public.app_sessions (
  token      uuid primary key default extensions.gen_random_uuid(),
  username   text not null references public.app_accounts(username) on update cascade on delete cascade,
  expires_at timestamptz not null default now() + interval '30 days'
);
alter table public.app_sessions enable row level security;

-- Resolve a session token to its active account (null when invalid/expired).
create or replace function public._app_account_for(p_token uuid)
returns public.app_accounts
language sql stable security definer set search_path = public
as $$
  select a.* from app_sessions s join app_accounts a on a.username = s.username
  where s.token = p_token and s.expires_at > now() and a.active
$$;
revoke all on function public._app_account_for(uuid) from public, anon, authenticated;

create or replace function public._app_account_json(a public.app_accounts)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'username', a.username, 'displayName', a.display_name, 'role', a.role,
    'crewId', a.crew_id, 'active', a.active, 'createdAt', a.created_at)
$$;

create or replace function public.app_login(p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare a app_accounts; t uuid;
begin
  select * into a from app_accounts
   where username = lower(trim(p_username)) and active;
  if a.username is null or a.password_hash <> crypt(p_password, a.password_hash) then
    return null;
  end if;
  delete from app_sessions where expires_at < now();
  insert into app_sessions(username) values (a.username) returning token into t;
  return _app_account_json(a) || jsonb_build_object('token', t);
end $$;

create or replace function public.app_session(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare a app_accounts;
begin
  a := _app_account_for(p_token);
  if a.username is null then return null; end if;
  return _app_account_json(a) || jsonb_build_object('token', p_token);
end $$;

create or replace function public.app_logout(p_token uuid)
returns void language sql security definer set search_path = public
as $$ delete from app_sessions where token = p_token $$;

create or replace function public.app_list_accounts(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare me app_accounts;
begin
  me := _app_account_for(p_token);
  if me.role is distinct from 'admin' then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(_app_account_json(a) order by
      case a.role when 'admin' then 0 when 'manager' then 1 else 2 end, a.username)
    from app_accounts a), '[]'::jsonb);
end $$;

-- Create or update an account. p_password may be null/empty on update to
-- keep the current password.
create or replace function public.app_save_account(
  p_token uuid, p_username text, p_display_name text, p_role text,
  p_crew_id text, p_password text, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare me app_accounts; a app_accounts; u text := lower(trim(p_username));
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
  if exists (select 1 from app_accounts where username = u) then
    update app_accounts set
      display_name = p_display_name, role = p_role,
      crew_id = case when p_role = 'team_leader' then p_crew_id else null end,
      active = p_active,
      password_hash = case when coalesce(p_password, '') = '' then password_hash
                           else crypt(p_password, gen_salt('bf')) end
    where username = u returning * into a;
    if not p_active then delete from app_sessions where username = u; end if;
  else
    if length(coalesce(p_password, '')) < 6 then raise exception 'password too short'; end if;
    insert into app_accounts(username, display_name, role, crew_id, password_hash, active)
    values (u, p_display_name, p_role,
            case when p_role = 'team_leader' then p_crew_id else null end,
            crypt(p_password, gen_salt('bf')), p_active)
    returning * into a;
  end if;
  return _app_account_json(a);
end $$;

create or replace function public.app_delete_account(p_token uuid, p_username text)
returns void language plpgsql security definer set search_path = public
as $$
declare me app_accounts;
begin
  me := _app_account_for(p_token);
  if me.role is distinct from 'admin' then raise exception 'not authorized'; end if;
  if lower(p_username) = me.username then raise exception 'cannot delete yourself'; end if;
  delete from app_accounts where username = lower(p_username);
end $$;

create or replace function public.app_change_password(p_token uuid, p_old text, p_new text)
returns boolean language plpgsql security definer set search_path = public, extensions
as $$
declare me app_accounts;
begin
  me := _app_account_for(p_token);
  if me.username is null or me.password_hash <> crypt(p_old, me.password_hash) then
    return false;
  end if;
  if length(coalesce(p_new, '')) < 6 then raise exception 'password too short'; end if;
  update app_accounts set password_hash = crypt(p_new, gen_salt('bf'))
   where username = me.username;
  return true;
end $$;

grant execute on function public.app_login(text, text),
  public.app_session(uuid), public.app_logout(uuid),
  public.app_list_accounts(uuid),
  public.app_save_account(uuid, text, text, text, text, text, boolean),
  public.app_delete_account(uuid, text),
  public.app_change_password(uuid, text, text)
  to anon, authenticated;

-- Seed accounts. The real initial password is NOT stored in this public repo:
-- replace CHANGE_ME_INITIAL_PASSWORD before running, and change it after first login.
insert into public.app_accounts(username, display_name, role, crew_id, password_hash) values
  ('admin',   'Emmeline Hwang', 'admin',   null, extensions.crypt('CHANGE_ME_INITIAL_PASSWORD', extensions.gen_salt('bf'))),
  ('admin1',  'Jaesun Hwang',   'admin',   null, extensions.crypt('CHANGE_ME_INITIAL_PASSWORD', extensions.gen_salt('bf'))),
  ('carloongos23@gmail.com', 'Carlo Ongos',    'manager', null, extensions.crypt('CHANGE_ME_INITIAL_PASSWORD', extensions.gen_salt('bf')))
on conflict (username) do nothing;

-- One team leader login per crew: tl.<crew>
insert into public.app_accounts(username, display_name, role, crew_id, password_hash)
select 'tl.' || lower(c.id), c.name || ' Team Leader', 'team_leader', c.id,
       extensions.crypt('CHANGE_ME_INITIAL_PASSWORD', extensions.gen_salt('bf'))
from public.crews c
where c.id <> 'UNASSIGNED'
on conflict (username) do nothing;
