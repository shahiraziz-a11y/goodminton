-- Home screen stats: weekly streak (weeks in a row with at least one game) and lifetime totals.
-- "Played" means confirmed in a match that has started, or in a logged game. Weeks start on
-- Monday, in Dubai time. This week counts once you've played; until then the streak runs to last week.
-- Run once, after 0014. Safe to run again.

do $$ begin
  if to_regprocedure('public.join_match(uuid, integer)') is null then
    raise exception 'Run 0014_tap_spot_to_join.sql first, then this file.';
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
    'games_played', n_games);
end $$;

create or replace function public.my_stats() returns jsonb
language sql stable security definer set search_path = public as $$
  select public.player_stats(public.require_user(), now());
$$;

revoke all on function public.player_stats(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.my_stats() from public, anon;
grant execute on function public.my_stats() to authenticated;
