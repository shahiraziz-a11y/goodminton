-- The organiser drops out of their own match but keeps running it.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email = u || '@org.test'), ''), false);
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
create function pg_temp.uid(u text) returns uuid language sql security definer as $$ select id from public.profiles where email = u || '@org.test' $$;
create function pg_temp.mid(t text) returns uuid language sql security definer as $$ select id from public.matches where title = t $$;
create function pg_temp.slug(t text) returns text language sql security definer as $$ select slug from public.matches where title = t $$;
create function pg_temp.layout(t text) returns text language sql security definer as $$
  select string_agg(k || ':' || names, ' | ' order by k) from (
    select coalesce(mp.court::text, 'w') as k, string_agg(split_part(p.email, '@', 1), ',' order by mp.seq) as names
      from public.match_players mp join public.profiles p on p.id = mp.user_id join public.matches m on m.id = mp.match_id
     where m.title = t group by 1) x;
$$;
create function pg_temp.split(t text) returns text language sql security definer as $$
  select coalesce(string_agg(split_part(p.email, '@', 1), ',' order by x.ord), '')
    from public.matches m, unnest(public.split_ids(m.id)) with ordinality x(id, ord) join public.profiles p on p.id = x.id
   where m.title = t;
$$;
create function pg_temp.alerts(u text) returns text language sql security definer as $$
  select coalesce(string_agg(kind, ',' order by created_at), '') from public.notifications where user_id = (select id from public.profiles where email = u || '@org.test');
$$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@org.test', jsonb_build_object('full_name', initcap(n) || ' Org')
from unnest(array['org','a','b','c','d','e','x']) n;
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
select id, 'https://push.example/' || id, 'k', 'a' from public.profiles where email like '%@org.test';
set role authenticated;

-- Before booking: the organiser steps out and the first in line takes the spot.
select pg_temp.as_user('org');
select public.create_match('Run it', 'doubles', 1, '', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6);
select pg_temp.as_user(u), public.join_match(pg_temp.mid('Run it')) from unnest(array['a','b','c','d']) u;
select pg_temp.check(pg_temp.layout('Run it') = '1:org,a,b,c | w:d', 'full, Dan waiting');
reset role; delete from public.notifications; set role authenticated;
select pg_temp.as_user('org');
select public.leave_match(pg_temp.mid('Run it')) as r \gset
select pg_temp.check((:'r'::jsonb ->> 'promoted') = 'D Org' and (:'r'::jsonb ->> 'still_owes') = 'false', 'Dan promoted, organiser owes nothing');
select pg_temp.check(pg_temp.layout('Run it') = '1:a,b,c,d', 'organiser off the court');
select pg_temp.check(pg_temp.alerts('d') = 'promoted' and pg_temp.alerts('org') = '', 'Dan told; organiser not told about own action');

-- Still the organiser: sees everything, is told they're not playing.
select public.get_match(pg_temp.slug('Run it')) as v \gset
select pg_temp.check((:'v'::jsonb -> 'viewer' ->> 'role') = 'organiser' and (:'v'::jsonb -> 'viewer' ->> 'status') is null, 'organiser, not playing');
select pg_temp.check((:'v'::jsonb ->> 'courts') is not null and (:'v'::jsonb -> 'expenses') is not null, 'organiser still sees private details');
select x ->> 'my_role' as r from jsonb_array_elements(public.my_matches()) x where x ->> 'slug' = pg_temp.slug('Run it') \gset
select pg_temp.check(:'r' = 'organiser', 'still on the organiser''s home page');

-- Still runs it: books, edits, locks, adds and removes players.
select public.book_court(pg_temp.mid('Run it'), 1, 'Hall', 'Court 3', '', 100);
select pg_temp.check(pg_temp.split('Run it') = 'a,b,c,d', 'four players share; organiser does not');
reset role; update public.matches set lock_state = 'locked' where id = pg_temp.mid('Run it'); set role authenticated;
select public.my_ledger() as l \gset
select pg_temp.check(exists (select 1 from jsonb_array_elements(:'l'::jsonb) x where x ->> 'id' = pg_temp.mid('Run it')::text), 'organiser sees what they''re owed (once locked)');
reset role; update public.matches set lock_state = 'auto' where id = pg_temp.mid('Run it'); set role authenticated;
select public.update_match(pg_temp.mid('Run it'), 'Run it', 'doubles', 1, (now() + interval '3 days')::date, '21:00', 90, 6);
select public.set_lock(pg_temp.mid('Run it'), true);
select public.add_player(pg_temp.mid('Run it'), null, 'Walk In');
select public.remove_player(pg_temp.mid('Run it'), pg_temp.uid('a')) ->> 'promoted' as p \gset
select pg_temp.check(:'p' = 'Walk In', 'organiser removes and the waitlist moves up');
reset role;
select pg_temp.check((select count(*) from public.match_players where match_id = pg_temp.mid('Run it') and status = 'confirmed') = 4, 'four still playing');
set role authenticated;

