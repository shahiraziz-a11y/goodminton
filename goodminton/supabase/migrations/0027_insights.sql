-- Insights: everything the personal stats page needs, across all my groups.
-- Run once, after 0026. Safe to run again.

do $$ begin
  if to_regprocedure('public.get_board(text)') is null then
    raise exception 'Run 0026_peg_board.sql first, then this file.';
  end if;
end $$;

-- Games in all my groups (so ratings are fair) and any I played in, newest first;
-- my last 12 weeks (Dubai, Monday start) of matches and games; and my totals.
create or replace function public.my_insights(p_now timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  this_week date := date_trunc('week', (p_now at time zone 'Asia/Dubai')::date)::date;
begin
  return public.player_stats(me, p_now) || jsonb_build_object(
    'games', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'played_on', g.played_on, 'created_at', g.created_at, 'match_id', g.match_id,
               'match_title', m.title, 'created_by', g.created_by,
               'a', case when g.a2 is null then jsonb_build_array(g.a1) else jsonb_build_array(g.a1, g.a2) end,
               'b', case when g.b2 is null then jsonb_build_array(g.b1) else jsonb_build_array(g.b1, g.b2) end,
               'winner', g.winner, 'score_a', g.score_a, 'score_b', g.score_b)
             order by g.played_on desc, g.created_at desc)
        from (select * from public.games g
               where g.created_at <= p_now
                 and (g.group_id in (select group_id from public.group_members where user_id = me)
                      or me in (g.a1, g.a2, g.b1, g.b2))
               order by g.played_on desc, g.created_at desc limit 3000) g
        left join public.matches m on m.id = g.match_id), '[]'::jsonb),
    'people', coalesce((
      select jsonb_object_agg(p.id, p.full_name) from public.profiles p
       where p.id in (select x from public.games g, unnest(array[g.a1, g.a2, g.b1, g.b2]) x
                       where x is not null and g.created_at <= p_now
                         and (g.group_id in (select group_id from public.group_members where user_id = me)
                              or me in (g.a1, g.a2, g.b1, g.b2)))), '{}'::jsonb),
    'weeks', (
      select jsonb_agg(jsonb_build_object(
               'week', w,
               'matches', (select count(*) from public.match_players mp join public.matches m on m.id = mp.match_id
                            where mp.user_id = me and mp.status = 'confirmed' and m.starts_at <= p_now
                              and date_trunc('week', (m.starts_at at time zone 'Asia/Dubai')::date)::date = w),
               'games', (select count(*) from public.games g
                          where me in (g.a1, g.a2, g.b1, g.b2) and g.created_at <= p_now
                            and date_trunc('week', g.played_on)::date = w))
             order by w)
        from (select this_week - 7 * k as w from generate_series(0, 11) k) x),
    'first_played', (select min(g.played_on) from public.games g where me in (g.a1, g.a2, g.b1, g.b2)));
end $$;

revoke all on function public.my_insights(timestamptz) from public, anon;
grant execute on function public.my_insights(timestamptz) to authenticated;
