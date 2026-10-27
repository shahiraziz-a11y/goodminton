-- Home stats: weeks in a row with a game, and lifetime totals.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email = u || '@stats.test'), ''), false);
end $$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
end $$;
create function pg_temp.uid(u text) returns uuid language sql security definer as $$ select id from public.profiles where email = u || '@stats.test' $$;
-- A match that ann and ben played, moved to a past start time.
create function pg_temp.played(t text, at timestamptz) returns void language plpgsql as $$
declare s text; mid uuid;
begin
  perform pg_temp.as_user('org');
  s := public.create_match(t, 'doubles', 1, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6);
  select id into mid from public.matches where slug = s;
  perform pg_temp.as_user('ann'); perform public.join_match(mid);
  perform pg_temp.as_user('ben'); perform public.join_match(mid);
  update public.matches set starts_at = at where id = mid;
end $$;
create function pg_temp.game(on_day date) returns void language sql as $$
  insert into public.games (created_by, played_on, a1, a2, b1, b2, winner, created_at)
  values (pg_temp.uid('ann'), on_day, pg_temp.uid('ann'), pg_temp.uid('cat'), pg_temp.uid('dan'), pg_temp.uid('eve'), 'a', on_day);
$$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@stats.test', jsonb_build_object('full_name', initcap(n))
from unnest(array['org','ann','ben','cat','dan','eve','new']) n;

-- "Now" is Thursday 22 Oct 2026 in Dubai; this week started Monday 19 Oct.
\set now '2026-10-22 12:00+04'
select pg_temp.played('Last week', '2026-10-13 20:00+04');
select pg_temp.played('Two weeks ago', '2026-10-06 20:00+04');
select pg_temp.game('2026-09-29');  -- ann only
select pg_temp.game('2026-09-15');  -- after a gap: doesn't count
-- Sunday night in Dubai: already Monday 19 Oct there, so ben has played this week.
select pg_temp.played('Late Sunday', '2026-10-18 21:30+00');

select public.player_stats(pg_temp.uid('ann'), :'now') as s \gset
select pg_temp.check((:'s'::jsonb ->> 'week_streak')::int = 4 and (:'s'::jsonb ->> 'played_this_week')::boolean, 'ann: 4 weeks in a row, including this one');
select pg_temp.check((:'s'::jsonb ->> 'matches_played')::int = 3 and (:'s'::jsonb ->> 'games_played')::int = 2, 'ann lifetime totals');
-- Last 8 weeks (Mondays 31 Aug to 19 Oct), oldest first: played the weeks of 14 Sep, 28 Sep, 5 Oct, 12 Oct and 19 Oct.
select pg_temp.check((:'s'::jsonb -> 'last_weeks') = '[false, false, true, false, true, true, true, true]'::jsonb, 'last 8 weeks');

-- Before Sunday's match, ann's streak runs to last week.
select public.player_stats(pg_temp.uid('ann'), '2026-10-18 20:00+00') as s \gset
select pg_temp.check((:'s'::jsonb ->> 'week_streak')::int = 3 and not (:'s'::jsonb ->> 'played_this_week')::boolean, 'not played yet this week: streak to last week');
select pg_temp.check((:'s'::jsonb ->> 'matches_played')::int = 2, 'future matches do not count');

-- A full week off ends the streak.
select public.player_stats(pg_temp.uid('ann'), '2026-11-03 12:00+04') as s \gset
select pg_temp.check((:'s'::jsonb ->> 'week_streak')::int = 0, 'a missed week resets');

-- The organiser plays in their own matches unless they drop out.
select public.player_stats(pg_temp.uid('org'), :'now') as s \gset
select pg_temp.check((:'s'::jsonb ->> 'week_streak')::int = 3 and (:'s'::jsonb ->> 'matches_played')::int = 3, 'organiser who plays');
update public.match_players set status = 'waitlist' where user_id = pg_temp.uid('org');
select public.player_stats(pg_temp.uid('org'), :'now') as s \gset
select pg_temp.check((:'s'::jsonb ->> 'matches_played')::int = 0, 'not confirmed, not counted');
-- A brand-new player: nothing.
select pg_temp.as_user('new');
set role authenticated;
select public.my_stats() as s \gset
select pg_temp.check((:'s'::jsonb ->> 'week_streak')::int = 0 and (:'s'::jsonb ->> 'games_played')::int = 0, 'new player via my_stats');
select pg_temp.check(not has_function_privilege('authenticated', 'public.player_stats(uuid, timestamptz)', 'execute'), 'others'' stats closed');
reset role;
select pg_temp.check(not has_function_privilege('anon', 'public.my_stats()', 'execute'), 'anon has no stats');

\o
\echo HOME STATS CHECKS PASSED
