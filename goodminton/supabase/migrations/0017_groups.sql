-- Groups, like Splitwise: every match belongs to a group, and you see the matches, leaderboard
-- and people of the groups you're in (plus any match you're in yourself). Joining a group is by
-- invite link; joining a match from its link also makes you a member of its group.
-- Everyone who has used the app so far goes into one starter group, with every past match and
-- game, so nothing changes for them.
-- Run once, after 0016. Safe to run again.

do $$ begin
  if to_regprocedure('public.my_stats()') is null or to_regprocedure('public.join_match(uuid, integer)') is null then
    raise exception 'Run 0016_no_regulars_first.sql first, then this file.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique,
  owner_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
alter table public.groups enable row level security;

create table if not exists public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user_idx on public.group_members (user_id);
alter table public.group_members enable row level security;

alter table public.matches add column if not exists group_id uuid references public.groups (id);
alter table public.games add column if not exists group_id uuid references public.groups (id);
create index if not exists matches_group_idx on public.matches (group_id, starts_at desc);
create index if not exists games_group_idx on public.games (group_id, played_on desc);

revoke all on table public.groups, public.group_members from anon, authenticated;

-- 12 letters and digits, easy to read aloud (no 0/O, 1/l).
create or replace function public.new_invite_code() returns text
language sql volatile as $$
  select string_agg(substr('abcdefghjkmnpqrstuvwxyz23456789', 1 + floor(random() * 31)::int, 1), '')
    from generate_series(1, 12);
$$;

-- ---------------------------------------------------------------------------
-- Starter group: everyone so far, every match and game so far.
-- ---------------------------------------------------------------------------

do $$
declare
  g uuid;
  v_owner uuid;
begin
  if exists (select 1 from public.matches where group_id is null)
     or exists (select 1 from public.games where group_id is null)
     or (exists (select 1 from public.profiles) and not exists (select 1 from public.groups)) then
    select id into g from public.groups order by created_at limit 1;
    if g is null then
      -- Owner: whoever organised the most matches (the person who runs the app today).
      select coalesce(
        (select organiser_id from public.matches group by organiser_id order by count(*) desc, min(created_at) limit 1),
        (select id from public.profiles where not is_guest order by created_at limit 1)) into v_owner;
      if v_owner is null then return; end if;
      insert into public.groups (name, invite_code, owner_id) values ('Goodminton crew', public.new_invite_code(), v_owner)
      returning id into g;
    end if;
    insert into public.group_members (group_id, user_id, role)
    select g, p.id, case when p.id = (select owner_id from public.groups where id = g) then 'owner' else 'member' end
      from public.profiles p
    on conflict do nothing;
    update public.matches set group_id = g where group_id is null;
    update public.games x set group_id = coalesce((select group_id from public.matches where id = x.match_id), g) where group_id is null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_member(p_group uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members where group_id = p_group and user_id = p_user);
$$;

create or replace function public.add_member(p_group uuid, p_user uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.group_members (group_id, user_id) select p_group, p_user where p_group is not null and p_user is not null
  on conflict do nothing;
$$;

-- The group a person most likely means: their latest match's group, else the group they joined last.
create or replace function public.default_group(p_user uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select m.group_id from public.matches m
      where m.group_id in (select group_id from public.group_members where user_id = p_user)
        and (m.organiser_id = p_user or exists (select 1 from public.match_players where match_id = m.id and user_id = p_user))
      order by m.starts_at desc limit 1),
    (select group_id from public.group_members where user_id = p_user order by joined_at desc limit 1));
$$;

