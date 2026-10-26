-- Game plan: rounds of games across a match's courts, made one round at a time in the app,
-- editable (swap / bring in / take out) until a result is in, and results tapped right on it.
-- Any confirmed player or the organiser can use it. Results become normal games (leaderboard).
-- Run once, after 0018. Safe to run again.

do $$ begin
  if to_regprocedure('public.allow_extra(uuid, uuid, integer)') is null then
    raise exception 'Run 0018_extras_split_on_lock.sql first, then this file.';
  end if;
end $$;

create table if not exists public.planned_games (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  round int not null check (round >= 1),
  court int not null check (court >= 1),
  a1 uuid not null references public.profiles (id),
  a2 uuid references public.profiles (id),
  b1 uuid not null references public.profiles (id),
  b2 uuid references public.profiles (id),
  game_id uuid references public.games (id) on delete set null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (match_id, round, court)
);
alter table public.planned_games enable row level security;
revoke all on table public.planned_games from anon, authenticated;

-- Organiser or a confirmed player.
create or replace function public.require_plan_access(m public.matches) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  if me <> m.organiser_id and not exists (
    select 1 from public.match_players where match_id = m.id and user_id = me and status = 'confirmed') then
    raise exception 'Only players in this match can use the game plan';
  end if;
  return me;
end $$;

-- One game's players: right number per side for the format, all confirmed, nobody twice.
create or replace function public.check_plan_game(m public.matches, p_a1 uuid, p_a2 uuid, p_b1 uuid, p_b2 uuid) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare ids uuid[] := array_remove(array[p_a1, p_a2, p_b1, p_b2], null);
begin
  if p_a1 is null or p_b1 is null or (p_a2 is null) <> (p_b2 is null)
     or (m.format = 'doubles') <> (p_a2 is not null) then
    raise exception 'Each side needs % player%', case when m.format = 'doubles' then 2 else 1 end, case when m.format = 'doubles' then 's' else '' end;
  end if;
  if (select count(distinct x) from unnest(ids) x) <> cardinality(ids) then raise exception 'Someone is in the game twice'; end if;
  if (select count(*) from public.match_players where match_id = m.id and status = 'confirmed' and user_id = any (ids)) <> cardinality(ids) then
    raise exception 'Everyone in the plan must be confirmed in this match';
  end if;
  return ids;
end $$;

