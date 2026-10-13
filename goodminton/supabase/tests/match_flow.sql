-- Run against a scratch database (see run.sh). Raises on the first failed check.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email = u || '@gmail.com'), ''), false);
end $$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
end $$;

-- Expects the statement to raise; returns the message.
create function pg_temp.fails(sql text) returns text language plpgsql as $$
begin
  execute sql;
  raise exception 'FAILED: expected error from %', sql;
exception when others then
  if sqlerrm like 'FAILED:%' then raise; end if;
  return sqlerrm;
end $$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@gmail.com', jsonb_build_object('full_name', initcap(n) || ' Test')
from unnest(array['rohan','priya','samir','meera','dev','aisha','jon','kabir','nina']) n;

select pg_temp.check((select count(*) from public.profiles) = 9, 'profiles created by trigger');
select pg_temp.check((select full_name from public.profiles where email = 'rohan@gmail.com') = 'Rohan Test', 'name from Google metadata');

-- Organiser creates a 4-player match tomorrow.
select pg_temp.as_user('rohan');
set role authenticated;
select public.create_match('Thursday Night Doubles', 'doubles', 1, 'Al Quoz Sports Hall',
  (now() + interval '2 days')::date, '20:00', 'Asia/Dubai', 90, 6) as slug \gset
reset role;
\echo created :slug
select id as mid from public.matches where slug = :'slug' \gset

select pg_temp.check(:'slug' like 'thursday-night-doubles-%', 'slug from title');
select pg_temp.check((select count(*) from public.match_players where match_id = :'mid') = 1, 'organiser is player 1');
select pg_temp.check((select count(*) from public.expenses where match_id = :'mid') = 0 and (select status from public.matches where id = :'mid') = 'planning', 'plan: no cost until booked');
select pg_temp.check((select to_char(starts_at at time zone 'Asia/Dubai', 'HH24:MI') from public.matches where id = :'mid') = '20:00', 'start time in venue tz');

-- Signed out, spots open: names visible, court number and costs hidden.
select pg_temp.as_user('');
set role anon;
select public.get_match(:'slug') as v \gset
reset role;
select pg_temp.check((:'v'::jsonb -> 'viewer' ->> 'role') = 'anon', 'anon role');
select pg_temp.check((:'v'::jsonb ->> 'courts') is null, 'anon: court hidden');
select pg_temp.check((:'v'::jsonb -> 'expenses') = 'null'::jsonb, 'anon: costs hidden');
select pg_temp.check((:'v'::jsonb -> 'players' -> 0 ->> 'full_name') = 'Rohan Test', 'anon: names visible while open');

-- Three friends join; the third fills it.
set role authenticated;
select pg_temp.as_user('priya');  select public.join_match(:'mid') ->> 'status' as s \gset
select pg_temp.check(:'s' = 'confirmed', 'priya confirmed');
select pg_temp.as_user('samir');  select public.join_match(:'mid') ->> 'filled' as f \gset
select pg_temp.check(:'f' = 'false', 'not filled at 3');
select pg_temp.as_user('meera');  select public.join_match(:'mid') as j \gset
select pg_temp.check((:'j'::jsonb ->> 'filled') = 'true', 'filled at 4');
select pg_temp.check(pg_temp.fails(format('select public.join_match(%L)', :'mid')) like '%already%', 'no double join');

-- Fifth goes on the waitlist and sees nothing private.
select pg_temp.as_user('dev');    select public.join_match(:'mid') as j \gset
select pg_temp.check((:'j'::jsonb ->> 'status') = 'waitlist' and (:'j'::jsonb ->> 'position') = '1', 'dev waitlist #1');
select public.get_match(:'slug') as v \gset
select pg_temp.check((:'v'::jsonb -> 'viewer' ->> 'wait_pos') = '1', 'dev sees position');
select pg_temp.check((:'v'::jsonb -> 'players' -> 0 ->> 'hidden') = 'true', 'waitlist: names hidden');
select pg_temp.check((:'v'::jsonb ->> 'courts') is null, 'waitlist: court hidden');
select pg_temp.check((:'v'::jsonb -> 'waitlist') = 'null'::jsonb, 'waitlist: no waitlist names');

-- Outsider on a full match: names hidden too.
select pg_temp.as_user('aisha');  select public.get_match(:'slug') as v \gset
select pg_temp.check((:'v'::jsonb -> 'viewer' ->> 'role') = 'outsider', 'outsider role');
select pg_temp.check((:'v'::jsonb -> 'players' -> 1 ->> 'hidden') = 'true', 'outsider on full match: names hidden');

