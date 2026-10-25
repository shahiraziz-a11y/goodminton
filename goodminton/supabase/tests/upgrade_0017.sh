#!/usr/bin/env bash
# Upgrading a live database to 0017 (groups). Builds data the old way (0001-0016), runs 0017
# twice, and checks that everyone still sees what they saw before: the same matches on Home,
# the same balances, and at least the same games on the leaderboard.
set -euo pipefail
cd "$(dirname "$0")"
DB=goodminton_upgrade17_$$
psql -X -q "$@" -c "create database $DB" >/dev/null
trap 'psql -X -q "$@" -c "drop database $DB" >/dev/null' EXIT
P=(psql -X -q -v ON_ERROR_STOP=1 "$@" -d "$DB")
"${P[@]}" -c "do \$\$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end \$\$" >/dev/null
"${P[@]}" -f auth_stub.sql >/dev/null
for f in ../migrations/00*.sql; do
  n=$(basename "$f"); n=$((10#${n%%_*}))
  [ "$n" -lt 17 ] || continue
  "${P[@]}" -f "$f" >/dev/null 2>&1
done

"${P[@]}" <<'SQL'
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null
create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email = u || '@up17.test'), ''), false); end $$;
create function pg_temp.mid(t text) returns uuid language sql security definer as $$ select id from public.matches where title = t $$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@up17.test', jsonb_build_object('full_name', initcap(n))
from unnest(array['org','ann','ben','cat','dan','eve','solo']) n;

-- Two matches by org, one by ann; a guest; a booked court with a cost; games in and outside matches.
set role authenticated;
select pg_temp.as_user('org');
select public.create_match('M1', 'doubles', 1, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6);
select pg_temp.as_user(u), public.join_match(pg_temp.mid('M1')) from unnest(array['ann','ben']) u;
select pg_temp.as_user('ann'); select public.add_player(pg_temp.mid('M1'), null, 'Guest G');
select pg_temp.as_user('org'); select public.book_court(pg_temp.mid('M1'), 1, 'Hall', 'Court 3', '', 160);
select pg_temp.as_user('ann');
select public.create_match('M2', 'doubles', 1, 'Hall', (now() + interval '4 days')::date, '20:00', 'Asia/Dubai', 90, 6);
select pg_temp.as_user(u), public.join_match(pg_temp.mid('M2')) from unnest(array['cat','dan']) u;
reset role;
select string_agg(id::text, ',' order by array_position(array['ann','cat','dan','org'], split_part(email, '@', 1))) as ids
  from public.profiles where email in ('ann@up17.test', 'cat@up17.test', 'dan@up17.test', 'org@up17.test') \gset
set role authenticated;
select pg_temp.as_user('ann');
select public.log_game(null, x[1], x[2], x[3], x[4], 'a') from (select string_to_array(:'ids', ',')::uuid[] x) s;
reset role;

-- Snapshot what each person sees today.
create table before_view as
select p.email, pg_temp.as_user(split_part(p.email, '@', 1)) is null as x,
       (select jsonb_agg(c ->> 'slug' order by c ->> 'slug') from jsonb_array_elements(public.my_matches()) c) as home,
       (select jsonb_agg(l - 'group_id' - 'group_name' order by l ->> 'id') from jsonb_array_elements(public.my_ledger()) l) as ledger,
       (select jsonb_agg(g ->> 'id') from jsonb_array_elements(public.get_leaderboard() -> 'games') g) as games
  from public.profiles p where not p.is_guest;
SQL

"${P[@]}" -f ../migrations/0017_groups.sql >/dev/null
"${P[@]}" -f ../migrations/0017_groups.sql >/dev/null  # safe to run twice

"${P[@]}" <<'SQL'
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null
create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email = u || '@up17.test'), ''), false); end $$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'FAILED: %', what; end if; end $$;

select pg_temp.check((select count(*) from public.groups) = 1, 'one starter group, even after running twice');
select pg_temp.check((select name from public.groups) = 'Goodminton crew', 'starter group name');
select pg_temp.check((select p.email from public.groups g join public.profiles p on p.id = g.owner_id) = 'org@up17.test', 'owner: who organised most');
select pg_temp.check((select count(*) from public.group_members) = (select count(*) from public.profiles), 'everyone (guests too) in it');
select pg_temp.check((select count(*) from public.group_members where role = 'owner') = 1, 'one owner');
select pg_temp.check(not exists (select 1 from public.matches where group_id is null) and not exists (select 1 from public.games where group_id is null), 'every match and game in it');

create table after_view as
select p.email, pg_temp.as_user(split_part(p.email, '@', 1)) is null as x,
       (select jsonb_agg(c ->> 'slug' order by c ->> 'slug') from jsonb_array_elements(public.my_matches()) c) as home,
       (select jsonb_agg(l - 'group_id' - 'group_name' order by l ->> 'id') from jsonb_array_elements(public.my_ledger()) l) as ledger,
       (select jsonb_agg(g ->> 'id') from jsonb_array_elements(public.get_leaderboard() -> 'games') g) as games
  from public.profiles p where not p.is_guest;

select pg_temp.check(not exists (select 1 from before_view b join after_view a using (email) where a.home is distinct from b.home), 'Home unchanged for everyone');
select pg_temp.check(not exists (select 1 from before_view b join after_view a using (email) where a.ledger is distinct from b.ledger), 'balances unchanged for everyone');
select pg_temp.check(not exists (select 1 from before_view b join after_view a using (email)
                                  where not coalesce(a.games, '[]') @> coalesce(b.games, '[]')), 'leaderboard keeps every game people saw');
\o
\echo UPGRADE 0017 CHECKS PASSED
SQL
