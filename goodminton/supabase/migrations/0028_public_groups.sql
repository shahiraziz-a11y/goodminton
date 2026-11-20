-- Public groups: anyone signed in can find a group, look inside (matches, members,
-- rankings; never money) and ask to join; the owner approves. Owners can make a group
-- private (hidden; invite link only). The invite link still joins straight away.
-- Balances: settlements carry when they were marked, for the history list.
-- Run once, after 0027. Safe to run again.

do $$ begin
  if to_regprocedure('public.my_insights(timestamp with time zone)') is null then
    raise exception 'Run 0027_insights.sql first, then this file.';
  end if;
end $$;

alter table public.groups add column if not exists is_public boolean not null default true;

create table if not exists public.group_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz
);
create unique index if not exists group_requests_pending on public.group_requests (group_id, user_id) where status = 'pending';
alter table public.group_requests enable row level security;
revoke all on table public.group_requests from anon, authenticated;

-- A tap-through notification that isn't about a match (push via the existing trigger).
create or replace function public.notify_user(p_user uuid, p_kind text, p_title text, p_body text, p_url text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  if exists (select 1 from public.push_subscriptions where user_id = p_user) then
    insert into public.notifications (user_id, kind, title, body, url) values (p_user, p_kind, p_title, p_body, p_url);
  end if;
  perform public.queue_email(p_user, null, p_kind, p_title, p_body, p_url);
end $$;

-- Public groups (and mine), busiest first; optional name search.
create or replace function public.list_groups(p_search text default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.is_member desc, x.next_match nulls last, x.members desc), '[]'::jsonb) from (
    select g.id, g.name, g.is_public, public.first_name(g.owner_id) as owner,
           (select count(*) from public.group_members m join public.profiles p on p.id = m.user_id
             where m.group_id = g.id and not p.is_guest) as members,
           (select min(starts_at) from public.matches where group_id = g.id and starts_at > now()) as next_match,
           public.is_member(g.id, auth.uid()) as is_member,
           exists (select 1 from public.group_requests r where r.group_id = g.id and r.user_id = auth.uid() and r.status = 'pending') as requested
      from public.groups g
     where (g.is_public or public.is_member(g.id, auth.uid()))
       and (coalesce(btrim(p_search), '') = '' or g.name ilike '%' || btrim(p_search) || '%')
     limit 200) x
  where public.require_user() is not null;
$$;

-- A group's page. Members see everything as before; anyone signed in can see a public
-- group's members and upcoming matches (no court numbers, no costs) and ask to join.
create or replace function public.get_group(p_group uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  g public.groups;
  member boolean;
  owner boolean;
begin
  select * into g from public.groups where id = p_group;
  if not found then raise exception 'Group not found'; end if;
  member := public.is_member(g.id, me);
  if not member and not g.is_public then raise exception 'Group not found'; end if;
  owner := exists (select 1 from public.group_members where group_id = g.id and user_id = me and role = 'owner');
  return jsonb_build_object(
    'id', g.id, 'name', g.name, 'owner_id', g.owner_id, 'is_public', g.is_public,
    'invite_code', case when member then g.invite_code end,
    'my_role', (select role from public.group_members where group_id = g.id and user_id = me),
    'my_status', case when member then 'member'
                      when exists (select 1 from public.group_requests where group_id = g.id and user_id = me and status = 'pending') then 'requested'
                      else 'none' end,
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'is_guest', p.is_guest, 'role', gm.role)
                  order by p.is_guest, gm.role <> 'owner', lower(p.full_name)), '[]'::jsonb)
                  from public.group_members gm join public.profiles p on p.id = gm.user_id
                 where gm.group_id = g.id and (member or not p.is_guest)),
    'upcoming', (select coalesce(jsonb_agg(jsonb_build_object('slug', m.slug, 'title', m.title, 'starts_at', m.starts_at,
                    'timezone', m.timezone, 'venue', m.venue, 'size', m.size,
                    'confirmed', (select count(*) from public.match_players where match_id = m.id and status = 'confirmed'))
                  order by m.starts_at), '[]'::jsonb)
                   from (select * from public.matches where group_id = g.id and starts_at > now() order by starts_at limit 5) m),
    'requests', case when owner then (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'user_id', r.user_id, 'full_name', p.full_name, 'created_at', r.created_at)
                    order by r.created_at), '[]'::jsonb)
                   from public.group_requests r join public.profiles p on p.id = r.user_id
                  where r.group_id = g.id and r.status = 'pending') end);
end $$;

-- My groups, with join requests waiting for me as owner.
create or replace function public.my_groups() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id, 'name', g.name, 'my_role', gm.role, 'is_public', g.is_public,
           'members', (select count(*) from public.group_members x join public.profiles p on p.id = x.user_id
                        where x.group_id = g.id and not p.is_guest),
           'last_match', (select max(starts_at) from public.matches where group_id = g.id),
           'requests', case when gm.role = 'owner' then (select count(*) from public.group_requests r where r.group_id = g.id and r.status = 'pending') else 0 end)
         order by (select max(starts_at) from public.matches where group_id = g.id) desc nulls last, gm.joined_at desc), '[]'::jsonb)
    from public.group_members gm join public.groups g on g.id = gm.group_id
   where gm.user_id = auth.uid();
$$;