-- Add the next round. p_games: [{"court": 1, "a": [id, id], "b": [id, id]}, ...]
create or replace function public.save_round(p_match uuid, p_round int, p_games jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  m public.matches := public.lock_match(p_match);
  me uuid := public.require_plan_access(m);
  latest int;
  g jsonb;
  c int;
  seen uuid[] := '{}';
  ids uuid[];
begin
  select coalesce(max(round), 0) into latest from public.planned_games where match_id = m.id;
  if p_round <> latest + 1 then raise exception 'Someone just made round %. Showing the latest plan.', latest; end if;
  if jsonb_typeof(p_games) <> 'array' or jsonb_array_length(p_games) = 0 then raise exception 'A round needs at least one game'; end if;
  for g in select * from jsonb_array_elements(p_games) loop
    c := (g ->> 'court')::int;
    if c is null or c not between 1 and m.court_count then raise exception 'Court % isn''t part of this match', c; end if;
    ids := public.check_plan_game(m, (g -> 'a' ->> 0)::uuid, (g -> 'a' ->> 1)::uuid, (g -> 'b' ->> 0)::uuid, (g -> 'b' ->> 1)::uuid);
    if seen && ids then raise exception 'Someone is in two games in the same round'; end if;
    seen := seen || ids;
    insert into public.planned_games (match_id, round, court, a1, a2, b1, b2, created_by)
    values (m.id, p_round, c, (g -> 'a' ->> 0)::uuid, (g -> 'a' ->> 1)::uuid, (g -> 'b' ->> 0)::uuid, (g -> 'b' ->> 1)::uuid, me);
  end loop;
  return p_round;
end $$;

-- Change who plays: p_in takes p_out's place in a game without a result.
-- If p_in is in another game of the same round (or the same game), they swap places;
-- if p_in is sitting out, they come in and p_out sits out.
create or replace function public.swap_planned(p_game uuid, p_out uuid, p_in uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  pg public.planned_games;
  other public.planned_games;
  m public.matches;
begin
  select * into pg from public.planned_games where id = p_game;
  if not found then raise exception 'Game not found'; end if;
  m := public.lock_match(pg.match_id);
  perform public.require_plan_access(m);
  select * into pg from public.planned_games where id = p_game;
  if pg.game_id is not null then raise exception 'This game has a result. Undo it first to change players.'; end if;
  if p_out not in (pg.a1, coalesce(pg.a2, pg.a1), pg.b1, coalesce(pg.b2, pg.b1)) then raise exception 'They''re not in this game'; end if;
  if p_in = p_out then return; end if;
  select * into other from public.planned_games
   where match_id = pg.match_id and round = pg.round and p_in in (a1, coalesce(a2, a1), b1, coalesce(b2, b1));
  if other.id is not null and other.game_id is not null then raise exception 'They''re in a game that has a result'; end if;
  -- Swap the two people wherever they appear in this round (one or two games).
  update public.planned_games set
    a1 = case a1 when p_out then p_in when p_in then p_out else a1 end,
    a2 = case a2 when p_out then p_in when p_in then p_out else a2 end,
    b1 = case b1 when p_out then p_in when p_in then p_out else b1 end,
    b2 = case b2 when p_out then p_in when p_in then p_out else b2 end
   where id in (pg.id, other.id);
  select * into pg from public.planned_games where id = p_game;
  perform public.check_plan_game(m, pg.a1, pg.a2, pg.b1, pg.b2);
end $$;

-- Undo the latest round, if no result has been tapped in it.
create or replace function public.delete_round(p_match uuid, p_round int) returns void
language plpgsql security definer set search_path = public as $$
declare m public.matches := public.lock_match(p_match);
begin
  perform public.require_plan_access(m);
  if p_round <> (select max(round) from public.planned_games where match_id = m.id) then
    raise exception 'Only the latest round can be removed';
  end if;
  if exists (select 1 from public.planned_games where match_id = m.id and round = p_round and game_id is not null) then
    raise exception 'This round has results. Undo them first.';
  end if;
  delete from public.planned_games where match_id = m.id and round = p_round;
end $$;

-- Tap the winners: logs a normal game (leaderboard, results) and links it to the plan.
create or replace function public.log_planned(p_game uuid, p_winner text, p_score_a int default null, p_score_b int default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare pg public.planned_games; m public.matches; v uuid;
begin
  select * into pg from public.planned_games where id = p_game;
  if not found then raise exception 'Game not found'; end if;
  m := public.lock_match(pg.match_id);
  perform public.require_plan_access(m);
  select * into pg from public.planned_games where id = p_game;
  if pg.game_id is not null then raise exception 'This game already has a result'; end if;
  v := public.log_game(m.id, pg.a1, pg.a2, pg.b1, pg.b2, p_winner, p_score_a, p_score_b);
  update public.planned_games set game_id = v where id = p_game;
  return v;
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
             else jsonb_build_object('hidden', true) end || jsonb_build_object('court', mp.court, 'extra', mp.extra) order by mp.court, mp.seq)
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
    -- The game plan: rounds of games across the courts, with results once logged. Players only.
    'plan', case when can_see then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pg.id, 'round', pg.round, 'court', pg.court, 'game_id', pg.game_id,
               'a', (select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name) order by x.o)
                       from unnest(array[pg.a1, pg.a2]) with ordinality x(id, o) join public.profiles p on p.id = x.id),
               'b', (select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name) order by x.o)
                       from unnest(array[pg.b1, pg.b2]) with ordinality x(id, o) join public.profiles p on p.id = x.id),
               'winner', gm.winner, 'score_a', gm.score_a, 'score_b', gm.score_b)
             order by pg.round, pg.court)
        from public.planned_games pg left join public.games gm on gm.id = pg.game_id
       where pg.match_id = m.id), '[]'::jsonb) end,
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

revoke all on function public.require_plan_access(public.matches), public.check_plan_game(public.matches, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.save_round(uuid, integer, jsonb), public.swap_planned(uuid, uuid, uuid),
  public.delete_round(uuid, integer), public.log_planned(uuid, text, integer, integer) from public, anon;
grant execute on function public.save_round(uuid, integer, jsonb), public.swap_planned(uuid, uuid, uuid),
  public.delete_round(uuid, integer), public.log_planned(uuid, text, integer, integer) to authenticated;
revoke all on function public.get_match(text) from public;
grant execute on function public.get_match(text) to anon, authenticated;
