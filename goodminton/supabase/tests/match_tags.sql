-- Tagging results to a match (0029): log from anywhere into a match, move and untag games, suggested match.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from public.profiles where email = u || '@mt.test'), ''), false);
end $$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
end $$;
create function pg_temp.fails(q text) returns text language plpgsql as $$
begin execute q; return ''; exception when others then return sqlerrm; end $$;
create function pg_temp.uid(u text) returns uuid language sql security definer as $$ select id from public.profiles where email = u || '@mt.test' $$;
create function pg_temp.g(a1 text, a2 text, b1 text, b2 text, w text) returns jsonb language sql as $$
  select jsonb_build_object('a1', pg_temp.uid(a1), 'a2', pg_temp.uid(a2), 'b1', pg_temp.uid(b1), 'b2', pg_temp.uid(b2), 'winner', w)
$$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@mt.test', jsonb_build_object('full_name', initcap(n))
from unnest(array['org','ann','ben','cat','dan','out','oth']) n;

-- Two matches in org's group. ann, ben, cat play the first; dan only the second (so he's in the group, not match 1).
select pg_temp.as_user('org'); set role authenticated;
select public.create_match('Tonight', 'doubles', 1, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6) as s1 \gset
select public.create_match('Earlier', 'doubles', 1, 'Hall', (now() + interval '4 days')::date, '20:00', 'Asia/Dubai', 90, 6) as s2 \gset
select public.create_match('Next week', 'doubles', 1, 'Hall', (now() + interval '7 days')::date, '20:00', 'Asia/Dubai', 90, 6) as s3 \gset
reset role;
select id as m1, group_id as gid from public.matches where slug = :'s1' \gset
select id as m2 from public.matches where slug = :'s2' \gset
select id as m3 from public.matches where slug = :'s3' \gset
select pg_temp.as_user(u), public.join_match(:'m1') from unnest(array['ann','ben','cat']) u;
select pg_temp.as_user('dan'), public.join_match(:'m2');
-- Someone else's group and match.
select pg_temp.as_user('oth'); set role authenticated;
select public.create_match('Elsewhere', 'doubles', 1, 'Gym', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6) as s4 \gset
reset role;
select id as m4 from public.matches where slug = :'s4' \gset
-- Match 1 is on now; match 2 was two days ago.
update public.matches set starts_at = now() - interval '30 minutes' where id = :'m1';
update public.matches set starts_at = now() - interval '2 days' where id = :'m2';

-- The suggested match is the live one.
select pg_temp.as_user('ann'); set role authenticated;
select public.recent_matches(:'gid') as rm \gset
reset role;
select pg_temp.check((select count(*) from jsonb_array_elements(:'rm'::jsonb)) = 2, 'recent: started matches only (not next week)');
select pg_temp.check((select x ->> 'id' from jsonb_array_elements(:'rm'::jsonb) x where (x ->> 'suggested')::boolean) = :'m1', 'suggest the live match');
select pg_temp.check((select (x ->> 'live')::boolean from jsonb_array_elements(:'rm'::jsonb) x where x ->> 'id' = :'m1'), 'live flag');
select pg_temp.as_user('out'); set role authenticated;
select pg_temp.check(public.recent_matches(:'gid') = '[]'::jsonb, 'outsiders see no matches');
reset role;

-- Logged from Insights into match 1, with dan (group member, not in match 1).
select pg_temp.as_user('ann'); set role authenticated;
select public.log_games(:'m1', null, jsonb_build_array(pg_temp.g('ann','dan','ben','cat','a')));
reset role;
select id as g1 from public.games where match_id = :'m1' \gset
select pg_temp.check((select played_on = (m.starts_at at time zone m.timezone)::date and games.group_id = :'gid'
                        from public.games, public.matches m where games.id = :'g1' and m.id = :'m1'), 'tagged game takes the match date and group');
-- Someone outside the group can't be in it.
select pg_temp.as_user('ann'); set role authenticated;
select pg_temp.check(pg_temp.fails(format('select public.log_games(%L, null, %L)', :'m1', jsonb_build_array(pg_temp.g('ann','out','ben','cat','a')))) like '%this match or its group%', 'outsider refused in a match game');
reset role;
select pg_temp.as_user('out'); set role authenticated;
select pg_temp.check(pg_temp.fails(format('select public.log_games(%L, null, %L)', :'m1', jsonb_build_array(pg_temp.g('ann','dan','ben','cat','a')))) like '%Only players%', 'outsider can''t log into the match');
reset role;

-- Move it to match 2, untag, tag again.
select pg_temp.as_user('ann'); set role authenticated;
select public.tag_game(:'g1', :'m2');
reset role;
select pg_temp.check((select match_id = :'m2' and played_on = (now() - interval '2 days')::date from public.games where id = :'g1'), 'moved to match 2 with its date');
select pg_temp.as_user('ann'); set role authenticated;
select public.tag_game(:'g1', null);
reset role;
select pg_temp.check((select match_id is null and played_on = (now() - interval '2 days')::date from public.games where id = :'g1'), 'untagged, keeps its date');
select pg_temp.as_user('ann'); set role authenticated;
select public.tag_game(:'g1', :'m1');
select pg_temp.check(pg_temp.fails(format('select public.tag_game(%L, %L)', :'g1', :'m4')) like '%same group%', 'no match from another group');
select pg_temp.check(pg_temp.fails(format('select public.tag_game(%L, %L)', :'g1', :'m3')) like '%started%', 'not a match that hasn''t started');
reset role;
select pg_temp.as_user('ben'); set role authenticated;
select pg_temp.check(pg_temp.fails(format('select public.tag_game(%L, %L)', :'g1', :'m2')) like '%Only the person%', 'only the logger or organiser can move it');
reset role;
select pg_temp.as_user('org'); set role authenticated;
select public.tag_game(:'g1', :'m2');
reset role;
select pg_temp.check((select match_id = :'m2' from public.games where id = :'g1'), 'organiser can move it');

-- Leaderboard carries match_id.
select pg_temp.as_user('ann'); set role authenticated;
select pg_temp.check((public.get_leaderboard(:'gid') -> 'games' -> 0 ->> 'match_id') = :'m2', 'leaderboard has match_id');
reset role;

-- Nothing live: the newest from the last 3 days. Older than that: no suggestion.
update public.matches set starts_at = now() - interval '10 days' where id = :'m1';
select pg_temp.as_user('ann'); set role authenticated;
select public.recent_matches(:'gid') as rm \gset
reset role;
select pg_temp.check((select x ->> 'id' from jsonb_array_elements(:'rm'::jsonb) x where (x ->> 'suggested')::boolean) = :'m2', 'suggest the last 3 days');
update public.matches set starts_at = now() - interval '5 days' where id = :'m2';
select pg_temp.as_user('ann'); set role authenticated;
select public.recent_matches(:'gid') as rm \gset
reset role;
select pg_temp.check(not exists (select 1 from jsonb_array_elements(:'rm'::jsonb) x where (x ->> 'suggested')::boolean), 'nothing recent: no suggestion');

select pg_temp.check(not has_function_privilege('anon', 'public.tag_game(uuid, uuid)', 'execute')
                 and not has_function_privilege('anon', 'public.recent_matches(uuid)', 'execute')
                 and not has_function_privilege('authenticated', 'public.can_play_in(uuid, uuid)', 'execute'), 'grants');

\o
\echo MATCH TAG CHECKS PASSED