create or replace function public.request_join(p_group uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  g public.groups;
begin
  select * into g from public.groups where id = p_group;
  if not found or not g.is_public then raise exception 'Group not found'; end if;
  if public.is_member(g.id, me) then raise exception 'You''re already in this group'; end if;
  if exists (select 1 from public.group_requests where group_id = g.id and user_id = me and status = 'pending') then
    raise exception 'You''ve already asked to join';
  end if;
  insert into public.group_requests (group_id, user_id) values (g.id, me);
  perform public.notify_user(g.owner_id, 'join_request', public.first_name(me) || ' wants to join ' || g.name,
    'Tap to approve or decline.', '/groups/' || g.id);
end $$;

create or replace function public.decide_request(p_request uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  r public.group_requests;
  g public.groups;
begin
  select * into r from public.group_requests where id = p_request for update;
  if not found then raise exception 'Request not found'; end if;
  select * into g from public.groups where id = r.group_id;
  if not exists (select 1 from public.group_members where group_id = g.id and user_id = me and role = 'owner') then
    raise exception 'Only the group owner can decide';
  end if;
  if r.status <> 'pending' then raise exception 'Already decided'; end if;
  update public.group_requests set status = case when p_approve then 'approved' else 'declined' end,
         decided_by = me, decided_at = now() where id = r.id;
  if p_approve then
    perform public.add_member(g.id, r.user_id);
    perform public.notify_user(r.user_id, 'join_approved', 'You''re in ' || g.name, 'See its matches and join one.', '/groups/' || g.id);
  end if;
end $$;

create or replace function public.set_group_public(p_group uuid, p_public boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  if not exists (select 1 from public.group_members where group_id = p_group and user_id = me and role = 'owner') then
    raise exception 'Only the group owner can change this';
  end if;
  update public.groups set is_public = coalesce(p_public, true) where id = p_group;
end $$;

-- Rankings: members, or anyone signed in for a public group. Games and names only.
create or replace function public.get_leaderboard(p_group uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  with grp as (
    select g.id, g.name from public.groups g
     where g.id = coalesce(p_group, public.default_group(auth.uid())) and (public.is_member(g.id, auth.uid()) or (g.is_public and auth.uid() is not null))
  ),
  g as (
    select g.*, m.title as match_title from public.games g
      left join public.matches m on m.id = g.match_id
     where g.group_id = (select id from grp)
     order by g.played_on desc, g.created_at desc
     limit 1000
  )
  select jsonb_build_object(
    'group', (select jsonb_build_object('id', id, 'name', name) from grp),
    'games', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'played_on', played_on, 'match_title', match_title, 'created_by', created_by,
        'a', case when a2 is null then jsonb_build_array(a1) else jsonb_build_array(a1, a2) end,
        'b', case when b2 is null then jsonb_build_array(b1) else jsonb_build_array(b1, b2) end,
        'winner', winner, 'score_a', score_a, 'score_b', score_b)
        order by played_on desc, created_at desc) from g), '[]'::jsonb),
    'people', coalesce((select jsonb_object_agg(p.id, p.full_name) from public.profiles p
        where p.id in (select x from g, unnest(array[a1, a2, b1, b2]) x where x is not null)), '{}'::jsonb)
  );
$$;

-- Balances: settlements say when they were marked, and by whom.
create or replace function public.my_ledger() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'slug', m.slug, 'title', m.title, 'starts_at', m.starts_at,
    'timezone', m.timezone, 'currency', m.currency,
    'group_id', m.group_id, 'group_name', (select name from public.groups where id = m.group_id),
    'players', to_jsonb(public.split_ids(m.id)),
    'expenses', (select coalesce(jsonb_agg(jsonb_build_object('amount', amount, 'paid_by', paid_by)), '[]'::jsonb)
                   from public.expenses where match_id = m.id),
    'settlements', (select coalesce(jsonb_agg(jsonb_build_object('from', from_user, 'to', to_user, 'amount', amount, 'settled_at', settled_at, 'settled_by', settled_by)), '[]'::jsonb)
                      from public.settlements where match_id = m.id),
    -- Guest → who pays their share (and should collect it from them).
    'guests', (select coalesce(jsonb_object_agg(h.id, public.payer_for(m, h.id)), '{}'::jsonb)
                 from unnest(public.share_holders(m.id)) h(id) join public.profiles p on p.id = h.id
                where p.is_guest),
    'people', (select coalesce(jsonb_object_agg(p.id, p.full_name), '{}'::jsonb) from public.profiles p
                where p.id in (select paid_by from public.expenses where match_id = m.id
                               union select unnest(public.split_ids(m.id))
                               union select unnest(public.share_holders(m.id))))
  ) order by m.starts_at desc), '[]'::jsonb)
  from public.matches m
  where public.split_ready(m.id)
    and (m.organiser_id = auth.uid() or auth.uid() = any (public.split_ids(m.id))
         -- Paid for something (e.g. booked a court) and then dropped out: still owed.
         or exists (select 1 from public.expenses e where e.match_id = m.id and e.paid_by = auth.uid()));
$$;

revoke all on function public.notify_user(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.list_groups(text) from public, anon;
revoke all on function public.request_join(uuid) from public, anon;
revoke all on function public.decide_request(uuid, boolean) from public, anon;
revoke all on function public.set_group_public(uuid, boolean) from public, anon;
grant execute on function public.list_groups(text) to authenticated;
grant execute on function public.request_join(uuid) to authenticated;
grant execute on function public.decide_request(uuid, boolean) to authenticated;
grant execute on function public.set_group_public(uuid, boolean) to authenticated;
