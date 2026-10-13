-- Alerts written to the outbox by triggers.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email = u || '@push.test'), ''), false);
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
-- Alerts for a user, oldest first, as "kind:title".
create function pg_temp.alerts(u text) returns text language sql security definer as $$
  select coalesce(string_agg(n.kind, ',' order by n.created_at, n.kind), '') from public.notifications n
    join public.profiles p on p.id = n.user_id where p.email = u || '@push.test'
$$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@push.test', jsonb_build_object('full_name', initcap(n) || ' Test')
from unnest(array['org','ann','ben','cat','dan','eve','nodevice']) n;

-- Everyone but "nodevice" has turned alerts on.
select pg_temp.as_user('org');
set role authenticated;
select pg_temp.check(pg_temp.fails($$select public.save_push_subscription('http://insecure', 'k', 'a', 'ua')$$) like '%Invalid%', 'https only');
reset role;
do $$ declare u text; begin
  foreach u in array array['org','ann','ben','cat','dan','eve'] loop
    perform pg_temp.as_user(u);
    execute 'set local role authenticated';
    perform public.save_push_subscription('https://push.example/' || u, 'key-' || u, 'auth-' || u, 'test');
    execute 'reset role';
  end loop;
end $$;
select pg_temp.check((select count(*) from public.push_subscriptions) >= 6, 'subscriptions saved');

select pg_temp.as_user('org');
set role authenticated;
select public.create_match('Alert test', 'doubles', 1, '', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6) as slug \gset
reset role; select id as mid from public.matches where slug = :'slug' \gset
select id as ann from public.profiles where email = 'ann@push.test' \gset
select id as eve from public.profiles where email = 'eve@push.test' \gset
set role authenticated;
select pg_temp.check(pg_temp.alerts('org') = '', 'creating a match alerts nobody');

-- Joins tell the organiser; the 4th also says full.
select pg_temp.as_user('ann'); select public.join_match(:'mid');
select pg_temp.as_user('ben'); select public.join_match(:'mid');
select pg_temp.as_user('cat'); select public.join_match(:'mid');
select pg_temp.check(pg_temp.alerts('org') in ('joined,joined,full,joined', 'joined,joined,joined,full'), 'org told about joins and full');
reset role;
select pg_temp.check((select count(*) from public.notifications n join public.profiles p on p.id = n.user_id
                       where p.email = 'org@push.test' and n.kind = 'full' and n.body like '%book the court%') = 1, 'full says book');
select pg_temp.check((select url from public.notifications where kind = 'full' limit 1) = '/m/' || :'slug', 'deep link');
set role authenticated;
select pg_temp.as_user('dan'); select public.join_match(:'mid');
select pg_temp.as_user('nodevice'); select public.join_match(:'mid');
select pg_temp.check(pg_temp.alerts('ann') = '', 'joiners not alerted about their own join');

-- Someone drops out: organiser told, first in line promoted.
select pg_temp.as_user('ann'); select public.leave_match(:'mid');
select pg_temp.check(pg_temp.alerts('dan') = 'promoted', 'dan told he moved up');
select pg_temp.check(pg_temp.alerts('org') like '%left', 'org told about drop-out');

-- Booking tells confirmed players (not the organiser who booked, not the waitlist).
select pg_temp.as_user('org');
select public.book_match(:'mid', 'Al Quoz Sports Hall', 'Court 3', '', 160);
select pg_temp.check(pg_temp.alerts('ben') = 'booked' and pg_temp.alerts('dan') = 'promoted,booked', 'confirmed told court booked');
select pg_temp.check(pg_temp.alerts('org') not like '%booked%', 'organiser not told about own action');
reset role;
select pg_temp.check((select body from public.notifications n join public.profiles p on p.id = n.user_id
                       where p.email = 'ben@push.test' and kind = 'booked') like '%Al Quoz Sports Hall · Court 3', 'booked body');
select pg_temp.check((select count(*) from public.notifications n join public.profiles p on p.id = n.user_id where p.email = 'nodevice@push.test') = 0, 'no device, no alert rows');
set role authenticated;

-- Time change tells everyone in the match.
select pg_temp.as_user('org');
select public.update_match(:'mid', 'Alert test', 'doubles', 1, (now() + interval '4 days')::date, '21:00', 90, 6);
select pg_temp.check(pg_temp.alerts('cat') = 'booked,rescheduled', 'time change');
reset role;
select pg_temp.check((select body from public.notifications where kind = 'rescheduled' limit 1) like '%9:00 PM.', 'new time in body');
set role authenticated;

-- Organiser adds a player (waitlist) and opens a court once 4 wait.
select pg_temp.as_user('org');
select public.add_player(:'mid', :'ann', null);
select pg_temp.check(pg_temp.alerts('ann') = 'added', 'added by organiser');
select public.add_player(:'mid', null, 'Guest ' || n) from generate_series(1, 2) n;
reset role; select id as ann_now from public.profiles where email = 'ann@push.test' \gset
set role authenticated;
select public.upgrade_match(:'mid');
select pg_temp.check(pg_temp.alerts('ben') like '%court_added', 'confirmed told about new court');
select pg_temp.check(pg_temp.alerts('ann') = 'added,promoted', 'waitlisted promoted onto new court');

