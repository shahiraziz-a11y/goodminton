-- Editing matches, singles, and shares still owed after removal.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email = u || '@edit.test'), ''), false);
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
create function pg_temp.order_of(p_slug text, p_status text) returns text language sql security definer as $$
  select string_agg(p.full_name, ',' order by mp.seq) from public.match_players mp
    join public.profiles p on p.id = mp.user_id join public.matches m on m.id = mp.match_id
   where m.slug = p_slug and mp.status = p_status
$$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@edit.test', jsonb_build_object('full_name', initcap(n))
from unnest(array['olga','pat','quin','rita','sam','tom','uma']) n;
select id as olga from public.profiles where email = 'olga@edit.test' \gset
select id as pat from public.profiles where email = 'pat@edit.test' \gset
select id as quin from public.profiles where email = 'quin@edit.test' \gset
select id as rita from public.profiles where email = 'rita@edit.test' \gset

select pg_temp.as_user('olga');
set role authenticated;
select public.create_match('Edit me', 'doubles', 1, '', (now() + interval '5 days')::date, '18:00', 'Asia/Dubai', 60, 6) as slug \gset
reset role; select id as mid from public.matches where slug = :'slug' \gset
set role authenticated;
select pg_temp.as_user('pat');  select public.join_match(:'mid');
select pg_temp.as_user('quin'); select public.join_match(:'mid');
select pg_temp.as_user('rita'); select public.join_match(:'mid');
select pg_temp.as_user('sam');  select public.join_match(:'mid');
select pg_temp.as_user('tom');  select public.join_match(:'mid');

-- Only the organiser edits.
select pg_temp.as_user('pat');
select pg_temp.check(pg_temp.fails(format('select public.update_match(%L, %L, %L, 1, %L, %L, 60, 6)', :'mid', 'X', 'doubles', (now() + interval '5 days')::date, '18:00')) like '%Only the organiser%', 'only organiser edits');

-- Doubles -> singles on one court: 2 spots. Latest joiners (not the organiser) go to the front of the waitlist.
select pg_temp.as_user('olga');
select public.update_match(:'mid', 'Edit me', 'singles', 1, (now() + interval '6 days')::date, '19:30', 90, 24) as r \gset
select pg_temp.check((:'r'::jsonb ->> 'demoted') = '2', 'two moved to the waitlist');
select pg_temp.check(pg_temp.order_of(:'slug', 'confirmed') = 'Olga,Pat', 'organiser and first joiner stay');
select pg_temp.check(pg_temp.order_of(:'slug', 'waitlist') = 'Quin,Rita,Sam,Tom', 'moved players first in line, in join order');
reset role;
select pg_temp.check((select to_char(starts_at at time zone 'Asia/Dubai', 'HH24:MI') from public.matches where id = :'mid') = '19:30', 'time changed');
select pg_temp.check((select size || '/' || duration_min || '/' || rsvp_close_hours from public.matches where id = :'mid') = '2/90/24', 'size, duration, close changed');
set role authenticated;

-- Back to doubles on two courts: 8 spots, waitlist moves up.
select public.update_match(:'mid', 'Edit me', 'doubles', 2, (now() + interval '6 days')::date, '19:30', 90, 24) as r \gset
select pg_temp.check((:'r'::jsonb ->> 'promoted') = '4', 'waitlist promoted');
select pg_temp.check(pg_temp.order_of(:'slug', 'confirmed') = 'Olga,Pat,Quin,Rita,Sam,Tom', 'all six in, in order');

-- Booking two courts, then dropping to one: courts text and cost follow.
select public.book_match(:'mid', 'Hall', 'Court 7', '', 100);
reset role;
select pg_temp.check((select courts from public.matches where id = :'mid') = 'Court 7 & Court 8', 'second court numbered');
select pg_temp.check((select sum(amount) from public.expenses where match_id = :'mid') = 200, '2 courts charged');
set role authenticated;
select public.update_match(:'mid', 'Edit me', 'doubles', 1, (now() + interval '6 days')::date, '19:30', 90, 24);
reset role;
select pg_temp.check((select courts from public.matches where id = :'mid') = 'Court 7', 'court text trimmed');
select pg_temp.check((select sum(amount) from public.expenses where match_id = :'mid') = 100
                 and (select count(*) from public.expenses where match_id = :'mid') = 1, 'one court charged, one expense row');
set role authenticated;
-- Editing the booking cost updates the expense.
select public.book_match(:'mid', 'Hall', 'Court 7', '', 140);
reset role;
select pg_temp.check((select amount from public.expenses where match_id = :'mid') = 140, 'cost edited');
set role authenticated;

-- Removed after booking. Confirmed: Olga, Pat, Quin, Rita. Waiting: Sam, Tom.
-- Replaced straight away from the waitlist: no debt.
select public.remove_player(:'mid', :'quin') as r \gset
select pg_temp.check((:'r'::jsonb ->> 'still_owes') = 'false' and (:'r'::jsonb ->> 'promoted') = 'Sam', 'replaced by Sam, Quin owes nothing');
select pg_temp.check(pg_temp.order_of(:'slug', 'confirmed') = 'Olga,Pat,Rita,Sam', 'Sam took the spot');
select public.remove_player(:'mid', :'pat') ->> 'still_owes' as o \gset
select pg_temp.check(:'o' = 'false', 'Pat replaced by Tom');
-- Waitlist empty now: Rita's spot stays empty, so she owes.
select public.remove_player(:'mid', :'rita') as r \gset
select pg_temp.check((:'r'::jsonb ->> 'still_owes') = 'true', 'no replacement, Rita still owes');
select public.get_match(:'slug') as v \gset
select pg_temp.check(jsonb_array_length(:'v'::jsonb -> 'split_ids') = 4
                 and jsonb_array_length(:'v'::jsonb -> 'liable') = 1
                 and (:'v'::jsonb -> 'liable' -> 0 ->> 'full_name') = 'Rita', 'split: 3 players plus Rita');
