#!/usr/bin/env bash
# Upgrading a live database to 0009 (courts booked one at a time).
# Builds data the old way (0001-0008), runs 0009, and checks nothing about
# money changes: every person's balance is identical before and after.
set -euo pipefail
cd "$(dirname "$0")"
DB=goodminton_upgrade_$$
psql -X -q "$@" -c "create database $DB" >/dev/null
trap 'psql -X -q "$@" -c "drop database $DB" >/dev/null' EXIT
P=(psql -X -q -v ON_ERROR_STOP=1 "$@" -d "$DB")
"${P[@]}" -c "do \$\$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end \$\$" >/dev/null
"${P[@]}" -f auth_stub.sql >/dev/null
for f in ../migrations/000[1-8]_*.sql; do "${P[@]}" -f "$f" >/dev/null 2>&1; done

"${P[@]}" <<'SQL'
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null
create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin perform set_config('request.jwt.claim.sub', (select id::text from auth.users where email = u || '@up.test'), false); end $$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'FAILED: %', what; end if; end $$;
create function pg_temp.uid(u text) returns uuid language sql security definer as $$ select id from public.profiles where email = u || '@up.test' $$;
create function pg_temp.slug(t text) returns text language sql security definer as $$ select slug from public.matches where title = t $$;
create function pg_temp.mid(t text) returns uuid language sql security definer as $$ select id from public.matches where title = t $$;
-- Each person's balance in each match: paid - shares + settlements.
create function pg_temp.balances() returns table (match_id uuid, user_id uuid, net numeric) language sql as $$
  with s as (select m.id, public.split_ids(m.id) ids,
                    (select coalesce(sum(amount), 0) from public.expenses e where e.match_id = m.id) total
               from public.matches m where m.status = 'booked' and m.court_cost > 0),
  people as (select id, unnest(ids) u from s union select match_id, paid_by from public.expenses
             union select match_id, from_user from public.settlements union select match_id, to_user from public.settlements)
  select p.id, p.u, round(
      (select coalesce(sum(amount), 0) from public.expenses e where e.match_id = p.id and e.paid_by = p.u)
    - (select total / greatest(cardinality(ids), 1) * (select count(*) from unnest(ids) x where x = p.u) from s where s.id = p.id)
    + (select coalesce(sum(amount), 0) from public.settlements t where t.match_id = p.id and t.from_user = p.u)
    - (select coalesce(sum(amount), 0) from public.settlements t where t.match_id = p.id and t.to_user = p.u), 2)
  from people p;
$$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@up.test', jsonb_build_object('full_name', initcap(n) || ' Up')
from unnest(array['org','a','b','c','d','e','f','g','h','x']) n;
set role authenticated;

-- Old 1: two courts booked together at 150 each; shuttles; a payment; a guest; a removal that still owes.
select pg_temp.as_user('org');
select public.create_match('Old two courts', 'doubles', 2, '', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6);
select pg_temp.as_user(u), public.join_match(pg_temp.mid('Old two courts')) from unnest(array['a','b','c','d','e','f']) u;
select pg_temp.as_user('a'); select public.add_player(pg_temp.mid('Old two courts'), null, 'Guest Raj');
select pg_temp.as_user('org'); select public.book_match(pg_temp.mid('Old two courts'), 'Hall', 'Court 3', 'Gate B', 150);
select pg_temp.as_user('b'); select public.add_expense(pg_temp.mid('Old two courts'), 'Shuttles', 48);
select pg_temp.as_user('c'); select public.set_settled(pg_temp.mid('Old two courts'), pg_temp.uid('c'),
                                                       pg_temp.uid('org'), 20);
select pg_temp.as_user('org'); select public.remove_player(pg_temp.mid('Old two courts'), pg_temp.uid('e'));
-- Old 2: a plan, nothing booked.
select public.create_match('Old plan', 'doubles', 1, '', (now() + interval '4 days')::date, '19:00', 'Asia/Dubai', 60, 6);
select pg_temp.as_user(u), public.join_match(pg_temp.mid('Old plan')) from unnest(array['g','h']) u;
-- Old 3: singles, two courts booked, plus a waitlist.
select pg_temp.as_user('org');
select public.create_match('Old singles', 'singles', 2, '', (now() + interval '5 days')::date, '18:00', 'Asia/Dubai', 60, 6);
select pg_temp.as_user(u), public.join_match(pg_temp.mid('Old singles')) from unnest(array['a','b','c','d']) u;
select pg_temp.as_user('org'); select public.book_match(pg_temp.mid('Old singles'), 'Club', 'Court 1 & Court 2', '', 40);
reset role;