-- Fewer spots: the moved player is told. Removal: the removed player is told.
select public.update_match(:'mid', 'Alert test', 'doubles', 1, (now() + interval '4 days')::date, '21:00', 90, 6);
select pg_temp.check(pg_temp.alerts('ann') like '%demoted', 'moved to waitlist');
select pg_temp.check(pg_temp.fails(format('select public.remove_player(%L, %L)', :'mid', :'eve')) like '%isn''t in%', 'eve not in match');
reset role; select id as ben from public.profiles where email = 'ben@push.test' \gset
set role authenticated;
select public.remove_player(:'mid', :'ben');
select pg_temp.check(pg_temp.alerts('ben') like '%removed', 'removed told');
reset role;
select pg_temp.check((select body from public.notifications n join public.profiles p on p.id = n.user_id
                       where p.email = 'ben@push.test' and kind = 'removed') like '%still owe%', 'removed after booking mentions share');

-- Booking only the courts you can fill: planned 2 doubles courts, 5 signed up, book 1.
select pg_temp.as_user('org');
set role authenticated;
select public.create_match('Two court plan', 'doubles', 2, '', (now() + interval '5 days')::date, '19:00', 'Asia/Dubai', 90, 6) as s2 \gset
reset role; select id as m2 from public.matches where slug = :'s2' \gset
set role authenticated;
select pg_temp.as_user('ann'); select public.join_match(:'m2');
select pg_temp.as_user('ben'); select public.join_match(:'m2');
select pg_temp.as_user('cat'); select public.join_match(:'m2');
select pg_temp.as_user('dan'); select public.join_match(:'m2');
reset role; delete from public.notifications; set role authenticated;
select pg_temp.as_user('ann');
select pg_temp.check(pg_temp.fails(format('select public.book_match(%L, %L, %L, %L, 90, 1)', :'m2', 'Hall', 'Court 5', '')) like '%Only the organiser%', 'only organiser books courts');
select pg_temp.as_user('org');
select pg_temp.check(pg_temp.fails(format('select public.book_match(%L, %L, %L, %L, 90, 0)', :'m2', 'Hall', 'Court 5', '')) like '%1 to 4%', 'at least one court');
select public.book_match(:'m2', 'Hall', 'Court 5', '', 90, 1) as r \gset
select pg_temp.check((:'r'::jsonb ->> 'demoted') = '1', 'fifth player moved to waitlist');
reset role;
select pg_temp.check((select court_count || '/' || size || '/' || courts || '/' || status from public.matches where id = :'m2') = '1/4/Court 5/booked', 'one court booked');
select pg_temp.check((select string_agg(p.full_name, ',' order by mp.seq) from public.match_players mp join public.profiles p on p.id = mp.user_id
                       where mp.match_id = :'m2' and mp.status = 'confirmed') = 'Org Test,Ann Test,Ben Test,Cat Test', 'first four confirmed');
select pg_temp.check((select p.full_name from public.match_players mp join public.profiles p on p.id = mp.user_id
                       where mp.match_id = :'m2' and mp.status = 'waitlist' order by mp.seq limit 1) = 'Dan Test', 'Dan is #1 on the waitlist');
select pg_temp.check((select sum(amount) from public.expenses where match_id = :'m2') = 90, 'only one court charged');
select pg_temp.check((select string_agg(n.kind, ',' order by n.kind) from public.notifications n join public.profiles p on p.id = n.user_id
                       where p.email = 'dan@push.test') = 'demoted', 'Dan told he moved to the waitlist, not that the court is booked');
select pg_temp.check((select string_agg(n.kind, ',') from public.notifications n join public.profiles p on p.id = n.user_id
                       where p.email = 'ann@push.test') = 'booked', 'Ann told court booked');
set role authenticated;
-- Booked players are locked in; the waitlisted fifth can still leave.
select pg_temp.as_user('ann');
select pg_temp.check(pg_temp.fails(format('select public.leave_match(%L)', :'m2')) like '%locked in%', 'court 1 players locked in');
-- Three more join; four waiting, so court 2 can be added and booked later.
select pg_temp.as_user('eve'); select public.join_match(:'m2');
select pg_temp.as_user('org');
select public.add_player(:'m2', null, 'Late ' || n) from generate_series(1, 2) n;
select public.upgrade_match(:'m2');
reset role;
select pg_temp.check((select court_count || '/' || courts from public.matches where id = :'m2') = '2/Court 5 & Court 6', 'court 2 added later');
select pg_temp.check((select sum(amount) from public.expenses where match_id = :'m2') = 180, 'second court charged when added');
set role authenticated;
-- Editing details later without p_court_count keeps the courts as they are.
select public.book_match(:'m2', 'Hall', 'Court 5 & Court 6', 'Gate A', 90);
reset role;
select pg_temp.check((select court_count from public.matches where id = :'m2') = 2, 'details edit keeps courts');
set role authenticated;

-- Subscriptions are private, and a user can only delete their own.
set role authenticated;
select pg_temp.check(pg_temp.fails('select * from public.push_subscriptions') like '%permission denied%', 'subscriptions closed');
select pg_temp.check(pg_temp.fails('select * from public.notifications') like '%permission denied%', 'outbox closed');
select pg_temp.as_user('eve');
select public.delete_push_subscription('https://push.example/org');
reset role;
select pg_temp.check(exists (select 1 from public.push_subscriptions where endpoint = 'https://push.example/org'), 'cannot delete others');
set role anon;
select pg_temp.check(pg_temp.fails($$select public.save_push_subscription('https://x', 'k', 'a', 'ua')$$) like '%permission denied%', 'anon cannot subscribe');
reset role;

\o
\echo PUSH CHECKS PASSED
