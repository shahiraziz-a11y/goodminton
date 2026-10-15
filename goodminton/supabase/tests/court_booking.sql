-- Booking courts one at a time: who can book, who gets locked in, and who pays.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email = u || '@courts.test'), ''), false);
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
create function pg_temp.court_of(slug text, u text) returns int language sql security definer as $$
  select mp.court from public.match_players mp join public.matches m on m.id = mp.match_id
    join public.profiles p on p.id = mp.user_id where m.slug = $1 and p.email = $2 || '@courts.test';
$$;
create function pg_temp.split_names(slug text) returns text language sql security definer as $$
  select string_agg(split_part(p.full_name, ' ', 1), ',' order by x.ord)
    from public.matches m, unnest(public.split_ids(m.id)) with ordinality x(id, ord) join public.profiles p on p.id = x.id
   where m.slug = $1;
$$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@courts.test', jsonb_build_object('full_name', initcap(n))
from unnest(array['org','ann','ben','cat','dan','eve','fay','gus','hal','ivy']) n;
select id as ann from public.profiles where email = 'ann@courts.test' \gset
select id as dan from public.profiles where email = 'dan@courts.test' \gset

-- Two courts planned. Court 1 fills first (org, ann, ben, cat), then court 2.
select pg_temp.as_user('org');
set role authenticated;
select public.create_match('Two courts', 'doubles', 2, '', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6) as slug \gset
reset role; select id as mid from public.matches where slug = :'slug' \gset
set role authenticated;
select pg_temp.as_user(u), public.join_match(:'mid') from unnest(array['ann','ben','cat','dan','eve','fay']) u;
select pg_temp.check(pg_temp.court_of(:'slug', 'cat') = 1 and pg_temp.court_of(:'slug', 'dan') = 2, 'courts fill in order');

-- Before booking: nothing charged, everyone free to drop out.
select public.get_match(:'slug') as v \gset
select pg_temp.check((:'v'::jsonb ->> 'split_ready') = 'false'
                 and (select bool_and(not (c ->> 'booked')::boolean) from jsonb_array_elements(:'v'::jsonb -> 'court_info') c), 'nothing booked yet');

-- Who can book: confirmed players, not the waitlist or outsiders.
select pg_temp.as_user('ivy');
select pg_temp.check(pg_temp.fails(format('select public.book_court(%L, 1, %L, %L, %L, 100)', :'mid', 'Hall', 'Court 3', '')) like '%Only players%', 'outsider cannot book');
select pg_temp.as_user('ann');
select pg_temp.check(pg_temp.fails(format('select public.book_court(%L, 3, %L, %L, %L, 100)', :'mid', 'Hall', 'Court 3', '')) like '%isn''t part%', 'no court 3');
select pg_temp.check(pg_temp.fails(format('select public.book_court(%L, 1, %L, %L, %L, 100)', :'mid', '', 'Court 3', '')) like '%venue%', 'venue needed');

-- Ann books court 1. Only court 1 is locked in; Ann pays for it.
select public.book_court(:'mid', 1, 'Al Quoz Sports Hall', 'Court 3', 'Gate B', 100);
reset role;
select pg_temp.check((select status from public.matches where id = :'mid') = 'booked', 'match shows a booking');
select pg_temp.check((select paid_by from public.expenses where match_id = :'mid') = :'ann', 'Ann paid court 1');
set role authenticated;
select pg_temp.as_user('ben');
select pg_temp.check(pg_temp.fails(format('select public.leave_match(%L)', :'mid')) like '%locked in%', 'court 1 locked');
select pg_temp.as_user('fay'); select public.leave_match(:'mid');
select pg_temp.as_user('fay'); select public.join_match(:'mid');

-- Split: only court 1's players share court 1, 25 each.
select pg_temp.check(pg_temp.split_names(:'slug') = 'Org,Ann,Ben,Cat', 'court 2 not charged for court 1');
select pg_temp.as_user('dan');
select public.get_match(:'slug') as v \gset
select pg_temp.check((:'v'::jsonb -> 'court_info' -> 0 ->> 'label') = 'Court 3' and (:'v'::jsonb -> 'court_info' -> 0 ->> 'booked_by_name') = 'Ann'
                 and (:'v'::jsonb -> 'court_info' -> 1 ->> 'booked') = 'false', 'court info');
