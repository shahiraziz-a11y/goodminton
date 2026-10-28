-- Home streak card: also say which of the last 8 weeks (oldest first, this week last) had a game.
-- Run once, after 0019. Safe to run again.

do $$ begin
  if to_regprocedure('public.save_round(uuid, integer, jsonb)') is null then
    raise exception 'Run 0019_game_plan.sql first, then this file.';
  end if;
end $$;

create or replace function public.player_stats(p_user uuid, p_now timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  this_week date := date_trunc('week', (p_now at time zone 'Asia/Dubai')::date)::date;
  wk date;
  weeks date[];
  streak int := 0;
  n_matches int;
  n_games int;
begin
  select count(*) into n_matches
    from public.match_players mp join public.matches m on m.id = mp.match_id
   where mp.user_id = p_user and mp.status = 'confirmed' and m.starts_at <= p_now;
  select count(*) into n_games
    from public.games g where p_user in (g.a1, g.a2, g.b1, g.b2) and g.created_at <= p_now;

  select coalesce(array_agg(distinct w), '{}') into weeks from (
    select date_trunc('week', (m.starts_at at time zone 'Asia/Dubai')::date)::date as w
      from public.match_players mp join public.matches m on m.id = mp.match_id
     where mp.user_id = p_user and mp.status = 'confirmed' and m.starts_at <= p_now
    union
    select date_trunc('week', g.played_on)::date
      from public.games g where p_user in (g.a1, g.a2, g.b1, g.b2) and g.created_at <= p_now
  ) x;

  -- Count back from this week, or from last week if this week has no game yet.
  wk := case when this_week = any (weeks) then this_week else this_week - 7 end;
  while wk = any (weeks) loop
    streak := streak + 1;
    wk := wk - 7;
  end loop;

  return jsonb_build_object(
    'week_streak', streak,
    'played_this_week', this_week = any (weeks),
    'matches_played', n_matches,
    'games_played', n_games,
    'last_weeks', (select jsonb_agg((this_week - 7 * k) = any (weeks) order by k desc) from generate_series(0, 7) k));
end $$;

revoke all on function public.player_stats(uuid, timestamptz) from public, anon, authenticated;
