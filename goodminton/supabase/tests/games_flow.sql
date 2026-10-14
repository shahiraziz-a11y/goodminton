-- Booking, organiser overrides, guest players, game results and the leaderboard.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email = u || '@games.test'), ''), false);
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

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@games.test', jsonb_build_object('full_name', initcap(n))
from unnest(array['org','ann','ben','cat','dan','eve','stranger']) n;
select id as org from public.profiles where email = 'org@games.test' \gset
select id as ann from public.profiles where email = 'ann@games.test' \gset
select id as ben from public.profiles where email = 'ben@games.test' \gset
select id as cat from public.profiles where email = 'cat@games.test' \gset
select id as dan from public.profiles where email = 'dan@games.test' \gset
select id as eve from public.profiles where email = 'eve@games.test' \gset
select id as stranger from public.profiles where email = 'stranger@games.test' \gset

-- A plan: no venue, no courts, no cost yet.
select pg_temp.as_user('org');
set role authenticated;
select public.create_match('Friday plan', 'doubles', 1, '', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6) as slug \gset
reset role;
select id as mid from public.matches where slug = :'slug' \gset
set role authenticated;
select public.get_match(:'slug') as v \gset
select pg_temp.check((:'v'::jsonb ->> 'status') = 'planning' and (:'v'::jsonb ->> 'venue') = '', 'plan without venue');

-- Before booking, players can still drop out.
select pg_temp.as_user('ann'); select public.join_match(:'mid');
select pg_temp.as_user('ben'); select public.join_match(:'mid');
select pg_temp.as_user('ben'); select public.leave_match(:'mid');
select pg_temp.as_user('ben'); select public.join_match(:'mid');
select pg_temp.as_user('cat'); select public.join_match(:'mid');
select pg_temp.as_user('dan'); select public.join_match(:'mid') ->> 'status' as s \gset
select pg_temp.check(:'s' = 'waitlist', 'dan waits');

-- Booking.
select pg_temp.as_user('ann');
select pg_temp.check(pg_temp.fails(format('select public.book_match(%L, %L, %L, %L, 180)', :'mid', 'Hall', 'Court 2', '')) like '%Only the organiser%', 'only organiser books');
select pg_temp.as_user('org');
select pg_temp.check(pg_temp.fails(format('select public.book_match(%L, %L, %L, %L, 180)', :'mid', '', 'Court 2', '')) like '%venue%', 'venue required');
select public.book_match(:'mid', 'Al Quoz Sports Hall', 'Court 2', 'Gate B', 180);
select public.book_match(:'mid', 'Al Quoz Sports Hall', 'Court 4', 'Gate B', 180);
reset role;
select pg_temp.check((select status from public.matches where id = :'mid') = 'booked', 'booked');
select pg_temp.check((select courts from public.matches where id = :'mid') = 'Court 4', 'details editable after booking');
select pg_temp.check((select count(*) from public.expenses where match_id = :'mid') = 1
                 and (select amount from public.expenses where match_id = :'mid') = 180, 'one booking expense');
set role authenticated;

-- Booked: confirmed players are locked in, the waitlist can still leave.
select pg_temp.as_user('ann');
select pg_temp.check(pg_temp.fails(format('select public.leave_match(%L)', :'mid')) like '%locked in%', 'no drop-out after booking');
select pg_temp.as_user('eve'); select public.join_match(:'mid');
select pg_temp.as_user('eve'); select public.leave_match(:'mid') ->> 'status' as s \gset
select pg_temp.check(:'s' = 'waitlist', 'waitlist can leave after booking');

-- Organiser removes a confirmed player; the first in line is promoted.
select pg_temp.as_user('ann');
select pg_temp.check(pg_temp.fails(format('select public.remove_player(%L, %L)', :'mid', :'ben')) like '%Only the organiser%', 'only organiser removes');
select pg_temp.as_user('org');
select public.remove_player(:'mid', :'ben') ->> 'promoted' as p \gset
select pg_temp.check(:'p' = 'Dan', 'dan promoted on removal');
select pg_temp.check(pg_temp.fails(format('select public.remove_player(%L, %L)', :'mid', :'org')) like '%organiser can%', 'cannot remove the organiser');

-- Organiser adds a guest (name only) and someone from their circle.
select public.add_player(:'mid', null, 'Uncle Raj') as j \gset
select pg_temp.check((:'j'::jsonb ->> 'status') = 'waitlist', 'guest waits when full');
select public.add_player(:'mid', :'ben', null) ->> 'status' as s \gset
select pg_temp.check(:'s' = 'waitlist', 'circle member added back');
select pg_temp.check(pg_temp.fails(format('select public.add_player(%L, %L, null)', :'mid', :'stranger')) like '%played with%', 'cannot add strangers');
select pg_temp.check(pg_temp.fails(format('select public.add_player(%L, null, %L)', :'mid', '  ')) like '%name%', 'guest needs a name');
select public.my_players() as pl \gset
select pg_temp.check(exists (select 1 from jsonb_array_elements(:'pl'::jsonb) x where x ->> 'full_name' = 'Uncle Raj' and (x ->> 'is_guest')::boolean), 'guest in my players');
select pg_temp.check(not exists (select 1 from jsonb_array_elements(:'pl'::jsonb) x where x ->> 'full_name' = 'Stranger'), 'strangers not in my players');
reset role;
select id as raj from public.profiles where full_name = 'Uncle Raj' \gset
set role authenticated;

