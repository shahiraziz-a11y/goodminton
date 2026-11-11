-- Insights: my games across groups, week by week, totals.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from public.profiles where email = u || '@ins.test'), ''), false);
end $$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
end $$;
create function pg_temp.uid(u text) returns uuid language sql security definer as $$ select id from public.profiles where email = u || '@ins.test' $$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@ins.test', jsonb_build_object('full_name', initcap(n))
from unnest(array['ann','ben','cat','dan','eve','fay','new']) n;

-- Two groups: ann is in both.
insert into public.groups (id, name, owner_id, invite_code) values (gen_random_uuid(), 'G1 ins', pg_temp.uid('ann'), 'insg1code'), (gen_random_uuid(), 'G2 ins', pg_temp.uid('eve'), 'insg2code');
select id as g1 from public.groups where name = 'G1 ins' \gset
select id as g2 from public.groups where name = 'G2 ins' \gset
insert into public.group_members (group_id, user_id) select :'g1', pg_temp.uid(u) from unnest(array['ann','ben','cat','dan']) u on conflict do nothing;
insert into public.group_members (group_id, user_id) select :'g2', pg_temp.uid(u) from unnest(array['ann','eve','fay']) u on conflict do nothing;

-- Now is Thursday 22 Oct 2026 in Dubai.
\set now '2026-10-22 12:00+04'
insert into public.games (created_by, played_on, created_at, a1, a2, b1, b2, winner, group_id) values
  (pg_temp.uid('ann'), '2026-10-20', '2026-10-20 20:00+04', pg_temp.uid('ann'), pg_temp.uid('ben'), pg_temp.uid('cat'), pg_temp.uid('dan'), 'a', :'g1'),
  (pg_temp.uid('ann'), '2026-10-13', '2026-10-13 20:00+04', pg_temp.uid('ann'), pg_temp.uid('cat'), pg_temp.uid('ben'), pg_temp.uid('dan'), 'b', :'g1'),
  (pg_temp.uid('eve'), '2026-10-14', '2026-10-14 20:00+04', pg_temp.uid('eve'), pg_temp.uid('fay'), pg_temp.uid('ann'), pg_temp.uid('ben'), 'a', :'g2'),
  -- Not ann's game, but in her group: counts for ratings.
  (pg_temp.uid('ben'), '2026-10-06', '2026-10-06 20:00+04', pg_temp.uid('ben'), pg_temp.uid('cat'), pg_temp.uid('dan'), pg_temp.uid('fay'), 'a', :'g1'),
  -- After "now": left out.
  (pg_temp.uid('ann'), '2026-10-23', '2026-10-23 20:00+04', pg_temp.uid('ann'), pg_temp.uid('ben'), pg_temp.uid('cat'), pg_temp.uid('dan'), 'a', :'g1');

select pg_temp.as_user('ann'); set role authenticated;
select public.my_insights(:'now') as i \gset
reset role;
select pg_temp.check(jsonb_array_length(:'i'::jsonb -> 'games') = 4, 'games from both groups, none after now');
select pg_temp.check((:'i'::jsonb -> 'games' -> 0 ->> 'played_on') = '2026-10-20', 'newest first');
select pg_temp.check(jsonb_array_length(:'i'::jsonb -> 'weeks') = 12 and (:'i'::jsonb -> 'weeks' -> 11 ->> 'week') = '2026-10-19', '12 weeks, this week last');
select pg_temp.check((:'i'::jsonb -> 'weeks' -> 11 ->> 'games')::int = 1 and (:'i'::jsonb -> 'weeks' -> 10 ->> 'games')::int = 2, 'games per week');
select pg_temp.check((:'i'::jsonb ->> 'games_played')::int = 3 and (:'i'::jsonb ->> 'first_played') = '2026-10-13', 'totals');
select pg_temp.check((:'i'::jsonb -> 'people' ->> pg_temp.uid('fay')::text) = 'Fay', 'names');

-- A brand-new player: empty but well-formed.
select pg_temp.as_user('new'); set role authenticated;
select public.my_insights(:'now') as i \gset
reset role;
select pg_temp.check(jsonb_array_length(:'i'::jsonb -> 'games') = 0 and jsonb_array_length(:'i'::jsonb -> 'weeks') = 12, 'new player');
select pg_temp.check(not has_function_privilege('anon', 'public.my_insights(timestamptz)', 'execute'), 'anon can''t');

\o
\echo INSIGHTS CHECKS PASSED
