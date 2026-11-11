-- Peg board: match-day courts run on their own. Start a game on a free court, tap
-- Game over to log who won, and the next players go on. Any confirmed player can run it.
-- Run once, after 0025. Safe to run again.

do $$ begin
  if to_regprocedure('public.queue_calendar(uuid, public.matches, boolean, boolean)') is null then
    raise exception 'Run 0025_calendar_invites.sql first, then this file.';
  end if;
end $$;

create table if not exists public.board_games (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  court int not null check (court >= 1),
  a1 uuid not null references public.profiles (id) on delete cascade,
  a2 uuid references public.profiles (id) on delete cascade,
  b1 uuid not null references public.profiles (id) on delete cascade,
  b2 uuid references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  game_id uuid references public.games (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null
);
-- One game at a time per court.
create unique index if not exists board_games_live_court on public.board_games (match_id, court) where ended_at is null;
create index if not exists board_games_match_idx on public.board_games (match_id, started_at);
alter table public.board_games enable row level security;
revoke all on table public.board_games from anon, authenticated;

-- The organiser and confirmed players run the board, from 12 hours before the start
-- until 3 hours after the planned end.
create or replace function public.board_check(m public.matches) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  if me <> m.organiser_id and not exists (
       select 1 from public.match_players where match_id = m.id and user_id = me and status = 'confirmed') then
    raise exception 'Only players in this match can run the board';
  end if;
  if now() < m.starts_at - interval '12 hours' then raise exception 'The board opens on match day'; end if;
  if now() > m.starts_at + make_interval(mins => m.duration_min) + interval '3 hours' then
    raise exception 'This match is over';
  end if;
  return me;
end $$;

create or replace function public.board_start(p_match uuid, p_court int, p_a1 uuid, p_a2 uuid, p_b1 uuid, p_b2 uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  m public.matches := public.lock_match(p_match);
  me uuid := public.board_check(m);
  ids uuid[] := array_remove(array[p_a1, p_a2, p_b1, p_b2], null);
  v uuid;
begin
  if p_court is null or p_court < 1 or p_court > m.court_count then raise exception 'Pick a court'; end if;
  if (p_a2 is null) <> (p_b2 is null) or p_a1 is null or p_b1 is null then
    raise exception 'Pick the same number of players on each side';
  end if;
  if (select count(distinct x) from unnest(ids) x) <> array_length(ids, 1) then raise exception 'Someone is on the court twice'; end if;
  if (select count(*) from public.match_players
       where match_id = m.id and status = 'confirmed' and user_id = any (ids)) <> array_length(ids, 1) then
    raise exception 'Everyone on court must be confirmed in this match';
  end if;
  if exists (select 1 from public.board_games where match_id = m.id and court = p_court and ended_at is null) then
    raise exception 'Court % is already playing', p_court;
  end if;
  if exists (select 1 from public.board_games g where g.match_id = m.id and g.ended_at is null
              and array[g.a1, g.a2, g.b1, g.b2] && ids) then
    raise exception 'Someone is already on another court';
  end if;
  insert into public.board_games (match_id, court, a1, a2, b1, b2, created_by)
  values (m.id, p_court, p_a1, p_a2, p_b1, p_b2, me) returning id into v;
  return v;
end $$;

-- Game over: log who won (or no result) and free the court.
create or replace function public.board_finish(p_game uuid, p_winner text, p_score_a int default null, p_score_b int default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  g public.board_games;
  m public.matches;
  v_game uuid;
begin
  select * into g from public.board_games where id = p_game for update;
  if not found then raise exception 'Game not found'; end if;
  m := public.lock_match(g.match_id);
  perform public.board_check(m);
  if g.ended_at is not null then raise exception 'That game is already over'; end if;
  if p_winner is not null then
    v_game := public.log_game(m.id, g.a1, g.a2, g.b1, g.b2, p_winner, p_score_a, p_score_b, null);
  end if;
  update public.board_games set ended_at = now(), game_id = v_game where id = g.id;
end $$;

-- Undo: a live game comes off; a finished one goes back on court and its result is removed.
create or replace function public.board_undo(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  g public.board_games;
  m public.matches;
begin
  select * into g from public.board_games where id = p_game for update;
  if not found then raise exception 'Game not found'; end if;
  m := public.lock_match(g.match_id);
  perform public.board_check(m);
  if g.ended_at is null then
    delete from public.board_games where id = g.id;
    return;
  end if;
  if exists (select 1 from public.board_games where match_id = g.match_id and court = g.court and ended_at is null) then
    raise exception 'Court % is playing again; finish that game first', g.court;
  end if;
  if g.game_id is not null then delete from public.games where id = g.game_id; end if;
  update public.board_games set ended_at = null, game_id = null where id = g.id;
end $$;

-- The board for players in the match: courts, who's confirmed, live and finished games.
create or replace function public.get_board(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  m public.matches;
  me uuid := auth.uid();
begin
  select * into m from public.matches where slug = p_slug;
  if not found then return null; end if;
  if me is null or (me <> m.organiser_id and not exists (
       select 1 from public.match_players where match_id = m.id and user_id = me and status = 'confirmed')) then
    return null;
  end if;
  return jsonb_build_object(
    'id', m.id, 'slug', m.slug, 'title', m.title, 'starts_at', m.starts_at, 'duration_min', m.duration_min,
    'timezone', m.timezone, 'format', m.format, 'court_count', m.court_count, 'courts', m.courts,
    'group_id', m.group_id,
    'open', now() between m.starts_at - interval '12 hours' and m.starts_at + make_interval(mins => m.duration_min) + interval '3 hours',
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'joined_at', mp.joined_at) order by mp.seq)
                          from public.match_players mp join public.profiles p on p.id = mp.user_id
                         where mp.match_id = m.id and mp.status = 'confirmed'), '[]'::jsonb),
    'games', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', g.id, 'court', g.court,
                 'a', case when g.a2 is null then jsonb_build_array(g.a1) else jsonb_build_array(g.a1, g.a2) end,
                 'b', case when g.b2 is null then jsonb_build_array(g.b1) else jsonb_build_array(g.b1, g.b2) end,
                 'started_at', g.started_at, 'ended_at', g.ended_at,
                 'winner', x.winner, 'score_a', x.score_a, 'score_b', x.score_b) order by g.started_at)
                from public.board_games g left join public.games x on x.id = g.game_id
               where g.match_id = m.id), '[]'::jsonb),
    'people', coalesce((select jsonb_object_agg(p.id, p.full_name) from public.profiles p
                         where p.id in (select unnest(array[g.a1, g.a2, g.b1, g.b2]) from public.board_games g where g.match_id = m.id)), '{}'::jsonb)
  );
end $$;

revoke all on function public.board_check(public.matches) from public, anon, authenticated;
revoke all on function public.board_start(uuid, int, uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.board_finish(uuid, text, int, int) from public, anon;
revoke all on function public.board_undo(uuid) from public, anon;
revoke all on function public.get_board(text) from public, anon;
grant execute on function public.board_start(uuid, int, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.board_finish(uuid, text, int, int) to authenticated;
grant execute on function public.board_undo(uuid) to authenticated;
grant execute on function public.get_board(text) to authenticated;
