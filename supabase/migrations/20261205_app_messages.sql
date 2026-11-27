-- Team messages (in-app), modelled on pelham-shift's Messages screen.
--   app_messages            one row per message (sender, body, optional reply)
--   app_message_recipients  one row per recipient, with the time they pressed
--                           "Mark as read"
-- Who sees what:
--   admin / manager  every team message ("Team messages")
--   team leader      messages they sent or received
-- Read: each recipient confirms with "Mark as read". Delete: admin only.
-- Like app_accounts, the tables have RLS on and NO policies: all access goes
-- through the SECURITY DEFINER functions below, which take the login token.
-- Requires 20261126_app_accounts.sql.

create table if not exists public.app_messages (
  id          bigserial primary key,
  sender      text references public.app_accounts(username) on update cascade on delete set null,
  sender_name text not null,
  body        text not null check (length(btrim(body)) between 1 and 4000),
  reply_to    bigint references public.app_messages(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists app_messages_created_idx on public.app_messages (created_at desc);

create table if not exists public.app_message_recipients (
  message_id     bigint not null references public.app_messages(id) on delete cascade,
  username       text not null references public.app_accounts(username) on update cascade on delete cascade,
  recipient_name text not null,
  read_at        timestamptz,
  primary key (message_id, username)
);
create index if not exists app_message_recipients_user_idx
  on public.app_message_recipients (username) where read_at is null;

alter table public.app_messages enable row level security;
alter table public.app_message_recipients enable row level security;
revoke all on public.app_messages, public.app_message_recipients from anon, authenticated;

create or replace function public._app_require(p_token uuid)
returns public.app_accounts language plpgsql stable security definer set search_path = public
as $$
declare me app_accounts;
begin
  me := _app_account_for(p_token);
  if me.username is null then raise exception 'not authorized'; end if;
  return me;
end $$;
revoke all on function public._app_require(uuid) from public, anon, authenticated;

-- Everyone a logged-in user can write to (active accounts except themself).
create or replace function public.app_message_recipients(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare me app_accounts := _app_require(p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'username', a.username, 'displayName', a.display_name,
      'role', a.role, 'crewId', a.crew_id)
    order by case a.role when 'admin' then 0 when 'manager' then 1 else 2 end, a.display_name)
    from app_accounts a where a.active and a.username <> me.username), '[]'::jsonb);
end $$;

-- Newest first. Each message lists its recipients with their read time.
create or replace function public.app_messages(p_token uuid, p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare me app_accounts := _app_require(p_token);
begin
  return coalesce((select jsonb_agg(row order by (row ->> 'createdAt') desc) from (
    select jsonb_build_object(
      'id', m.id, 'from', m.sender, 'fromName', m.sender_name, 'body', m.body,
      'replyTo', m.reply_to, 'createdAt', m.created_at,
      'replyToBody', (select left(p.body, 140) from app_messages p where p.id = m.reply_to),
      'replyToName', (select p.sender_name from app_messages p where p.id = m.reply_to),
      'to', coalesce((select jsonb_agg(jsonb_build_object(
          'username', r.username, 'name', r.recipient_name, 'readAt', r.read_at)
          order by r.recipient_name)
        from app_message_recipients r where r.message_id = m.id), '[]'::jsonb)
    ) as row
    from app_messages m
    where me.role in ('admin', 'manager')
       or m.sender = me.username
       or exists (select 1 from app_message_recipients r
                  where r.message_id = m.id and r.username = me.username)
    order by m.created_at desc
    limit greatest(1, least(coalesce(p_limit, 200), 500))
  ) q), '[]'::jsonb);
end $$;

-- Messages to me that I have not read yet.
create or replace function public.app_message_unread(p_token uuid)
returns int language sql stable security definer set search_path = public
as $$
  select count(*)::int from app_message_recipients r
  where r.username = (_app_require(p_token)).username and r.read_at is null
$$;

create or replace function public.app_send_message(
  p_token uuid, p_to text[], p_body text, p_reply_to bigint default null)
returns bigint language plpgsql security definer set search_path = public
as $$
declare me app_accounts := _app_require(p_token); new_id bigint; n int;
begin
  if length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'message is empty'; end if;
  if length(p_body) > 4000 then raise exception 'message is too long'; end if;
  if p_reply_to is not null and not exists (select 1 from app_messages where id = p_reply_to) then
    p_reply_to := null;
  end if;
  insert into app_messages(sender, sender_name, body, reply_to)
  values (me.username, me.display_name, btrim(p_body), p_reply_to)
  returning id into new_id;
  insert into app_message_recipients(message_id, username, recipient_name)
  select new_id, a.username, a.display_name from app_accounts a
  where a.active and a.username = any(p_to) and a.username <> me.username;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'choose at least one recipient'; end if;
  return new_id;
end $$;

-- Mark every unread message to me as read (or only p_ids when given).
create or replace function public.app_mark_messages_read(p_token uuid, p_ids bigint[] default null)
returns int language plpgsql security definer set search_path = public
as $$
declare me app_accounts := _app_require(p_token); n int;
begin
  update app_message_recipients set read_at = now()
  where username = me.username and read_at is null
    and (p_ids is null or message_id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

-- Only an admin deletes a message (for everyone), as in pelham-shift.
create or replace function public.app_delete_message(p_token uuid, p_id bigint)
returns void language plpgsql security definer set search_path = public
as $$
declare me app_accounts := _app_require(p_token);
begin
  if me.role <> 'admin' then raise exception 'only an admin can delete messages'; end if;
  delete from app_messages where id = p_id;
end $$;

grant execute on function public.app_message_recipients(uuid) to anon, authenticated;
grant execute on function public.app_messages(uuid, int) to anon, authenticated;
grant execute on function public.app_message_unread(uuid) to anon, authenticated;
grant execute on function public.app_send_message(uuid, text[], text, bigint) to anon, authenticated;
grant execute on function public.app_mark_messages_read(uuid, bigint[]) to anon, authenticated;
grant execute on function public.app_delete_message(uuid, bigint) to anon, authenticated;