create temp table before as select * from pg_temp.balances();
create temp table ledgers_before as
  select p.email, (select jsonb_agg(x ->> 'id' order by x ->> 'id') from jsonb_array_elements(
           (select public.my_ledger() from (select set_config('request.jwt.claim.sub', p.id::text, false)) s)) x) ids
    from public.profiles p where p.email like '%@up.test';

\i ../migrations/0009_book_courts_one_at_a_time.sql
set client_min_messages = warning;
\o /dev/null

-- Money: every balance identical.
select pg_temp.check((select count(*) from before) > 0, 'there were balances to compare');
select pg_temp.check(not exists (
  (select * from before except select * from pg_temp.balances())
  union all (select * from pg_temp.balances() except select * from before)), 'balances unchanged by the upgrade');
select pg_temp.check(not exists (
  select 1 from ledgers_before b join public.profiles p on p.email = b.email
   where b.ids is distinct from (select jsonb_agg(x ->> 'id' order by x ->> 'id') from jsonb_array_elements(
           (select public.my_ledger() from (select set_config('request.jwt.claim.sub', p.id::text, false)) s)) x)), 'everyone''s balances page lists the same matches');

-- Old 1: courts assigned in join order, both courts booked by the organiser, one charge per court.
select pg_temp.check((select string_agg(coalesce(court::text, 'w'), '' order by seq) from public.match_players
                       where match_id = pg_temp.mid('Old two courts')) = '1111222', 'old 1: seats');
select pg_temp.check((select string_agg(court || ':' || label || ':' || trim_scale(cost), ' ' order by court) from public.match_courts
                       where match_id = pg_temp.mid('Old two courts')) = '1:Court 3:150 2:Court 4:150', 'old 1: courts booked');
select pg_temp.check((select bool_and(booked_by = (select organiser_id from public.matches where id = pg_temp.mid('Old two courts'))) from public.match_courts
                       where match_id = pg_temp.mid('Old two courts')), 'old 1: organiser booked them');
select pg_temp.check((select string_agg(label || '=' || trim_scale(amount), ', ' order by label) from public.expenses
                       where match_id = pg_temp.mid('Old two courts')) = 'Court 3 booking=150, Court 4 booking=150, Shuttles=48', 'old 1: expenses');
select pg_temp.check((select count(*) from public.settlements where match_id = pg_temp.mid('Old two courts')) = 1, 'old 1: payment kept');
select pg_temp.check(cardinality(public.split_ids(pg_temp.mid('Old two courts'))) = 8, 'old 1: removed player still in the split');
-- Old 2: nothing booked, nobody locked.
select pg_temp.check((select status || '/' || courts from public.matches where id = pg_temp.mid('Old plan')) = 'planning/', 'old 2: still a plan');
select pg_temp.check((select count(*) from public.match_courts where match_id = pg_temp.mid('Old plan')) = 0, 'old 2: no bookings');
-- Old 3: singles, two per court, waitlist has no court.
select pg_temp.check((select string_agg(coalesce(court::text, 'w'), '' order by seq) from public.match_players
                       where match_id = pg_temp.mid('Old singles')) = '1122w', 'old 3: singles seats');
select pg_temp.check((select string_agg(label, ' & ' order by court) from public.match_courts where match_id = pg_temp.mid('Old singles')) = 'Court 1 & Court 2', 'old 3: both courts');

-- Works the new way afterwards.
set role authenticated;
select pg_temp.as_user('g'); select public.leave_match(pg_temp.mid('Old plan'));
select pg_temp.as_user('a');
select pg_temp.check((public.get_match(pg_temp.slug('Old two courts')) ->> 'split_ready')::boolean, 'old 1: split still on');
do $$ begin perform public.leave_match(pg_temp.mid('Old two courts')); raise exception 'FAILED: booked player left';
exception when others then if sqlerrm like 'FAILED%' then raise; end if; end $$;
select pg_temp.as_user('x'); select public.join_match(pg_temp.mid('Old two courts'));
reset role;
select pg_temp.check((select count(*) from public.match_liable l where l.match_id = pg_temp.mid('Old two courts')
                       and l.user_id = any (public.share_holders(l.match_id))) = 0, 'old 1: new joiner clears the debt');
\o
\echo UPGRADE 0009 CHECKS PASSED
SQL
