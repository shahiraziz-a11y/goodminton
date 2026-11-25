-- Tag results to a match: log from anywhere into a match, move a game to another match, untag it.
-- A tag is a label: anyone in the match's group may be in a tagged game; it doesn't touch the cost split.
-- Run once, after 0028. Safe to run again.

do $$ begin
  if to_regclass('public.group_requests') is null then
    raise exception 'Run 0028_public_groups.sql first, then this file.';
  end if;
end $$;

-- In the match, or in its group.
create or replace function public.can_play_in(p_match uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.match_players where match_id = p_match and user_id = p_user and status = 'confirmed')
      or exists (select 1 from public.matches m where m.id = p_match and m.group_id is not null and public.is_member(m.group_id, p_user))
$$;

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
  if (select count(distinct x) from unnest(ids) x) <> array_length(ids, 1) then
    raise exception 'Someone is on the court twice';
  end if;
  if p_match is not null then
    select * into m from public.matches where id = p_match;
    if not found then raise exception 'Match not found'; end if;
    if me <> m.organiser_id and not public.can_play_in(m.id, me) then
      raise exception 'Only players in this match can log results';
    end if;
    if exists (select x from unnest(ids) x where not public.can_play_in(m.id, x)) then
      raise exception 'Everyone in the game must be in this match or its group';
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

create or replace function public.edit_game(p_game uuid, p_a1 uuid, p_a2 uuid, p_b1 uuid, p_b2 uuid, p_winner text,
  p_score_a int default null, p_score_b int default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  g public.games;
  ids uuid[] := array_remove(array[p_a1, p_a2, p_b1, p_b2], null);
begin
  select * into g from public.games where id = p_game for update;
  if not found then raise exception 'Game not found'; end if;
  if me <> g.created_by and me is distinct from (select organiser_id from public.matches where id = g.match_id) then
    raise exception 'Only the person who logged it can change it';
  end if;
  if p_winner not in ('a', 'b') then raise exception 'Tap the side that won'; end if;
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
  if (select count(distinct x) from unnest(ids) x) <> array_length(ids, 1) then
    raise exception 'Someone is on the court twice';
  end if;
  if g.match_id is not null then
    if exists (select x from unnest(ids) x where not public.can_play_in(g.match_id, x)) then
      raise exception 'Everyone in the game must be in this match or its group';
    end if;
  elsif exists (select x from unnest(ids) x where not public.is_member(g.group_id, x)) then
    raise exception 'Everyone in the game must be in the group';
  end if;
  update public.games set a1 = p_a1, a2 = p_a2, b1 = p_b1, b2 = p_b2, winner = p_winner,
                          score_a = p_score_a, score_b = p_score_b
   where id = g.id;
end $$;

-- Move a game to another match in the same group, or untag it (p_match null; it keeps its date).
create or replace function public.tag_game(p_game uuid, p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  g public.games;
  m public.matches;
begin
  select * into g from public.games where id = p_game for update;
  if not found then raise exception 'Game not found'; end if;
  if me <> g.created_by and me is distinct from (select organiser_id from public.matches where id = g.match_id) then
    raise exception 'Only the person who logged it can change it';
  end if;
  if p_match is null then
    update public.games set match_id = null where id = g.id;
    return;
  end if;
  select * into m from public.matches where id = p_match;
  if not found then raise exception 'Match not found'; end if;
  if m.group_id is distinct from g.group_id then raise exception 'Pick a match from the same group'; end if;
  if m.starts_at > now() + interval '12 hours' then raise exception 'That match hasn''t started yet'; end if;
  if exists (select x from unnest(array_remove(array[g.a1, g.a2, g.b1, g.b2], null)) x where not public.can_play_in(m.id, x)) then
    raise exception 'Everyone in the game must be in this match or its group';
  end if;
  update public.games set match_id = m.id, played_on = (m.starts_at at time zone m.timezone)::date where id = g.id;
end $$;

-- Matches to tag a result to: the group's recent ones, newest first. `suggested` marks the default:
-- the live match, else the newest from the last 3 days.
create or replace function public.recent_matches(p_group uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with r as (
    select m.id, m.title, m.starts_at, m.timezone,
           now() between m.starts_at - interval '15 minutes' and m.starts_at + make_interval(mins => m.duration_min) + interval '3 hours' as live
      from public.matches m
     where m.group_id = p_group and public.is_member(p_group, auth.uid())
       and m.starts_at <= now() + interval '12 hours'
     order by m.starts_at desc
     limit 15
  ),
  pick as (
    select id from r
     where live or starts_at >= now() - interval '3 days'
     order by live desc, starts_at desc
     limit 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'title', title, 'starts_at', starts_at, 'timezone', timezone, 'live', live,
    'suggested', id = (select id from pick)) order by starts_at desc), '[]'::jsonb)
  from r
$$;

-- Rankings: same as 0028, plus each game's match_id (to change its tag).
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
        'id', id, 'played_on', played_on, 'match_id', match_id, 'match_title', match_title, 'created_by', created_by,
        'a', case when a2 is null then jsonb_build_array(a1) else jsonb_build_array(a1, a2) end,
        'b', case when b2 is null then jsonb_build_array(b1) else jsonb_build_array(b1, b2) end,
        'winner', winner, 'score_a', score_a, 'score_b', score_b)
        order by played_on desc, created_at desc) from g), '[]'::jsonb),
    'people', coalesce((select jsonb_object_agg(p.id, p.full_name) from public.profiles p
        where p.id in (select x from g, unnest(array[a1, a2, b1, b2]) x where x is not null)), '{}'::jsonb)
  );
$$;

revoke all on function public.can_play_in(uuid, uuid) from public, anon, authenticated;
revoke all on function public.tag_game(uuid, uuid) from public, anon;
grant execute on function public.tag_game(uuid, uuid) to authenticated;
revoke all on function public.recent_matches(uuid) from public, anon;
grant execute on function public.recent_matches(uuid) to authenticated;