-- Confirmed player sees everything except waitlist names.
select pg_temp.as_user('samir');  select public.get_match(:'slug') as v \gset
select pg_temp.check((:'v'::jsonb ->> 'courts') = '', 'confirmed: courts visible (empty until booked)');
select pg_temp.check((:'v'::jsonb -> 'expenses') = '[]'::jsonb, 'confirmed: expenses visible');
select pg_temp.check((:'v'::jsonb -> 'waitlist') = 'null'::jsonb, 'confirmed: waitlist names hidden');

-- Organiser sees waitlist names.
select pg_temp.as_user('rohan');  select public.get_match(:'slug') as v \gset
select pg_temp.check((:'v'::jsonb -> 'waitlist' -> 0 ->> 'full_name') = 'Dev Test', 'organiser sees waitlist');

-- Priya drops out; Dev is promoted to the back of the order.
select pg_temp.as_user('priya');  select public.leave_match(:'mid') ->> 'promoted' as p \gset
select pg_temp.check(:'p' = 'Dev Test', 'dev promoted');
select pg_temp.as_user('rohan');  select public.get_match(:'slug') as v \gset
select pg_temp.check((select string_agg(x ->> 'full_name', ',') from jsonb_array_elements(:'v'::jsonb -> 'players') x)
  = 'Rohan Test,Samir Test,Meera Test,Dev Test', 'court order after promotion');
select pg_temp.check((:'v'::jsonb -> 'players' -> 3 ->> 'promoted') = 'true', 'promoted flag');
select pg_temp.check(pg_temp.fails(format('select public.leave_match(%L)', :'mid')) like '%Organisers%', 'organiser cannot leave');

-- Lock / reopen.
select pg_temp.as_user('samir');
select pg_temp.check(pg_temp.fails(format('select public.set_lock(%L, true)', :'mid')) like '%Only the organiser%', 'only organiser locks');
select pg_temp.as_user('rohan');  select public.set_lock(:'mid', true);
select pg_temp.as_user('aisha');
select pg_temp.check(pg_temp.fails(format('select public.join_match(%L)', :'mid')) like '%closed%', 'locked: no joins');
select pg_temp.as_user('rohan');  select public.set_lock(:'mid', false);

-- Four on the waitlist -> second court.
select pg_temp.as_user('rohan');
select pg_temp.check(pg_temp.fails(format('select public.upgrade_match(%L)', :'mid')) like '%Need 4%', 'upgrade needs 4 waiting');
select pg_temp.as_user('aisha');  select public.join_match(:'mid');
select pg_temp.as_user('jon');    select public.join_match(:'mid');
select pg_temp.as_user('kabir');  select public.join_match(:'mid');
select pg_temp.as_user('nina');   select public.join_match(:'mid') ->> 'position' as p \gset
select pg_temp.check(:'p' = '4', 'nina waitlist #4');
select pg_temp.as_user('rohan');  select public.upgrade_match(:'mid');
reset role; select pg_temp.check((select size from public.matches where id = :'mid') = 8, 'size 8'); set role authenticated;
reset role; select pg_temp.check((select court_count from public.matches where id = :'mid') = 2, 'second court added'); set role authenticated;
reset role; select pg_temp.check((select count(*) from public.match_players where match_id = :'mid' and status = 'confirmed') = 8, '8 confirmed'); set role authenticated;
reset role; select pg_temp.check((select sum(amount) from public.expenses where match_id = :'mid') is null, 'no cost before booking'); set role authenticated;
select pg_temp.as_user('rohan'); select public.book_match(:'mid', 'Al Quoz Sports Hall', 'Court 3 & Court 4', 'Gate B', 180);
reset role; select pg_temp.check((select sum(amount) from public.expenses where match_id = :'mid') = 360 and (select status from public.matches where id = :'mid') = 'booked'
  and (select courts from public.matches where id = :'mid') = 'Court 3 & Court 4', 'booking adds both courts'); set role authenticated;
select public.get_match(:'slug') as v \gset
select pg_temp.check((select string_agg(split_part(x ->> 'full_name', ' ', 1), ',') from jsonb_array_elements(:'v'::jsonb -> 'players') x)
  = 'Rohan,Samir,Meera,Dev,Aisha,Jon,Kabir,Nina', 'court 2 is the old waitlist in order');

