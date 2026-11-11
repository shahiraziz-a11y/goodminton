-- Peg board: courts run on their own; start, finish, undo.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from public.profiles where email = u || '@peg.test'), ''), false);
end $$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
end $$;
create function pg_temp.fails(q text) returns text language plpgsql as $$
begin execute q; return ''; exception when others then return sqlerrm; end $$;
create function pg_temp.uid(u text) returns uuid language sql security definer as $$ select id from public.profiles where email = u || '@peg.test' $$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@peg.test', jsonb_build_object('full_name', initcap(n))
from unnest(array['org','ann','ben','cat','dan','eve','fay','gus','out']) n;

-- Two courts, starting in an hour: everyone joins.
select pg_temp.as_user('org'); set role authenticated;
select public.create_match('Peg night', 'doubles', 2, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6) as slug \gset
reset role;
select id as mid from public.matches where slug = :'slug' \gset
select pg_temp.as_user(u), public.join_match(:'mid') from unnest(array['ann','ben','cat','dan','eve','fay','gus']) u;
\o /dev/null
-- Match day: it starts in an hour.
update public.matches set starts_at = now() + interval '1 hour' where id = :'mid';

-- Ann starts court 1.
select pg_temp.as_user('ann'); set role authenticated;
select public.board_start(:'mid', 1, pg_temp.uid('ann'), pg_temp.uid('ben'), pg_temp.uid('cat'), pg_temp.uid('dan')) as g1 \gset
select pg_temp.check(pg_temp.fails(format('select public.board_start(%L, 1, %L, %L, %L, %L)', :'mid', pg_temp.uid('eve'), pg_temp.uid('fay'), pg_temp.uid('gus'), pg_temp.uid('org'))) like '%already playing%', 'busy court');
select pg_temp.check(pg_temp.fails(format('select public.board_start(%L, 2, %L, %L, %L, %L)', :'mid', pg_temp.uid('ann'), pg_temp.uid('fay'), pg_temp.uid('gus'), pg_temp.uid('org'))) like '%another court%', 'player on two courts');
select pg_temp.check(pg_temp.fails(format('select public.board_start(%L, 3, %L, %L, %L, %L)', :'mid', pg_temp.uid('eve'), pg_temp.uid('fay'), pg_temp.uid('gus'), pg_temp.uid('org'))) like '%Pick a court%', 'no court 3');
select pg_temp.check(pg_temp.fails(format('select public.board_start(%L, 2, %L, %L, %L, %L)', :'mid', pg_temp.uid('eve'), pg_temp.uid('eve'), pg_temp.uid('gus'), pg_temp.uid('org'))) like '%twice%', 'same person twice');
select pg_temp.check(pg_temp.fails(format('select public.board_start(%L, 2, %L, %L, %L, %L)', :'mid', pg_temp.uid('eve'), pg_temp.uid('out'), pg_temp.uid('gus'), pg_temp.uid('org'))) like '%confirmed%', 'outsider on court');
select public.board_start(:'mid', 2, pg_temp.uid('eve'), pg_temp.uid('fay'), pg_temp.uid('gus'), pg_temp.uid('org')) as g2 \gset
-- Someone not in the match can't run it or see it.
select pg_temp.as_user('out');
select pg_temp.check(pg_temp.fails(format('select public.board_finish(%L, ''a'')', :'g1')) like '%Only players%', 'outsider runs nothing');
select pg_temp.check(public.get_board(:'slug') is null, 'outsider sees nothing');

-- Court 1 finishes: Ben (another player) taps Game over; the result is logged.
select pg_temp.as_user('ben');
select public.board_finish(:'g1', 'a', 21, 15);
select public.get_board(:'slug') as b \gset
reset role;
select pg_temp.check((select winner || score_a || '-' || score_b from public.games where id = (select game_id from public.board_games where id = :'g1')) = 'a21-15', 'result logged');
select pg_temp.check((:'b'::jsonb -> 'games' -> 0 ->> 'winner') = 'a' and (:'b'::jsonb -> 'games' -> 0 ->> 'ended_at') is not null
                 and jsonb_array_length(:'b'::jsonb -> 'players') = 8 and jsonb_array_length(:'b'::jsonb -> 'games' -> 0 -> 'a') = 2, 'board shape');
-- Court 1 is free: the same four can go again.
select pg_temp.as_user('ann'); set role authenticated;
select public.board_start(:'mid', 1, pg_temp.uid('ann'), pg_temp.uid('cat'), pg_temp.uid('ben'), pg_temp.uid('dan')) as g3 \gset
-- Court 2 ends with no result.
select public.board_finish(:'g2', null);
reset role;
select pg_temp.check((select ended_at is not null and game_id is null from public.board_games where id = :'g2'), 'no-result finish');

-- Undo a live game: it comes off.
select pg_temp.as_user('ann'); set role authenticated;
select public.board_undo(:'g3');
reset role;
select pg_temp.check(not exists (select 1 from public.board_games where id = :'g3'), 'live game undone');
-- Undo the finished game: back on court, result removed.
select game_id as gm from public.board_games where id = :'g1' \gset
select pg_temp.as_user('ann'); set role authenticated;
select public.board_undo(:'g1');
reset role;
select pg_temp.check((select ended_at is null and game_id is null from public.board_games where id = :'g1') and not exists (select 1 from public.games where id = :'gm'), 'finished game reopened');

-- Not on match day yet: closed.
update public.matches set starts_at = now() + interval '3 days' where id = :'mid';
select pg_temp.as_user('ann'); set role authenticated;
select pg_temp.check(pg_temp.fails(format('select public.board_finish(%L, ''a'')', :'g1')) like '%match day%', 'closed before match day');
reset role;
select pg_temp.check(not has_function_privilege('anon', 'public.get_board(text)', 'execute'), 'anon can''t');

\o
\echo PEG BOARD CHECKS PASSED