select pg_temp.as_user('rita');
select pg_temp.check(not exists (select 1 from jsonb_array_elements(public.my_ledger()) x where x ->> 'id' = :'mid'), 'nothing owed before sign-ups close');
reset role; update public.matches set lock_state = 'locked' where id = :'mid'; set role authenticated;
select public.my_ledger() as l \gset
select pg_temp.check(exists (select 1 from jsonb_array_elements(:'l'::jsonb) x where x ->> 'id' = :'mid'), 'Rita sees what she owes');
reset role; update public.matches set lock_state = 'auto' where id = :'mid'; set role authenticated;
select pg_temp.check(pg_temp.fails(format('select public.waive_share(%L, %L)', :'mid', :'rita')) like '%Only the organiser%', 'only organiser waives');
-- A later joiner takes the empty spot: Rita is cleared.
select pg_temp.as_user('uma'); select public.join_match(:'mid');
select pg_temp.as_user('olga');
select public.get_match(:'slug') as v \gset
select pg_temp.check(jsonb_array_length(:'v'::jsonb -> 'liable') = 0 and jsonb_array_length(:'v'::jsonb -> 'split_ids') = 4, 'join cleared Rita');
-- Chain: the replacement is removed with nobody waiting, so Uma owes and Rita stays clear.
reset role; select id as uma from public.profiles where email = 'uma@edit.test' \gset
set role authenticated;
select public.remove_player(:'mid', :'uma');
select public.get_match(:'slug') as v \gset
select pg_temp.check((:'v'::jsonb -> 'liable' -> 0 ->> 'full_name') = 'Uma' and jsonb_array_length(:'v'::jsonb -> 'liable') = 1, 'latest removed owes');
-- Adding a court opens new spots; it doesn't clear Uma's debt.
select public.update_match(:'mid', 'Edit me', 'doubles', 2, (now() + interval '6 days')::date, '19:30', 90, 24);
select public.get_match(:'slug') as v \gset
select pg_temp.check((:'v'::jsonb -> 'liable' -> 0 ->> 'full_name') = 'Uma', 'new court spots are not replacements');
select public.update_match(:'mid', 'Edit me', 'doubles', 1, (now() + interval '6 days')::date, '19:30', 90, 24);
-- Waive.
select public.waive_share(:'mid', :'uma');
select public.get_match(:'slug') as v \gset
select pg_temp.check(jsonb_array_length(:'v'::jsonb -> 'liable') = 0, 'waived');
-- Removing someone before booking never creates a debt.
select public.create_match('Plan only', 'doubles', 1, '', (now() + interval '5 days')::date, '18:00', 'Asia/Dubai', 60, 6) as s2 \gset
reset role; select id as m2 from public.matches where slug = :'s2' \gset
set role authenticated;
select public.add_player(:'m2', :'pat', null);
select public.remove_player(:'m2', :'pat') ->> 'still_owes' as o \gset
select pg_temp.check(:'o' = 'false', 'no debt before booking');

-- Singles: 1v1 courts, results and pairs.
select public.create_match('Singles night', 'singles', 2, '', (now() + interval '5 days')::date, '18:00', 'Asia/Dubai', 60, 6) as s3 \gset
reset role; select id as m3, size as sz from public.matches where slug = :'s3' \gset
set role authenticated;
select pg_temp.check(:'sz' = '4', 'singles, 2 courts = 4 players');
select public.add_player(:'m3', id, null) from unnest(array[:'pat', :'quin', :'rita']::uuid[]) id;
select public.set_court_order(:'m3', array[:'pat', :'olga']::uuid[]);
select pg_temp.check(pg_temp.order_of(:'s3', 'confirmed') = 'Pat,Olga,Quin,Rita', 'singles court swap');
select pg_temp.check(pg_temp.fails(format('select public.set_court_order(%L, %L::uuid[])', :'m3', array[:'olga', :'quin'])) like '%same court%', 'singles courts are pairs of positions');
select public.log_game(:'m3', :'pat', null, :'olga', null, 'a');
select pg_temp.check(pg_temp.fails(format('select public.log_game(%L, %L, %L, %L, null, %L)', :'m3', :'pat', :'quin', :'olga', 'a')) like '%same number%', 'sides must match');
select public.get_leaderboard() as lb \gset
select pg_temp.check(exists (select 1 from jsonb_array_elements(:'lb'::jsonb -> 'games') g where jsonb_array_length(g -> 'a') = 1), 'singles game on leaderboard');
-- Another court opens once 2 are waiting on singles.
select public.add_player(:'m3', null, 'Walk-in ' || n) from generate_series(1, 2) n;
select public.upgrade_match(:'m3');
reset role;
select pg_temp.check((select court_count || '/' || size from public.matches where id = :'m3') = '3/6', 'third singles court');
set role authenticated;

reset role;
\o
\echo EDIT CHECKS PASSED
