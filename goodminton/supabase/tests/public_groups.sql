-- Public groups: find, look inside, request, approve; private groups stay hidden.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from public.profiles where email = u || '@pub.test'), ''), false);
end $$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
end $$;
create function pg_temp.fails(q text) returns text language plpgsql as $$
begin execute q; return ''; exception when others then return sqlerrm; end $$;
create function pg_temp.uid(u text) returns uuid language sql security definer as $$ select id from public.profiles where email = u || '@pub.test' $$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@pub.test', jsonb_build_object('full_name', initcap(n))
from unnest(array['own','mem','new','odd']) n;
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
select pg_temp.uid(u), 'https://push.test/' || u, 'k', 'a' from unnest(array['own','new']) u;

-- Own runs "Pub Club" (public, a match and a game) and "Hidden Club" (private).
select pg_temp.as_user('own'); set role authenticated;
select public.create_group('Pub Club') as pub \gset
select public.create_group('Hidden Club') as hid \gset
select public.set_group_public(:'hid', false);
select public.create_match('Pub night', 'doubles', 1, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6, 'AED', :'pub') as slug \gset
reset role;
select id as mid from public.matches where slug = :'slug' \gset
insert into public.group_members (group_id, user_id) values (:'pub', pg_temp.uid('mem'));
insert into public.match_players (match_id, user_id, status) values (:'mid', pg_temp.uid('mem'), 'confirmed');
insert into public.games (created_by, played_on, a1, b1, winner, group_id) values (pg_temp.uid('own'), current_date, pg_temp.uid('own'), pg_temp.uid('mem'), 'a', :'pub');

-- A newcomer finds the public group, not the private one.
select pg_temp.as_user('new'); set role authenticated;
select public.list_groups() as l \gset
select pg_temp.check(:'l'::text like '%Pub Club%' and :'l'::text not like '%Hidden Club%', 'directory: public only');
select pg_temp.check(jsonb_array_length(public.list_groups('pub')) = 1 and jsonb_array_length(public.list_groups('zzz')) = 0, 'search');
-- Inside: members and the upcoming match, no invite code, no requests list.
select public.get_group(:'pub') as g \gset
select pg_temp.check((:'g'::jsonb ->> 'my_status') = 'none' and (:'g'::jsonb ->> 'invite_code') is null and (:'g'::jsonb -> 'requests') = 'null'::jsonb, 'non-member view');
select pg_temp.check(jsonb_array_length(:'g'::jsonb -> 'members') = 2 and (:'g'::jsonb -> 'upcoming' -> 0 ->> 'confirmed')::int = 2, 'members and matches');
select pg_temp.check(:'g'::text not like '%cost%' and :'g'::text not like '%courts%', 'no money or courts');
select pg_temp.check(jsonb_array_length(public.get_leaderboard(:'pub') -> 'games') = 1, 'public rankings');
select pg_temp.check(pg_temp.fails(format('select public.get_group(%L)', :'hid')) like '%not found%', 'private hidden');
select pg_temp.check(public.get_leaderboard(:'hid') -> 'group' = 'null'::jsonb, 'private rankings hidden');
select pg_temp.check(pg_temp.fails(format('select public.request_join(%L)', :'hid')) like '%not found%', 'private: no requests');

-- Request; can't twice; members can't.
select public.request_join(:'pub');
select pg_temp.check(pg_temp.fails(format('select public.request_join(%L)', :'pub')) like '%already asked%', 'no duplicate');
select pg_temp.check((public.get_group(:'pub') ->> 'my_status') = 'requested', 'shows requested');
select pg_temp.as_user('mem');
select pg_temp.check(pg_temp.fails(format('select public.request_join(%L)', :'pub')) like '%already in%', 'member can''t request');
reset role;
select pg_temp.check(exists (select 1 from public.notifications where user_id = pg_temp.uid('own') and kind = 'join_request'), 'owner told');

-- Only the owner sees and decides.
select id as req from public.group_requests where user_id = pg_temp.uid('new') \gset
select pg_temp.as_user('mem'); set role authenticated;
select pg_temp.check(pg_temp.fails(format('select public.decide_request(%L, true)', :'req')) like '%Only the group owner%', 'member can''t approve');
select pg_temp.check(pg_temp.fails(format('select public.set_group_public(%L, false)', :'pub')) like '%Only the group owner%', 'member can''t hide');
select pg_temp.as_user('own');
select pg_temp.check(jsonb_array_length(public.get_group(:'pub') -> 'requests') = 1, 'owner sees request');
select pg_temp.check((select (x ->> 'requests')::int from jsonb_array_elements(public.my_groups()) x where x ->> 'name' = 'Pub Club') = 1, 'count on my groups');
select public.decide_request(:'req', true);
select pg_temp.check(pg_temp.fails(format('select public.decide_request(%L, true)', :'req')) like '%Already decided%', 'decided once');
reset role;
select pg_temp.check(public.is_member(:'pub', pg_temp.uid('new')), 'approved: member');
select pg_temp.check(exists (select 1 from public.notifications where user_id = pg_temp.uid('new') and kind = 'join_approved'), 'newcomer told');

-- Declined: not added.
select pg_temp.as_user('odd'); set role authenticated; select public.request_join(:'pub'); reset role;
select id as req2 from public.group_requests where user_id = pg_temp.uid('odd') \gset
select pg_temp.as_user('own'); set role authenticated; select public.decide_request(:'req2', false); reset role;
select pg_temp.check(not public.is_member(:'pub', pg_temp.uid('odd')), 'declined: not a member');
select pg_temp.check(not has_function_privilege('anon', 'public.list_groups(text)', 'execute'), 'anon can''t list');

\o
\echo PUBLIC GROUP CHECKS PASSED
