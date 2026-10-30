-- Logging several games at once, and editing a logged game.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from public.profiles where email = u || '@le.test'), ''), false);
end $$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
end $$;
create function pg_temp.fails(q text) returns text language plpgsql as $$
begin execute q; return ''; exception when others then return sqlerrm; end $$;
create function pg_temp.uid(u text) returns uuid language sql security definer as $$ select id from public.profiles where email = u || '@le.test' $$;
create function pg_temp.g(a1 text, a2 text, b1 text, b2 text, w text, sa int default null, sb int default null) returns jsonb language sql as $$
  select jsonb_build_object('a1', pg_temp.uid(a1), 'a2', pg_temp.uid(a2), 'b1', pg_temp.uid(b1), 'b2', pg_temp.uid(b2), 'winner', w, 'score_a', sa, 'score_b', sb)
$$;
create function pg_temp.games() returns bigint language sql security definer as $$
  select count(*) from public.games where created_by in (select id from public.profiles where email like '%@le.test')
$$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@le.test', jsonb_build_object('full_name', initcap(n))
from unnest(array['org','ann','ben','cat','dan','out']) n;

-- org's match with ann, ben, cat: all in org's group.
select pg_temp.as_user('org'); set role authenticated;
select public.create_match('Log night', 'doubles', 1, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6) as slug \gset
reset role;
select id as mid, group_id as gid from public.matches where slug = :'slug' \gset
select pg_temp.as_user(u), public.join_match(:'mid') from unnest(array['ann','ben','cat']) u;
\o /dev/null
select pg_temp.as_user('dan'); set role authenticated; select public.join_match(:'mid'); reset role;

-- A batch of three friendly games in the group.
select pg_temp.as_user('ann'); set role authenticated;
select public.log_games(null, :'gid', jsonb_build_array(
  pg_temp.g('ann','ben','cat','org','a', 21, 15), pg_temp.g('ann','ben','cat','org','b'), pg_temp.g('ann','cat','ben','org','a'))) as n \gset
reset role;
select pg_temp.check(:n = 3 and pg_temp.games() = 3, 'three games saved');
-- One bad game: nothing saved, and the error says which.
select pg_temp.as_user('ann'); set role authenticated;
select pg_temp.fails(format('select public.log_games(null, %L, %L)', :'gid',
  jsonb_build_array(pg_temp.g('ann','ben','cat','org','a'), pg_temp.g('ann','ben','cat','out','a')))) as err \gset
reset role;
select pg_temp.check(:'err' like 'Game 2:%group%' and pg_temp.games() = 3, 'all or nothing');
select pg_temp.as_user('ann'); set role authenticated;
select pg_temp.check(pg_temp.fails(format('select public.log_games(null, %L, %L)', :'gid', '[]')) like '%Add a game%', 'empty batch refused');
reset role;

-- Edit: who won and the score; the game keeps its id and date.
select id as gm, played_on as day from public.games where score_a = 21 and created_by = pg_temp.uid('ann') \gset
select pg_temp.as_user('ann'); set role authenticated;
select public.edit_game(:'gm', pg_temp.uid('ann'), pg_temp.uid('ben'), pg_temp.uid('cat'), pg_temp.uid('org'), 'b', 18, 21);
reset role;
select pg_temp.check((select winner || score_a || '-' || score_b || played_on from public.games where id = :'gm') = 'b18-21' || :'day', 'edited, same date');
-- Swap a player for someone outside the group: refused.
select pg_temp.as_user('ann'); set role authenticated;
select pg_temp.check(pg_temp.fails(format('select public.edit_game(%L, %L, %L, %L, %L, ''a'')', :'gm', pg_temp.uid('ann'), pg_temp.uid('out'), pg_temp.uid('cat'), pg_temp.uid('org'))) like '%in the group%', 'outsider refused');
select pg_temp.check(pg_temp.fails(format('select public.edit_game(%L, %L, %L, %L, %L, ''a'')', :'gm', pg_temp.uid('ann'), pg_temp.uid('ann'), pg_temp.uid('cat'), pg_temp.uid('org'))) like '%twice%', 'same person twice refused');
select pg_temp.check(pg_temp.fails(format('select public.edit_game(%L, %L, %L, %L, %L, ''a'', 10, 21)', :'gm', pg_temp.uid('ann'), pg_temp.uid('ben'), pg_temp.uid('cat'), pg_temp.uid('org'))) like '%higher score%', 'score must match winner');
-- Someone else can't edit ann's friendly game.
select pg_temp.as_user('ben');
select pg_temp.check(pg_temp.fails(format('select public.edit_game(%L, %L, %L, %L, %L, ''a'')', :'gm', pg_temp.uid('ann'), pg_temp.uid('ben'), pg_temp.uid('cat'), pg_temp.uid('org'))) like '%Only the person%', 'not your game');
reset role;

-- A match game logged by ann: the organiser can fix it; players must be in the match.
select pg_temp.as_user('ann'); set role authenticated;
select public.log_games(:'mid', null, jsonb_build_array(pg_temp.g('ann','ben','cat','org','a'))) as n \gset
reset role;
select id as mg from public.games where match_id = :'mid' \gset
select pg_temp.as_user('org'); set role authenticated;
select public.edit_game(:'mg', pg_temp.uid('ann'), pg_temp.uid('cat'), pg_temp.uid('ben'), pg_temp.uid('org'), 'b');
select pg_temp.check(pg_temp.fails(format('select public.edit_game(%L, %L, %L, %L, %L, ''a'')', :'mg', pg_temp.uid('ann'), pg_temp.uid('dan'), pg_temp.uid('ben'), pg_temp.uid('org'))) like '%confirmed in this match%', 'match game: waitlisted dan can''t be put in');
reset role;
select pg_temp.check((select a2 = pg_temp.uid('cat') and winner = 'b' from public.games where id = :'mg'), 'organiser fixed the match game');
select pg_temp.check(not has_function_privilege('anon', 'public.edit_game(uuid, uuid, uuid, uuid, uuid, text, int, int)', 'execute')
                 and not has_function_privilege('anon', 'public.log_games(uuid, uuid, jsonb)', 'execute'), 'anon can''t');

\o
\echo LOG AND EDIT CHECKS PASSED
