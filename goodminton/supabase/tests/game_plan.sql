-- Game plan: rounds made one at a time, swaps, results tapped on the plan.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email = u || '@plan.test'), ''), false);
end $$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
end $$;
create function pg_temp.fails(sql text) returns text language plpgsql as $$
begin
  execute sql;
  raise exception 'FAILED: expected error from %', sql;
exception when others then
  if sqlerrm like 'FAILED:%' then raise; end if;
  return sqlerrm;
end $$;
create function pg_temp.uid(u text) returns uuid language sql security definer as $$ select id from public.profiles where email = u || '@plan.test' $$;
-- "r1 c1: org,a v b,c | c2: ..." for one round.
create function pg_temp.round(p_match uuid, r int) returns text language sql security definer as $$
  select string_agg('c' || court || ':' || x.sa || ' v ' || x.sb || case when game_id is not null then ' ✓' else '' end, ' | ' order by court)
    from (select pg.*,
                 (select string_agg(split_part(p.email, '@', 1), ',' order by o) from unnest(array[a1, a2]) with ordinality u(id, o) join public.profiles p on p.id = u.id) sa,
                 (select string_agg(split_part(p.email, '@', 1), ',' order by o) from unnest(array[b1, b2]) with ordinality u(id, o) join public.profiles p on p.id = u.id) sb
            from public.planned_games pg where match_id = p_match and round = r) x;
$$;
create function pg_temp.gid(p_match uuid, r int, c int) returns uuid language sql security definer as $$
  select id from public.planned_games where match_id = p_match and round = r and court = c
$$;
create function pg_temp.g(a text[], b text[], c int) returns jsonb language sql as $$
  select jsonb_build_object('court', c, 'a', (select jsonb_agg(pg_temp.uid(x)) from unnest(a) x), 'b', (select jsonb_agg(pg_temp.uid(x)) from unnest(b) x));
$$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@plan.test', jsonb_build_object('full_name', initcap(n))
from unnest(array['org','a','b','c','d','e','f','g','h','w','x']) n;

-- Two courts: 8 fill them, h and w are let in as extras (10 playing), x waits.
set role authenticated;
select pg_temp.as_user('org');
select public.create_match('Plan night', 'doubles', 2, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 120, 6) as slug \gset
reset role;
select id as mid from public.matches where slug = :'slug' \gset
set role authenticated;
select pg_temp.as_user(u), public.join_match(:'mid') from unnest(array['a','b','c','d','e','f','g','h','w']) u;
select pg_temp.as_user('org'); select public.allow_extra(:'mid', pg_temp.uid('h'), 1); select public.allow_extra(:'mid', pg_temp.uid('w'), 2);
select pg_temp.as_user('x'); select public.join_match(:'mid');  -- waitlist

-- Who can use it.
select pg_temp.check(pg_temp.fails(format('select public.save_round(%L, 1, %L)', :'mid',
  jsonb_build_array(pg_temp.g(array['org','a'], array['b','c'], 1)))) like '%Only players%', 'waitlist cannot plan');

-- Round 1 by a player.
select pg_temp.as_user('a');
select public.save_round(:'mid', 1, jsonb_build_array(pg_temp.g(array['org','a'], array['b','c'], 1), pg_temp.g(array['d','e'], array['f','g'], 2)));
reset role;
select pg_temp.check(pg_temp.round(:'mid', 1) = 'c1:org,a v b,c | c2:d,e v f,g', 'round 1 saved');
set role authenticated;

-- Validation.
select pg_temp.check(pg_temp.fails(format('select public.save_round(%L, 1, %L)', :'mid', jsonb_build_array(pg_temp.g(array['h','w'], array['a','b'], 1)))) like '%just made round 1%', 'out of order');
select pg_temp.check(pg_temp.fails(format('select public.save_round(%L, 2, %L)', :'mid', jsonb_build_array(pg_temp.g(array['h','w'], array['x','b'], 1)))) like '%confirmed%', 'waitlisted person not allowed');
select pg_temp.check(pg_temp.fails(format('select public.save_round(%L, 2, %L)', :'mid', jsonb_build_array(pg_temp.g(array['h','w'], array['a','b'], 1), pg_temp.g(array['a','c'], array['d','e'], 2)))) like '%two games%', 'nobody twice in a round');
select pg_temp.check(pg_temp.fails(format('select public.save_round(%L, 2, %L)', :'mid', jsonb_build_array(pg_temp.g(array['h'], array['a'], 1)))) like '%2 players%', 'doubles needs pairs');
select pg_temp.check(pg_temp.fails(format('select public.save_round(%L, 2, %L)', :'mid', jsonb_build_array(pg_temp.g(array['h','w'], array['a','b'], 3)))) like '%isn''t part%', 'no court 3');

