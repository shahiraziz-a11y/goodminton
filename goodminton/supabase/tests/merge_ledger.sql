-- Merging a guest into the real account, and guests in the ledger.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from public.profiles where email = u || '@mg.test'), ''), false);
end $$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
end $$;
create function pg_temp.fails(q text) returns text language plpgsql as $$
begin execute q; return ''; exception when others then return sqlerrm; end $$;
create function pg_temp.uid(u text) returns uuid language sql security definer as $$ select id from public.profiles where email = u || '@mg.test' $$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@mg.test', jsonb_build_object('full_name', initcap(n))
from unnest(array['org','ann','ben','tej']) n;

-- org's match; ann adds "Tej" as a guest (the real Tej hasn't joined yet).
select pg_temp.as_user('org'); set role authenticated;
select public.create_match('Merge night', 'doubles', 1, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6) as slug \gset
reset role;
select id as mid, group_id as gid from public.matches where slug = :'slug' \gset
select pg_temp.as_user('ann'); set role authenticated;
select public.join_match(:'mid');
select public.add_player(:'mid', null, 'Tej');
reset role;
select id as guest from public.profiles where full_name = 'Tej' and is_guest and created_by = pg_temp.uid('ann') \gset
select pg_temp.as_user('ben'); set role authenticated; select public.join_match(:'mid'); reset role;

-- Court booked and paid by org; the split shows the guest billed to ann.
select pg_temp.as_user('org'); set role authenticated;
select public.book_court(:'mid', 1, 'Hall', 'Court 5', '', 120);
select public.set_lock(:'mid', true);
reset role;
select pg_temp.as_user('ann'); set role authenticated;
select x from jsonb_array_elements(public.my_ledger()) x where x ->> 'id' = :'mid' \gset
reset role;
select pg_temp.check((:'x'::jsonb -> 'guests' ->> :'guest') = pg_temp.uid('ann')::text, 'ledger: guest billed to ann');
select pg_temp.check((:'x'::jsonb -> 'people' ->> :'guest') = 'Tej', 'ledger: guest name');
-- ann marks the guest's share collected (a settlement from the guest to ann).
select pg_temp.as_user('ann'); set role authenticated;
select public.set_settled(:'mid', :'guest', pg_temp.uid('ann'), 30);
reset role;
-- A game with the guest; ann logged it.
select pg_temp.as_user('ann'); set role authenticated;
select public.log_game(:'mid', pg_temp.uid('ann'), :'guest', pg_temp.uid('ben'), pg_temp.uid('org'), 'b') as gm \gset
reset role;

-- The real Tej joins the group (another match) and gets merged.
select pg_temp.as_user('org'); set role authenticated;
select public.create_match('Next week', 'doubles', 1, 'Hall', (now() + interval '6 days')::date, '20:00', 'Asia/Dubai', 90, 6) as slug2 \gset
reset role;
select id as mid2 from public.matches where slug = :'slug2' \gset
select pg_temp.as_user('tej'); set role authenticated; select public.join_match(:'mid2'); reset role;

-- Only the group owner (or the guest's creator) can; only guests; not into a guest.
select pg_temp.as_user('ben'); set role authenticated;
select pg_temp.check(pg_temp.fails(format('select public.merge_player(%L, %L)', :'guest', pg_temp.uid('tej'))) like '%group owner%', 'not ben');
select pg_temp.as_user('org');
select pg_temp.check(pg_temp.fails(format('select public.merge_player(%L, %L)', pg_temp.uid('ben'), pg_temp.uid('tej'))) like '%Only a guest%', 'real accounts aren''t merged');
select pg_temp.check(pg_temp.fails(format('select public.merge_player(%L, %L)', pg_temp.uid('tej'), :'guest')) like '%Only a guest%', 'not the other way round');
reset role;

-- Same game clash is refused.
insert into public.games (created_by, played_on, a1, a2, b1, b2, winner, group_id)
values (pg_temp.uid('org'), current_date, :'guest', pg_temp.uid('ann'), pg_temp.uid('tej'), pg_temp.uid('ben'), 'a', :'gid') returning id as clash \gset
select pg_temp.as_user('org'); set role authenticated;
select pg_temp.check(pg_temp.fails(format('select public.merge_player(%L, %L)', :'guest', pg_temp.uid('tej'))) like '%same game 1 time%', 'same game clash');
reset role;
delete from public.games where id = :'clash';

-- Merge.
select pg_temp.as_user('org'); set role authenticated;
select public.merge_player(:'guest', pg_temp.uid('tej'));
reset role;
select pg_temp.check(not exists (select 1 from public.profiles where id = :'guest'), 'guest gone');
select pg_temp.check((select a2 from public.games where id = :'gm') = pg_temp.uid('tej'), 'game is Tej''s now');
select pg_temp.check(exists (select 1 from public.match_players where match_id = :'mid' and user_id = pg_temp.uid('tej') and added_by = pg_temp.uid('ann')), 'match place moved');
select pg_temp.check((select count(*) from public.group_members where group_id = :'gid' and user_id = pg_temp.uid('tej')) = 1, 'one group membership');
select pg_temp.check((select amount from public.settlements where match_id = :'mid' and from_user = pg_temp.uid('tej') and to_user = pg_temp.uid('ann')) = 30, 'settlement moved');
-- Tej now pays their own share: no longer billed to ann.
select pg_temp.as_user('ann'); set role authenticated;
select x from jsonb_array_elements(public.my_ledger()) x where x ->> 'id' = :'mid' \gset
reset role;
select pg_temp.check((:'x'::jsonb -> 'guests') = '{}'::jsonb and (:'x'::jsonb -> 'players') ? pg_temp.uid('tej')::text, 'Tej in the split as themselves');

-- In the same match twice: the real one's place is kept.
select pg_temp.as_user('ann'); set role authenticated;
select public.join_match(:'mid2');
select public.add_player(:'mid2', null, 'Tej 2');
reset role;
select id as guest2 from public.profiles where full_name = 'Tej 2' \gset
select pg_temp.as_user('ann'); set role authenticated;
select public.merge_player(:'guest2', pg_temp.uid('tej'));  -- ann created that guest
reset role;
select pg_temp.check((select count(*) from public.match_players where match_id = :'mid2' and user_id = pg_temp.uid('tej')) = 1, 'one place in the match');

\o
\echo MERGE AND LEDGER CHECKS PASSED