-- Expenses and settlements.
select pg_temp.as_user('priya');
select pg_temp.check(pg_temp.fails(format('select public.add_expense(%L, %L, 40)', :'mid', 'Shuttles')) like '%confirmed%', 'outsider cannot add expense');
select pg_temp.as_user('dev');    select public.add_expense(:'mid', 'Shuttles', 40);
reset role; select id as rohan from public.profiles where email = 'rohan@gmail.com' \gset
select id as samir from public.profiles where email = 'samir@gmail.com' \gset
set role authenticated;
select pg_temp.as_user('meera');
select pg_temp.check(pg_temp.fails(format('select public.set_settled(%L, %L, %L, 50)', :'mid', :'samir', :'rohan')) like '%involved%', 'bystander cannot settle');
select pg_temp.as_user('samir');  select public.set_settled(:'mid', :'samir', :'rohan', 50);
select pg_temp.as_user('rohan');  select public.set_settled(:'mid', :'samir', :'rohan', 50);
reset role; select pg_temp.check((select count(*) from public.settlements) = 1, 'settle is idempotent'); set role authenticated;
select pg_temp.as_user('samir');  select public.set_settled(:'mid', :'samir', :'rohan', null);
reset role; select pg_temp.check((select count(*) from public.settlements) = 0, 'unsettle'); set role authenticated;

-- Ledger and home lists.
select pg_temp.as_user('dev');    select public.my_ledger() as l \gset
select pg_temp.check(jsonb_array_length(:'l'::jsonb) = 1 and jsonb_array_length(:'l'::jsonb -> 0 -> 'expenses') = 2, 'ledger');
select pg_temp.as_user('priya');  select public.my_ledger() as l \gset
select pg_temp.check(jsonb_array_length(:'l'::jsonb) = 0, 'dropped player has no ledger');
select pg_temp.as_user('jon');    select public.my_matches() as h \gset
select pg_temp.check((:'h'::jsonb -> 0 ->> 'confirmed_count') = '8', 'home list');

-- Auto-lock: starts in 1 hour, RSVPs close 2h before -> already locked.
select pg_temp.as_user('rohan');
select public.create_match('Late one', 'doubles', 1, 'Hall', (now() at time zone 'UTC' + interval '1 hour')::date,
  (now() at time zone 'UTC' + interval '1 hour')::time, 'UTC', 60, 2) as slug2 \gset
select public.get_match(:'slug2') as v \gset
select pg_temp.check((:'v'::jsonb ->> 'locked') = 'true', 'auto-locks before start');
reset role; select pg_temp.check((select count(*) from public.expenses e join public.matches m on m.id = e.match_id where m.slug = :'slug2') = 0, 'no zero expense'); set role authenticated;
select pg_temp.as_user('aisha');
reset role; select id as mid2 from public.matches where slug = :'slug2' \gset
set role authenticated;
select pg_temp.check(pg_temp.fails(format('select public.join_match(%L)', :'mid2')) like '%closed%', 'auto-lock blocks joins');
select pg_temp.as_user('rohan');  select public.set_lock(:'mid2', false);
select pg_temp.as_user('aisha');  select public.join_match(:'mid2');

-- 8-player match derives the second court number.
select pg_temp.as_user('rohan');
select public.create_match('Big game', 'doubles', 2, '', (now() + interval '3 days')::date, '19:00', 'Asia/Dubai', 120, 24) as slug3 \gset
reset role; select id as mid3 from public.matches where slug = :'slug3' \gset
set role authenticated; select public.book_match(:'mid3', 'Hall', 'Court 5', '', 100);
reset role;
select pg_temp.check((select courts from public.matches where slug = :'slug3') = 'Court 5 & Court 6', '8-player courts');
select pg_temp.check((select amount from public.expenses e join public.matches m on m.id = e.match_id where m.slug = :'slug3') = 200, '2 courts cost');

-- Permissions: tables are closed, anon can only read a match.
set role authenticated;
select pg_temp.check(pg_temp.fails('select * from public.matches') like '%permission denied%', 'matches table closed');
select pg_temp.check(pg_temp.fails('select * from public.match_players') like '%permission denied%', 'players table closed');
select pg_temp.check((select count(*) from public.profiles) = 1, 'only own profile');
reset role;
set role anon;
select pg_temp.check(pg_temp.fails(format('select public.join_match(%L)', :'mid')) like '%permission denied%', 'anon cannot join');
reset role;

\echo ALL CHECKS PASSED