-- Swaps: within a game, across games, and bringing in someone sitting out (h).
select public.swap_planned(pg_temp.gid(:'mid', 1, 1), pg_temp.uid('a'), pg_temp.uid('b'));
reset role; select pg_temp.check(pg_temp.round(:'mid', 1) = 'c1:org,b v a,c | c2:d,e v f,g', 'swap within a game'); set role authenticated;
select public.swap_planned(pg_temp.gid(:'mid', 1, 1), pg_temp.uid('c'), pg_temp.uid('d'));
reset role; select pg_temp.check(pg_temp.round(:'mid', 1) = 'c1:org,b v a,d | c2:c,e v f,g', 'swap across courts'); set role authenticated;
select public.swap_planned(pg_temp.gid(:'mid', 1, 2), pg_temp.uid('g'), pg_temp.uid('h'));
reset role; select pg_temp.check(pg_temp.round(:'mid', 1) = 'c1:org,b v a,d | c2:c,e v f,h', 'bring in someone sitting out'); set role authenticated;
select pg_temp.check(pg_temp.fails(format('select public.swap_planned(%L, %L, %L)', pg_temp.gid(:'mid', 1, 2), pg_temp.uid('h'), pg_temp.uid('x'))) like '%confirmed%', 'cannot bring in the waitlist');

-- Tap the winners: a normal game, on the leaderboard.
select public.log_planned(pg_temp.gid(:'mid', 1, 1), 'a', 21, 18) as game \gset
reset role;
select pg_temp.check(pg_temp.round(:'mid', 1) = 'c1:org,b v a,d ✓ | c2:c,e v f,h', 'result linked');
select pg_temp.check((select match_id from public.games where id = :'game') = :'mid', 'logged as a match game');
set role authenticated;
select pg_temp.check(exists (select 1 from jsonb_array_elements(public.get_leaderboard() -> 'games') x where x ->> 'id' = :'game'), 'on the leaderboard');
select pg_temp.check(pg_temp.fails(format('select public.log_planned(%L, %L)', pg_temp.gid(:'mid', 1, 1), 'b')) like '%already has a result%', 'one result per game');
select pg_temp.check(pg_temp.fails(format('select public.swap_planned(%L, %L, %L)', pg_temp.gid(:'mid', 1, 1), pg_temp.uid('b'), pg_temp.uid('g'))) like '%has a result%', 'no changes after a result');
select pg_temp.check(pg_temp.fails(format('select public.swap_planned(%L, %L, %L)', pg_temp.gid(:'mid', 1, 2), pg_temp.uid('h'), pg_temp.uid('b'))) like '%has a result%', 'cannot pull someone out of a played game');

-- The plan in get_match: players only, with names and results.
select public.get_match(:'slug') as v \gset
select pg_temp.check(jsonb_array_length(:'v'::jsonb -> 'plan') = 2, 'two games in the plan');
select pg_temp.check((:'v'::jsonb -> 'plan' -> 0 ->> 'winner') = 'a' and (:'v'::jsonb -> 'plan' -> 0 ->> 'score_a') = '21'
                 and (:'v'::jsonb -> 'plan' -> 0 -> 'a' -> 0 ->> 'full_name') = 'Org', 'names and result');
select pg_temp.as_user('x');
select pg_temp.check((public.get_match(:'slug') -> 'plan') = 'null'::jsonb, 'waitlist does not see the plan');

-- Round 2 ("play again" = same four on a new round), then undo it; round 1 can't be removed while it has a result.
select pg_temp.as_user('org');
select public.save_round(:'mid', 2, jsonb_build_array(pg_temp.g(array['org','b'], array['a','d'], 1), pg_temp.g(array['g','w'], array['c','e'], 2)));
select public.delete_round(:'mid', 2);
reset role; select pg_temp.check(pg_temp.round(:'mid', 2) is null, 'round 2 undone'); set role authenticated;
select pg_temp.check(pg_temp.fails(format('select public.delete_round(%L, 1)', :'mid')) like '%has results%', 'round with results stays');
-- Undoing the result (delete_game) frees the game again.
select public.delete_game(:'game');
reset role; select pg_temp.check(pg_temp.round(:'mid', 1) = 'c1:org,b v a,d | c2:c,e v f,h', 'result undone'); set role authenticated;
select public.delete_round(:'mid', 1);

-- Singles: one per side.
select public.create_match('Singles plan', 'singles', 1, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 60, 6) as s2 \gset
reset role; select id as m2 from public.matches where slug = :'s2' \gset
set role authenticated;
select pg_temp.as_user('a'); select public.join_match(:'m2');
select pg_temp.as_user('org');
select public.save_round(:'m2', 1, jsonb_build_array(pg_temp.g(array['org'], array['a'], 1)));
select pg_temp.check(pg_temp.fails(format('select public.save_round(%L, 2, %L)', :'m2', jsonb_build_array(pg_temp.g(array['org','a'], array['b','c'], 1)))) like '%1 player%', 'singles: one each');

-- Closed table.
select pg_temp.check(pg_temp.fails('select * from public.planned_games') like '%permission denied%', 'table closed');
reset role;

\o
\echo GAME PLAN CHECKS PASSED
