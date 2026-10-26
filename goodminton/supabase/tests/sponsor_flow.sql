-- Anyone in a match adds players; guests are billed to whoever added them;
-- costs split only once the court is booked with a cost.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email = u || '@sponsor.test'), ''), false);
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
create function pg_temp.names(ids uuid[]) returns text language sql security definer as $$
  select string_agg(p.full_name, ',' order by x.ord) from unnest(ids) with ordinality x(id, ord) join public.profiles p on p.id = x.id
$$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@sponsor.test', jsonb_build_object('full_name', initcap(n))
from unnest(array['olly','ann','bob','cy']) n;
select id as olly from public.profiles where email = 'olly@sponsor.test' \gset
select id as ann from public.profiles where email = 'ann@sponsor.test' \gset
select id as bob from public.profiles where email = 'bob@sponsor.test' \gset
select id as cy from public.profiles where email = 'cy@sponsor.test' \gset

-- Any signed-in user can create a match and is its organiser.
select pg_temp.as_user('cy');
set role authenticated;
select public.create_match('Cy hosts', 'doubles', 1, '', (now() + interval '3 days')::date, '18:00', 'Asia/Dubai', 60, 6) as s0 \gset
select pg_temp.check((public.get_match(:'s0') -> 'viewer' ->> 'role') = 'organiser', 'creator is the organiser');

select pg_temp.as_user('olly');
select public.create_match('Sponsor test', 'doubles', 1, '', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6) as slug \gset
reset role; select id as mid from public.matches where slug = :'slug' \gset
set role authenticated;
select pg_temp.as_user('ann'); select public.join_match(:'mid');

-- Outsiders can't add; confirmed players can.
select pg_temp.as_user('bob');
select pg_temp.check(pg_temp.fails(format('select public.add_player(%L, null, %L)', :'mid', 'Raj')) like '%Join the match first%', 'outsider cannot add');
select pg_temp.as_user('ann');
select public.add_player(:'mid', null, 'Raj') ->> 'status' as s \gset
select pg_temp.check(:'s' = 'confirmed', 'ann added guest Raj');
reset role; select id as raj from public.profiles where full_name = 'Raj' and is_guest \gset
set role authenticated;
-- Ann adds Bob (a real user she knows from... a previous match).
select pg_temp.check(pg_temp.fails(format('select public.add_player(%L, %L, null)', :'mid', :'bob')) like '%in this group%', 'circle rule still applies');
select pg_temp.as_user('bob'); select public.join_match(:'mid');

-- Who pays for whom.
select pg_temp.as_user('ann');
select public.get_match(:'slug') as v \gset
select pg_temp.check((:'v'::jsonb -> 'billed_to' ->> :'raj') = :'ann', 'Raj billed to Ann');
select pg_temp.check((:'v'::jsonb -> 'added_by' ->> :'raj') = :'ann', 'added_by shown');
select pg_temp.check((:'v'::jsonb ->> 'split_ready') = 'false', 'no split before booking');
select pg_temp.check(pg_temp.names(array(select jsonb_array_elements_text(:'v'::jsonb -> 'split_ids'))::uuid[]) = 'Olly,Ann,Ann,Bob', 'Ann pays her share and Raj''s');

-- No costs before booking.
select pg_temp.check(pg_temp.fails(format('select public.add_expense(%L, %L, 40)', :'mid', 'Shuttles')) like '%once a court is booked%', 'no expenses before booking');
select public.my_ledger() as l \gset
select pg_temp.check(not exists (select 1 from jsonb_array_elements(:'l'::jsonb) x where x ->> 'id' = :'mid'), 'unbooked match not in balances');

-- Booked at 0 cost: still no split.
select pg_temp.as_user('olly');
select public.book_match(:'mid', 'Hall', 'Court 1', '', 0);
select pg_temp.as_user('ann');
select pg_temp.check(pg_temp.fails(format('select public.add_expense(%L, %L, 40)', :'mid', 'Shuttles')) like '%cost is entered%', 'no expenses until a cost is entered');

-- Cost entered: split starts; Ann carries two shares.
select pg_temp.as_user('olly');
select public.book_match(:'mid', 'Hall', 'Court 1', '', 120);
select pg_temp.as_user('ann');
select public.add_expense(:'mid', 'Shuttles', 40);
select pg_temp.check(not exists (select 1 from jsonb_array_elements(public.my_ledger()) x where x ->> 'id' = :'mid'), 'shared once sign-ups close');
select pg_temp.as_user('olly'); select public.set_lock(:'mid', true); select pg_temp.as_user('ann');
select public.my_ledger() as l \gset
select pg_temp.check((select pg_temp.names(array(select jsonb_array_elements_text(x -> 'players'))::uuid[]) from jsonb_array_elements(:'l'::jsonb) x where x ->> 'id' = :'mid') = 'Olly,Ann,Ann,Bob', 'ledger bills Raj to Ann');
select pg_temp.check(not (:'l'::jsonb::text like '%' || :'raj' || '%'), 'guest never appears in balances');

-- Removal: Bob can't remove Raj; Ann (who added him) can; Raj's debt stays with Ann.
select pg_temp.as_user('bob');
select pg_temp.check(pg_temp.fails(format('select public.remove_player(%L, %L)', :'mid', :'raj')) like '%whoever added them%', 'only adder or organiser removes');
select pg_temp.as_user('ann');
select public.remove_player(:'mid', :'raj') ->> 'still_owes' as o \gset
select pg_temp.check(:'o' = 'true', 'removed guest still owes (no replacement)');
select public.get_match(:'slug') as v \gset
select pg_temp.check(pg_temp.names(array(select jsonb_array_elements_text(:'v'::jsonb -> 'split_ids'))::uuid[]) = 'Olly,Ann,Bob,Ann', 'Raj''s share still billed to Ann');
select pg_temp.check(pg_temp.fails(format('select public.remove_player(%L, %L)', :'mid', :'olly')) like '%organiser can%', 'organiser cannot be removed');

reset role;
\o
\echo SPONSOR CHECKS PASSED