-- Pairs on the court: confirmed are org, ann, cat, dan. Make it org+dan vs ann+cat.
select pg_temp.as_user('cat');
select public.set_court_order(:'mid', array[:'org', :'dan', :'ann', :'cat']::uuid[]);
select public.get_match(:'slug') as v \gset
select pg_temp.check((select string_agg(x ->> 'full_name', ',') from jsonb_array_elements(:'v'::jsonb -> 'players') x) = 'Org,Dan,Ann,Cat', 'pairs reordered');
select pg_temp.check(pg_temp.fails(format('select public.set_court_order(%L, %L::uuid[])', :'mid', array[:'org', :'dan', :'ann', :'ben'])) like '%same court%', 'only confirmed players on the court');
select pg_temp.as_user('ben');
select pg_temp.check(pg_temp.fails(format('select public.set_court_order(%L, %L::uuid[])', :'mid', array[:'org', :'dan', :'ann', :'cat'])) like '%Only players%', 'waitlist cannot reorder');

-- Logging results from the match.
select pg_temp.as_user('ann');
select public.log_game(:'mid', :'org', :'dan', :'ann', :'cat', 'b') as g1 \gset
select pg_temp.check(pg_temp.fails(format('select public.log_game(%L, %L, %L, %L, %L, %L)', :'mid', :'org', :'dan', :'ann', :'ben', 'a')) like '%confirmed%', 'match game needs confirmed players');
select pg_temp.as_user('ben');
select pg_temp.check(pg_temp.fails(format('select public.log_game(%L, %L, %L, %L, %L, %L)', :'mid', :'org', :'dan', :'ann', :'cat', 'a')) like '%Only players%', 'waitlist cannot log');

-- Home cards: latest winners, not started; court numbers only for confirmed players.
select x as card from jsonb_array_elements(public.my_matches()) x where x ->> 'slug' = :'slug' \gset
select pg_temp.check((:'card'::jsonb ->> 'last_winners') = 'Ann & Cat' and not (:'card'::jsonb ->> 'started')::boolean
                 and (:'card'::jsonb ->> 'games_count')::int = 1 and (:'card'::jsonb ->> 'courts') is null, 'waitlist home card');
select pg_temp.as_user('ann');
select x as card from jsonb_array_elements(public.my_matches()) x where x ->> 'slug' = :'slug' \gset
select pg_temp.check((:'card'::jsonb ->> 'courts') = 'Court 4', 'confirmed see court numbers on home');

-- Logging from home: anyone in my circle, guests included; never strangers.
select pg_temp.as_user('org');
select public.log_game(null, :'org', :'raj', :'ben', :'eve', 'a') as g2 \gset
select pg_temp.check(pg_temp.fails(format('select public.log_game(null, %L, %L, %L, %L, %L)', :'org', :'raj', :'ben', :'stranger', 'a')) like '%played with%', 'no strangers in home games');
select pg_temp.check(pg_temp.fails(format('select public.log_game(null, %L, %L, %L, %L, %L)', :'org', :'org', :'ben', :'eve', 'a')) like '%players_check%', 'four different players');

-- Leaderboard visibility.
select public.get_leaderboard() as lb \gset
select pg_temp.check(jsonb_array_length(:'lb'::jsonb -> 'games') = 2, 'organiser sees both games');
select pg_temp.check((:'lb'::jsonb -> 'people' ->> :'raj') = 'Uncle Raj', 'guest named on leaderboard');
select pg_temp.as_user('cat');
select public.get_leaderboard() as lb \gset
select pg_temp.check(jsonb_array_length(:'lb'::jsonb -> 'games') = 2, 'circle member sees group games');
select pg_temp.as_user('stranger');
select public.get_leaderboard() as lb \gset
select pg_temp.check(jsonb_array_length(:'lb'::jsonb -> 'games') = 0, 'stranger sees nothing');

-- Removing a wrong result.
select pg_temp.as_user('cat');
select pg_temp.check(pg_temp.fails(format('select public.delete_game(%L)', :'g2')) like '%logged it%', 'only logger removes');
select pg_temp.as_user('org');
select public.delete_game(:'g1');  -- organiser of the match may remove its games
select public.delete_game(:'g2');
reset role;
select pg_temp.check((select count(*) from public.games where created_by = :'org' or match_id = :'mid') = 0, 'games removed');

-- Plan of 4 opens a second court before booking: no cost until booked, then both courts.
select pg_temp.as_user('org');
set role authenticated;
select public.create_match('Big plan', 'doubles', 1, '', (now() + interval '4 days')::date, '19:00', 'Asia/Dubai', 60, 2) as s2 \gset
reset role; select id as m2 from public.matches where slug = :'s2' \gset
set role authenticated;
select public.add_player(:'m2', id, null) from unnest(array[:'ann', :'ben', :'cat', :'dan', :'eve']::uuid[]) id;
select public.add_player(:'m2', null, 'Guest ' || n) from generate_series(1, 2) n;
select public.upgrade_match(:'m2');
select public.book_match(:'m2', 'Hall', 'Court 1', '', 100);
reset role;
select pg_temp.check((select courts from public.matches where id = :'m2') = 'Court 1 & Court 2', 'two courts on booking');
select pg_temp.check((select sum(amount) from public.expenses where match_id = :'m2') = 200, 'both courts charged once');

-- Permissions on the new table and functions.
set role authenticated;
select pg_temp.check(pg_temp.fails('select * from public.games') like '%permission denied%', 'games table closed');
reset role;
set role anon;
select pg_temp.check(pg_temp.fails('select public.get_leaderboard()') like '%permission denied%', 'anon has no leaderboard');
reset role;

\o
\echo GAMES CHECKS PASSED