select pg_temp.check((select string_agg(x ->> 'court', ',') from jsonb_array_elements(:'v'::jsonb -> 'players') x) = '1,1,1,1,2,2,2', 'players carry their court');

-- Only the booker or organiser changes a booking.
select pg_temp.check(pg_temp.fails(format('select public.book_court(%L, 1, %L, %L, %L, 120)', :'mid', 'Hall', 'Court 9', '')) like '%Only Ann or the organiser%', 'others cannot edit');
select pg_temp.check(pg_temp.fails(format('select public.cancel_court(%L, 1)', :'mid')) like '%Only Ann or the organiser%', 'others cannot cancel');

-- Court 2 has 3 players; Dan books it anyway. Everyone splits both courts.
select public.book_court(:'mid', 2, 'Al Quoz Sports Hall', 'Court 4', 'Gate B', 100);
select pg_temp.check(pg_temp.split_names(:'slug') = 'Org,Ann,Ben,Cat,Dan,Eve,Fay', 'seven share two courts');
reset role;
select pg_temp.check((select courts from public.matches where id = :'mid') = 'Court 3 & Court 4', 'both courts listed');
select pg_temp.check((select count(*) || '/' || sum(amount) from public.expenses where match_id = :'mid') = '2/200.00', 'one expense per court');
set role authenticated;

-- The open spot on booked court 2 takes the next joiner.
select pg_temp.as_user('gus'); select public.join_match(:'mid');
select pg_temp.check(pg_temp.court_of(:'slug', 'gus') = 2, 'joiner fills booked court');

-- Organiser removes Ben (court 1 booked): he owes until Hal takes the spot.
select pg_temp.as_user('org');
reset role; select id as ben from public.profiles where email = 'ben@courts.test' \gset
set role authenticated;
select public.remove_player(:'mid', :'ben') ->> 'still_owes' as o \gset
select pg_temp.check(:'o' = 'true', 'Ben still owes');
select pg_temp.as_user('hal'); select public.join_match(:'mid');
select pg_temp.check(pg_temp.court_of(:'slug', 'hal') = 1, 'Hal takes Ben''s spot on court 1');
select pg_temp.check(pg_temp.split_names(:'slug') not like '%Ben%', 'Ben cleared');

-- Cancelling court 2 unlocks its players and drops its cost.
select pg_temp.as_user('ann');
select pg_temp.check(pg_temp.fails(format('select public.cancel_court(%L, 2)', :'mid')) like '%Only Dan%', 'Ann cannot cancel Dan''s court');
select pg_temp.as_user('dan'); select public.cancel_court(:'mid', 2);
reset role;
select pg_temp.check((select sum(amount) from public.expenses where match_id = :'mid') = 100, 'court 2 cost gone');
set role authenticated;
select pg_temp.as_user('eve'); select public.leave_match(:'mid');

-- Dropping to one court: court 2's players go to the waitlist.
select pg_temp.as_user('dan'); select public.book_court(:'mid', 2, 'Al Quoz Sports Hall', 'Court 4', '', 100);
select pg_temp.as_user('org');
select public.update_match(:'mid', 'Two courts', 'doubles', 1, (now() + interval '3 days')::date, '20:00', 90, 6) as r \gset
select pg_temp.check((:'r'::jsonb ->> 'demoted') = '3', 'court 2 players moved to the waitlist');
reset role;
select pg_temp.check((select count(*) from public.match_courts where match_id = :'mid') = 1
                 and (select sum(amount) from public.expenses where match_id = :'mid') = 100, 'court 2 booking dropped');
select pg_temp.check((select count(*) from public.match_players where match_id = :'mid' and status = 'waitlist' and court is not null) = 0, 'waitlist has no court');
set role authenticated;

-- Home card counts booked courts.
select x ->> 'booked_courts' as bc from jsonb_array_elements(public.my_matches()) x where x ->> 'slug' = :'slug' \gset
select pg_temp.check(:'bc' = '1', 'home shows booked courts');

-- Permissions.
select pg_temp.check(pg_temp.fails('select * from public.match_courts') like '%permission denied%', 'courts table closed');
reset role;
set role anon;
select pg_temp.check(pg_temp.fails(format('select public.book_court(%L, 1, %L, %L, %L, 1)', :'mid', 'H', 'C', '')) like '%permission denied%', 'anon cannot book');
reset role;

\o
\echo COURT BOOKING CHECKS PASSED