-- Players on the booked court are still locked in.
select pg_temp.as_user('b');
select pg_temp.check(pg_temp.fails(format('select public.leave_match(%L)', pg_temp.mid('Run it'))) like '%locked in%', 'players still locked in');
-- Others can't remove the organiser, and the organiser can't remove themselves this way.
select pg_temp.check(pg_temp.fails(format('select public.remove_player(%L, %L)', pg_temp.mid('Run it'), pg_temp.uid('org'))) like '%organiser can''t be removed%', 'organiser cannot be removed');

-- Back in: sign-ups are locked, but the organiser can still rejoin (waitlist when full).
select pg_temp.as_user('x');
select pg_temp.check(pg_temp.fails(format('select public.join_match(%L)', pg_temp.mid('Run it'))) like '%closed%', 'others blocked when locked');
select pg_temp.as_user('org');
select public.join_match(pg_temp.mid('Run it')) ->> 'status' as s \gset
select pg_temp.check(:'s' = 'waitlist', 'organiser rejoins the waitlist');
select public.get_match(pg_temp.slug('Run it')) -> 'viewer' ->> 'status' as s \gset
select pg_temp.check(:'s' = 'waitlist', 'organiser shown as waiting');
select public.leave_match(pg_temp.mid('Run it'));

-- After booking, on the court: the organiser can still step out, but owes their share
-- until someone takes the spot (like a removed player).
select public.create_match('Booked first', 'doubles', 1, '', (now() + interval '4 days')::date, '20:00', 'Asia/Dubai', 90, 6);
select pg_temp.as_user(u), public.join_match(pg_temp.mid('Booked first')) from unnest(array['a','b','c']) u;
select pg_temp.as_user('a'); select public.book_court(pg_temp.mid('Booked first'), 1, 'Hall', 'Court 1', '', 80);
select pg_temp.as_user('org');
select public.leave_match(pg_temp.mid('Booked first')) ->> 'still_owes' as o \gset
select pg_temp.check(:'o' = 'true', 'organiser owes for the booked spot');
select pg_temp.check(pg_temp.split('Booked first') = 'a,b,c,org', 'organiser still in the split');
select public.get_match(pg_temp.slug('Booked first')) as v \gset
select pg_temp.check((:'v'::jsonb -> 'liable' -> 0 ->> 'full_name') = 'Org Org', 'listed as still owing');
select pg_temp.as_user('e'); select public.join_match(pg_temp.mid('Booked first'));
select pg_temp.check(pg_temp.split('Booked first') = 'a,b,c,e', 'Eva takes the spot; organiser cleared');
-- The organiser can waive their own share if nobody comes (the others split it).
select pg_temp.as_user('org');
select public.create_match('Waive', 'doubles', 1, '', (now() + interval '4 days')::date, '20:00', 'Asia/Dubai', 90, 6);
select pg_temp.as_user(u), public.join_match(pg_temp.mid('Waive')) from unnest(array['a','b','c']) u;
select pg_temp.as_user('org'); select public.book_court(pg_temp.mid('Waive'), 1, 'Hall', 'Court 1', '', 80);
select public.leave_match(pg_temp.mid('Waive'));
select public.waive_share(pg_temp.mid('Waive'), pg_temp.uid('org'));
select pg_temp.check(pg_temp.split('Waive') = 'a,b,c', 'three share after waiving');

-- Changing courts with the organiser out: nothing breaks.
select public.update_match(pg_temp.mid('Waive'), 'Waive', 'doubles', 2, (now() + interval '4 days')::date, '20:00', 90, 6);
select public.join_match(pg_temp.mid('Waive')) ->> 'status' as s \gset
select pg_temp.check(:'s' = 'confirmed' and pg_temp.layout('Waive') = '1:a,b,c,org', 'organiser rejoins into the open spot');

reset role;
\o
\echo ORGANISER DROP-OUT CHECKS PASSED