-- The group to use, checking membership; someone with no group yet gets their own.
create or replace function public.pick_group(p_user uuid, p_group uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare g uuid := coalesce(p_group, public.default_group(p_user));
begin
  if g is null then
    insert into public.groups (name, invite_code, owner_id)
    values (left(public.first_name(p_user) || '''s group', 60), public.new_invite_code(), p_user) returning id into g;
    insert into public.group_members (group_id, user_id, role) values (g, p_user, 'owner');
  elsif not public.is_member(g, p_user) then
    raise exception 'You''re not in that group';
  end if;
  return g;
end $$;

-- People I can add to matches and log games with: everyone in my groups (guests included).
create or replace function public.circle_of(u uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select u
  union select gm.user_id from public.group_members mine
          join public.group_members gm on gm.group_id = mine.group_id
         where mine.user_id = u;
$$;

-- A weekly copy (or any match inserted without a group) takes its series' or organiser's group.
create or replace function public.match_default_group() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.group_id is null then
    new.group_id := coalesce(
      (select group_id from public.matches where id = new.series_id),
      (select group_id from public.matches where series_id = new.series_id and group_id is not null order by starts_at desc limit 1),
      public.pick_group(new.organiser_id, null));
  end if;
  return new;
end $$;
drop trigger if exists matches_default_group on public.matches;
create trigger matches_default_group before insert on public.matches
  for each row execute function public.match_default_group();

create or replace function public.game_default_group() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.group_id is null then
    new.group_id := coalesce((select group_id from public.matches where id = new.match_id), public.default_group(new.created_by));
  end if;
  return new;
end $$;
drop trigger if exists games_default_group on public.games;
create trigger games_default_group before insert on public.games
  for each row execute function public.game_default_group();

-- Anyone in a match (players, waitlist, guests) is in its group.
create or replace function public.player_joins_group() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.add_member((select group_id from public.matches where id = new.match_id), new.user_id);
  return new;
end $$;
drop trigger if exists match_players_group on public.match_players;
create trigger match_players_group after insert on public.match_players
  for each row execute function public.player_joins_group();

-- ---------------------------------------------------------------------------
-- Groups: create, view, invite, join, leave, manage
-- ---------------------------------------------------------------------------

create or replace function public.create_group(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user(); g uuid;
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 60 then raise exception 'Give the group a name'; end if;
  insert into public.groups (name, invite_code, owner_id) values (btrim(p_name), public.new_invite_code(), me) returning id into g;
  insert into public.group_members (group_id, user_id, role) values (g, me, 'owner');
  return g;
end $$;

create or replace function public.require_group_owner(p_group uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  if not exists (select 1 from public.groups where id = p_group) then raise exception 'Group not found'; end if;
  if (select owner_id from public.groups where id = p_group) <> me then raise exception 'Only the group owner can do that'; end if;
  return me;
end $$;

create or replace function public.rename_group(p_group uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_group_owner(p_group);
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 60 then raise exception 'Give the group a name'; end if;
  update public.groups set name = btrim(p_name) where id = p_group;
end $$;

create or replace function public.reset_invite(p_group uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text := public.new_invite_code();
begin
  perform public.require_group_owner(p_group);
  update public.groups set invite_code = c where id = p_group;
  return c;
end $$;

create or replace function public.my_groups() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id, 'name', g.name, 'my_role', gm.role,
           'members', (select count(*) from public.group_members x join public.profiles p on p.id = x.user_id
                        where x.group_id = g.id and not p.is_guest),
           'last_match', (select max(starts_at) from public.matches where group_id = g.id))
         order by (select max(starts_at) from public.matches where group_id = g.id) desc nulls last, gm.joined_at desc), '[]'::jsonb)
    from public.group_members gm join public.groups g on g.id = gm.group_id
   where gm.user_id = auth.uid();
$$;

-- Members only: name, invite code, members (people first, then guests).
create or replace function public.get_group(p_group uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.require_user(); g public.groups;
begin
  select * into g from public.groups where id = p_group;
  if not found or not public.is_member(g.id, me) then raise exception 'Group not found'; end if;
  return jsonb_build_object(
    'id', g.id, 'name', g.name, 'invite_code', g.invite_code, 'owner_id', g.owner_id,
    'my_role', (select role from public.group_members where group_id = g.id and user_id = me),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'is_guest', p.is_guest, 'role', gm.role)
                  order by p.is_guest, gm.role <> 'owner', lower(p.full_name)), '[]'::jsonb)
                  from public.group_members gm join public.profiles p on p.id = gm.user_id where gm.group_id = g.id));
end $$;

-- The join page: anyone holding the link sees the name and size, signed in or not.
create or replace function public.group_preview(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', g.id, 'name', g.name,
           'owner', public.first_name(g.owner_id),
           'members', (select count(*) from public.group_members x join public.profiles p on p.id = x.user_id
                        where x.group_id = g.id and not p.is_guest),
           'is_member', auth.uid() is not null and public.is_member(g.id, auth.uid()))
    from public.groups g where g.invite_code = lower(btrim(p_code));
$$;

create or replace function public.join_group(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user(); g uuid;
begin
  select id into g from public.groups where invite_code = lower(btrim(p_code));
  if g is null then raise exception 'This invite link has expired. Ask for a new one.'; end if;
  perform public.add_member(g, me);
  return g;
end $$;

create or replace function public.leave_group(p_group uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  if not public.is_member(p_group, me) then raise exception 'You''re not in that group'; end if;
  if (select owner_id from public.groups where id = p_group) = me then
    raise exception 'Make someone else the owner before you leave';
  end if;
  delete from public.group_members where group_id = p_group and user_id = me;
end $$;

-- Removing someone takes away their view of the group. Matches they're in stay as they are.
create or replace function public.remove_member(p_group uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_group_owner(p_group);
begin
  if p_user = me then raise exception 'You''re the owner. Make someone else the owner first.'; end if;
  delete from public.group_members where group_id = p_group and user_id = p_user;
end $$;

create or replace function public.make_owner(p_group uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_group_owner(p_group);
begin
  if not exists (select 1 from public.group_members gm join public.profiles p on p.id = gm.user_id
                  where gm.group_id = p_group and gm.user_id = p_user and not p.is_guest) then
    raise exception 'Pick someone in the group';
  end if;
  update public.groups set owner_id = p_user where id = p_group;
  update public.group_members set role = case when user_id = p_user then 'owner' else 'member' end
   where group_id = p_group and user_id in (me, p_user);
end $$;

-- ---------------------------------------------------------------------------
-- Creating matches, guests and games in a group
-- ---------------------------------------------------------------------------

drop function if exists public.create_match(text, text, integer, text, date, time without time zone, text, integer, integer, text);
create or replace function public.create_match(p_title text, p_format text, p_court_count integer, p_venue text, p_date date,
  p_time time without time zone, p_timezone text, p_duration_min integer, p_rsvp_close_hours integer,
  p_currency text default 'AED', p_group uuid default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  g uuid := public.pick_group(me, p_group);
  v_slug text;
  v_id uuid;
begin
  if p_format not in ('singles', 'doubles') then raise exception 'Pick singles or doubles'; end if;
  if p_court_count not between 1 and 4 then raise exception 'Pick 1 to 4 courts'; end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    p_timezone := 'UTC';
  end if;
  v_slug := coalesce(nullif(left(trim(both '-' from regexp_replace(lower(p_title), '[^a-z0-9]+', '-', 'g')), 24), ''), 'match')
            || '-' || substr(md5(gen_random_uuid()::text), 1, 6);

  insert into public.matches (slug, organiser_id, title, format, court_count, size, venue, starts_at,
                              duration_min, rsvp_close_hours, currency, timezone, group_id)
  values (v_slug, me, btrim(p_title), p_format, p_court_count,
          p_court_count * case p_format when 'singles' then 2 else 4 end,
          btrim(coalesce(p_venue, '')), (p_date + p_time) at time zone p_timezone,
          p_duration_min, p_rsvp_close_hours, coalesce(p_currency, 'AED'), p_timezone, g)
  returning id into v_id;

  insert into public.match_players (match_id, user_id, status) values (v_id, me, 'confirmed');
  return v_slug;
end $$;

-- A guest (no login) belongs to a group, so they can be picked again there.
drop function if exists public.create_guest(text);
create or replace function public.create_guest(p_name text, p_group uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user(); g uuid := public.pick_group(me, p_group); v uuid;
begin
  v := public.new_guest(p_name, me);
  perform public.add_member(g, v);
  return v;
end $$;

-- Someone you add must be in the match's group (a new guest joins it).
create or replace function public.add_player(p_match uuid, p_user uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  m public.matches := public.lock_match(p_match);
  v_user uuid := p_user;
  n_conf int;
  n_wait int;
begin
  if me <> m.organiser_id and not exists (
    select 1 from public.match_players where match_id = m.id and user_id = me and status = 'confirmed') then
    raise exception 'Join the match first to add players';
  end if;
  if public.match_past(m) then raise exception 'This match has already been played'; end if;
  if v_user is null then
    v_user := public.new_guest(p_name, me);
  elsif not public.is_member(m.group_id, v_user) then
    raise exception 'You can only add people in this group';
  end if;
  if exists (select 1 from public.match_players where match_id = m.id and user_id = v_user) then
    raise exception 'Already in this match';
  end if;
  select count(*) filter (where status = 'confirmed'), count(*) filter (where status = 'waitlist')
    into n_conf, n_wait from public.match_players where match_id = m.id;
  if n_conf < m.size then
    insert into public.match_players (match_id, user_id, status, added_by) values (m.id, v_user, 'confirmed', me);
    return jsonb_build_object('status', 'confirmed', 'filled', n_conf + 1 = m.size);
  end if;
  insert into public.match_players (match_id, user_id, status, added_by) values (m.id, v_user, 'waitlist', me);
  return jsonb_build_object('status', 'waitlist', 'position', n_wait + 1, 'filled', false);
end $$;

-- My people: everyone in my groups, or in one group.
drop function if exists public.my_players();
create or replace function public.my_players(p_group uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'is_guest', p.is_guest)
                            order by p.id <> auth.uid(), lower(p.full_name)), '[]'::jsonb)
    from public.profiles p
   where case when p_group is null then p.id in (select public.circle_of(auth.uid()))
              else public.is_member(p_group, auth.uid())
                   and (p.id = auth.uid() or public.is_member(p_group, p.id)) end;
$$;

-- Games from a match are in its group; games logged from Home are in the chosen group,
-- and everyone in them must be in it.
drop function if exists public.log_game(uuid, uuid, uuid, uuid, uuid, text, integer, integer);
create or replace function public.log_game(p_match uuid, p_a1 uuid, p_a2 uuid, p_b1 uuid, p_b2 uuid, p_winner text,
  p_score_a integer default null, p_score_b integer default null, p_group uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  m public.matches;
  v_id uuid;
  v_group uuid;
  v_date date := current_date;
  ids uuid[] := array_remove(array[p_a1, p_a2, p_b1, p_b2], null);
begin
  if p_winner not in ('a', 'b') then raise exception 'Tap the side that won'; end if;
  -- Scores are optional; if given, both sides, and the winner scored more.
  if (p_score_a is null) <> (p_score_b is null) then raise exception 'Enter both scores, or neither'; end if;
  if p_score_a is not null and (p_score_a not between 0 and 99 or p_score_b not between 0 and 99) then
    raise exception 'Scores are 0 to 99';
  end if;
  if p_score_a is not null and (p_score_a = p_score_b or (p_score_a > p_score_b) <> (p_winner = 'a')) then
    raise exception 'The winning side needs the higher score';
  end if;
  if (p_a2 is null) <> (p_b2 is null) or p_a1 is null or p_b1 is null then
    raise exception 'Pick the same number of players on each side';
  end if;
  if p_match is not null then
    select * into m from public.matches where id = p_match;
    if not found then raise exception 'Match not found'; end if;
    if me <> m.organiser_id and not exists (
      select 1 from public.match_players where match_id = m.id and user_id = me and status = 'confirmed') then
      raise exception 'Only players in this match can log results';
    end if;
    if (select count(*) from public.match_players
         where match_id = m.id and status = 'confirmed' and user_id = any (ids)) <> array_length(ids, 1) then
      raise exception 'All players must be confirmed in this match';
    end if;
    v_date := (m.starts_at at time zone m.timezone)::date;
    v_group := m.group_id;
  else
    v_group := public.pick_group(me, p_group);
    if exists (select x from unnest(ids) x where not public.is_member(v_group, x)) then
      raise exception 'Everyone in the game must be in the group';
    end if;
  end if;

  insert into public.games (match_id, created_by, played_on, a1, a2, b1, b2, winner, score_a, score_b, group_id)
  values (p_match, me, v_date, p_a1, p_a2, p_b1, p_b2, p_winner, p_score_a, p_score_b, v_group)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- What you see
-- ---------------------------------------------------------------------------

-- One group's games (default: the group I played in last). Members only.
drop function if exists public.get_leaderboard();
create or replace function public.get_leaderboard(p_group uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  with grp as (
    select g.id, g.name from public.groups g
     where g.id = coalesce(p_group, public.default_group(auth.uid())) and public.is_member(g.id, auth.uid())
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

-- Home: matches in my groups, plus any match I'm in.
create or replace function public.my_matches() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.past, case when x.past then null else x.starts_at end, x.starts_at desc), '[]'::jsonb)
  from (
    select m.slug, m.title, m.venue, m.size, m.format, m.court_count, m.starts_at, m.duration_min, m.timezone, m.status,
           now() >= m.starts_at as started,
           m.repeat_weekly or m.series_id is not null as weekly,
           m.group_id, (select name from public.groups where id = m.group_id) as group_name,
           -- My place in it: organiser, confirmed, waitlist, or null when I'm not in it.
           case when m.organiser_id = auth.uid() then 'organiser'
                else (select status from public.match_players where match_id = m.id and user_id = auth.uid()) end as my_role,
           public.match_past(m) as past, public.match_locked(m) as locked,
           (select count(*) from public.match_players where match_id = m.id and status = 'confirmed') as confirmed_count,
           (select count(*) from public.match_players where match_id = m.id and status = 'waitlist') as waitlist_count,
           case when m.organiser_id = auth.uid()
                  or exists (select 1 from public.match_players where match_id = m.id and user_id = auth.uid() and status = 'confirmed')
                then m.courts end as courts,
           (select count(*) from public.games where match_id = m.id) as games_count,
           (select count(*) from public.match_courts where match_id = m.id) as booked_courts,
           (select string_agg(public.first_name(w), ' & ')
              from (select g.* from public.games g where g.match_id = m.id order by g.created_at desc limit 1) g,
                   unnest(case when g.winner = 'a' then array[g.a1, g.a2] else array[g.b1, g.b2] end) w
             where w is not null) as last_winners
      from public.matches m
     where auth.uid() is not null
       and (m.group_id in (select group_id from public.group_members where user_id = auth.uid())
            or m.organiser_id = auth.uid()
            or exists (select 1 from public.match_players where match_id = m.id and user_id = auth.uid()))
  ) x;
$$;

-- Balances: same matches as before (ones I'm part of), now labelled with their group.
create or replace function public.my_ledger() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'slug', m.slug, 'title', m.title, 'starts_at', m.starts_at,
    'timezone', m.timezone, 'currency', m.currency,
    'group_id', m.group_id, 'group_name', (select name from public.groups where id = m.group_id),
    'players', to_jsonb(public.split_ids(m.id)),
    'expenses', (select coalesce(jsonb_agg(jsonb_build_object('amount', amount, 'paid_by', paid_by)), '[]'::jsonb)
                   from public.expenses where match_id = m.id),
    'settlements', (select coalesce(jsonb_agg(jsonb_build_object('from', from_user, 'to', to_user, 'amount', amount)), '[]'::jsonb)
                      from public.settlements where match_id = m.id),
    'people', (select coalesce(jsonb_object_agg(p.id, p.full_name), '{}'::jsonb) from public.profiles p
                where p.id in (select paid_by from public.expenses where match_id = m.id
                               union select unnest(public.split_ids(m.id))))
  ) order by m.starts_at desc), '[]'::jsonb)
  from public.matches m
  where public.split_ready(m.id)
    and (m.organiser_id = auth.uid() or auth.uid() = any (public.split_ids(m.id))
         -- Paid for something (e.g. booked a court) and then dropped out: still owed.
         or exists (select 1 from public.expenses e where e.match_id = m.id and e.paid_by = auth.uid()));
$$;

-- New match: tell the group (each person can switch emails off).
create or replace function public.email_on_new_match() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select gm.user_id as u from public.group_members gm where gm.group_id = new.group_id and gm.user_id <> new.organiser_id
  loop
    perform public.queue_email(r.u, new.id, 'new_match',
      'New match: ' || new.title || ' · ' || public.when_label(new),
      public.first_name(new.organiser_id) || ' set up ' || new.title || ' for ' || public.when_label(new)
        || coalesce(' at ' || nullif(new.venue, ''), '') || '.' || chr(10)
        || new.size || ' spots, ' || case when new.format = 'singles' then 'singles' else 'doubles' end
        || ' on ' || new.court_count || ' court' || case when new.court_count > 1 then 's' else '' end || '.' || chr(10)
        || 'Tap to join.',
      '/m/' || new.slug);
  end loop;
  return null;
end $$;

create or replace function public.get_match(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m public.matches;
  me uuid := auth.uid();
  my_status text;
  wait_pos int;
  n_conf int;
  n_wait int;
  is_org boolean;
  can_see boolean;
  show_names boolean;
  role text;
begin
  select * into m from public.matches where slug = p_slug;
  if not found then return null; end if;

  is_org := me is not null and me = m.organiser_id;
  select status into my_status from public.match_players where match_id = m.id and user_id = me;
  select count(*) filter (where status = 'confirmed'), count(*) filter (where status = 'waitlist')
    into n_conf, n_wait from public.match_players where match_id = m.id;
  if my_status = 'waitlist' then
    select count(*) + 1 into wait_pos from public.match_players
     where match_id = m.id and status = 'waitlist'
       and seq < (select seq from public.match_players where match_id = m.id and user_id = me);
  end if;

  can_see := is_org or my_status = 'confirmed';
  -- Names are always public (anyone with the link); court numbers and costs are not.
  show_names := true;
  role := case
    when me is null then 'anon'
    when is_org then 'organiser'
    when my_status is not null then my_status
    else 'outsider'
  end;

  return jsonb_build_object(
    'id', m.id, 'slug', m.slug, 'title', m.title, 'size', m.size, 'venue', m.venue,
    'format', m.format, 'court_count', m.court_count, 'status', m.status,
    'starts_at', m.starts_at, 'duration_min', m.duration_min, 'rsvp_close_hours', m.rsvp_close_hours,
    'court_cost', m.court_cost, 'currency', m.currency, 'timezone', m.timezone,
    'lock_state', m.lock_state, 'locked', public.match_locked(m), 'past', public.match_past(m),
    'created_at', m.created_at,
    'courts', case when can_see then m.courts end,
    'parking', case when can_see then m.parking end,
    'organiser', (select jsonb_build_object('id', p.id, 'full_name', p.full_name)
                    from public.profiles p where p.id = m.organiser_id),
    'viewer', jsonb_build_object(
      'id', me, 'role', role, 'wait_pos', wait_pos,
      -- My place on the player list: confirmed, waitlist or null (an organiser may not be playing).
      'status', my_status,
      'full_name', (select full_name from public.profiles where id = me)),
    'confirmed_count', n_conf,
    'waitlist_count', n_wait,
    'players', coalesce((
      select jsonb_agg(case when show_names then jsonb_build_object(
               'id', p.id, 'full_name', p.full_name, 'promoted', mp.promoted, 'joined_at', mp.joined_at,
               'is_guest', p.is_guest)
             else jsonb_build_object('hidden', true) end || jsonb_build_object('court', mp.court) order by mp.court, mp.seq)
        from public.match_players mp join public.profiles p on p.id = mp.user_id
       where mp.match_id = m.id and mp.status = 'confirmed'), '[]'::jsonb),
    'waitlist', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'is_guest', p.is_guest) order by mp.seq)
        from public.match_players mp join public.profiles p on p.id = mp.user_id
       where mp.match_id = m.id and mp.status = 'waitlist'), '[]'::jsonb),
    'liable', case when can_see then coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name) order by l.created_at)
        from public.match_liable l join public.profiles p on p.id = l.user_id
       where l.match_id = m.id and l.user_id = any (public.share_holders(m.id))
         and not exists (select 1 from public.match_players mp
                          where mp.match_id = m.id and mp.user_id = l.user_id and mp.status = 'confirmed')), '[]'::jsonb) end,
    'split_ids', case when can_see then to_jsonb(public.split_ids(m.id)) end,
    'split_ready', public.split_ready(m.id),
    'repeat_weekly', m.repeat_weekly or exists (select 1 from public.matches x
                       where x.series_id = coalesce(m.series_id, m.id) and x.starts_at > m.starts_at),
    'repeats', m.repeat_weekly,
    'regulars_first', m.regulars_first,
    'regulars_until', m.regulars_until,
    'is_regular', me = any (m.regulars),
    'group', (select jsonb_build_object('id', g.id, 'name', g.name) from public.groups g where g.id = m.group_id),
    'is_member', me is not null and exists (select 1 from public.group_members where group_id = m.group_id and user_id = me),
    -- Games logged in this match, newest first, with names (names are public).
    'games', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'created_by', g.created_by, 'winner', g.winner, 'score_a', g.score_a, 'score_b', g.score_b,
        'a', (select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name) order by x.o)
                from unnest(array[g.a1, g.a2]) with ordinality x(id, o) join public.profiles p on p.id = x.id),
        'b', (select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name) order by x.o)
                from unnest(array[g.b1, g.b2]) with ordinality x(id, o) join public.profiles p on p.id = x.id))
        order by g.created_at desc)
      from public.games g where g.match_id = m.id), '[]'::jsonb),
    -- One entry per court: whether it's booked; number, cost and booker for confirmed players.
    'court_info', (select jsonb_agg(jsonb_build_object('court', c, 'booked', mc.court is not null)
                     || case when can_see and mc.court is not null then jsonb_build_object(
                          'label', mc.label, 'cost', mc.cost, 'booked_by', mc.booked_by,
                          'booked_by_name', (select full_name from public.profiles where id = mc.booked_by)) else '{}'::jsonb end
                     order by c)
                     from generate_series(1, m.court_count) c
                     left join public.match_courts mc on mc.match_id = m.id and mc.court = c),
    -- Guests (no login) and who pays their share.
    'billed_to', case when can_see then coalesce((
      select jsonb_object_agg(x.guest, x.payer) from (
        select mp.user_id as guest, public.payer_for(m, mp.user_id) as payer
          from public.match_players mp join public.profiles p on p.id = mp.user_id
         where mp.match_id = m.id and p.is_guest
      ) x), '{}'::jsonb) end,
    'added_by', coalesce((
      select jsonb_object_agg(mp.user_id, mp.added_by) from public.match_players mp
       where mp.match_id = m.id and mp.added_by is not null
         and (can_see or show_names)), '{}'::jsonb),
    'expenses', case when can_see then coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'label', e.label, 'amount', e.amount, 'paid_by', e.paid_by)
                       order by e.created_at)
        from public.expenses e where e.match_id = m.id), '[]'::jsonb) end,
    'settlements', case when can_see then coalesce((
      select jsonb_agg(jsonb_build_object('from', s.from_user, 'to', s.to_user, 'amount', s.amount))
        from public.settlements s where s.match_id = m.id), '[]'::jsonb) end,
    'people', case when can_see then coalesce((
      select jsonb_object_agg(p.id, p.full_name) from public.profiles p
       where p.id in (select paid_by from public.expenses where match_id = m.id
                      union select user_id from public.match_players where match_id = m.id
                      union select user_id from public.match_liable where match_id = m.id
                      union select booked_by from public.match_courts where match_id = m.id
                      union select public.payer_for(m, mp.user_id) from public.match_players mp
                       where mp.match_id = m.id)), '{}'::jsonb) end
  );
end $function$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.new_invite_code(), public.is_member(uuid, uuid), public.add_member(uuid, uuid),
  public.default_group(uuid), public.pick_group(uuid, uuid), public.circle_of(uuid), public.match_default_group(),
  public.game_default_group(), public.player_joins_group(), public.require_group_owner(uuid)
  from public, anon, authenticated;
revoke all on function public.create_group(text), public.rename_group(uuid, text), public.reset_invite(uuid),
  public.my_groups(), public.get_group(uuid), public.group_preview(text), public.join_group(text),
  public.leave_group(uuid), public.remove_member(uuid, uuid), public.make_owner(uuid, uuid),
  public.create_match(text, text, integer, text, date, time without time zone, text, integer, integer, text, uuid),
  public.create_guest(text, uuid), public.add_player(uuid, uuid, text), public.my_players(uuid),
  public.log_game(uuid, uuid, uuid, uuid, uuid, text, integer, integer, uuid), public.get_leaderboard(uuid),
  public.my_matches(), public.my_ledger(), public.get_match(text)
  from public, anon;
grant execute on function public.create_group(text), public.rename_group(uuid, text), public.reset_invite(uuid),
  public.my_groups(), public.get_group(uuid), public.group_preview(text), public.join_group(text),
  public.leave_group(uuid), public.remove_member(uuid, uuid), public.make_owner(uuid, uuid),
  public.create_match(text, text, integer, text, date, time without time zone, text, integer, integer, text, uuid),
  public.create_guest(text, uuid), public.add_player(uuid, uuid, text), public.my_players(uuid),
  public.log_game(uuid, uuid, uuid, uuid, uuid, text, integer, integer, uuid), public.get_leaderboard(uuid),
  public.my_matches(), public.my_ledger(), public.get_match(text)
  to authenticated;
grant execute on function public.get_match(text), public.group_preview(text) to anon;
revoke all on function public.email_on_new_match() from public, anon, authenticated;
