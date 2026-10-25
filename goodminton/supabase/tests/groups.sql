-- Groups: you see your groups' matches, games and people; nobody else's.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email = u || '@grp.test'), ''), false);
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
create function pg_temp.uid(u text) returns uuid language sql security definer as $$ select id from public.profiles where email = u || '@grp.test' $$;
create function pg_temp.mid(t text) returns uuid language sql security definer as $$ select id from public.matches where title = t $$;
create function pg_temp.slug(t text) returns text language sql security definer as $$ select slug from public.matches where title = t $$;
create function pg_temp.pid(n text) returns uuid language sql security definer as $$ select id from public.profiles where full_name = n $$;
create function pg_temp.code(g uuid) returns text language sql security definer as $$ select invite_code from public.groups where id = g $$;
create function pg_temp.home() returns text language sql as $$
  select coalesce(string_agg(x ->> 'title', ',' order by x ->> 'title'), '') from jsonb_array_elements(public.my_matches()) x
   where x ->> 'title' like 'G%';
$$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@grp.test', jsonb_build_object('full_name', initcap(n))
from unnest(array['tara','uma','vic','wes','xia','yan','zed']) n;

set role authenticated;

-- Tara makes "Tuesday crew"; Wes makes "Office". Codes are random and readable.
select pg_temp.as_user('tara');
select public.create_group('Tuesday crew') as tue \gset
select pg_temp.check(pg_temp.fails('select public.create_group(''  '')') like '%name%', 'group needs a name');
select pg_temp.as_user('wes');
select public.create_group('Office') as off \gset
reset role;
select pg_temp.check(pg_temp.code(:'tue') ~ '^[a-z2-9]{12}$' and pg_temp.code(:'tue') <> pg_temp.code(:'off'), 'invite codes');
select pg_temp.code(:'tue') as tue_code, pg_temp.code(:'off') as off_code \gset
set role authenticated;

-- Join by link. The preview works signed out too.
reset role; set role anon;
select public.group_preview(:'tue_code') as pv \gset
select pg_temp.check((:'pv'::jsonb ->> 'name') = 'Tuesday crew' and (:'pv'::jsonb ->> 'members')::int = 1 and (:'pv'::jsonb ->> 'owner') = 'Tara', 'preview for anyone with the link');
select pg_temp.check(pg_temp.fails('select public.get_group(''' || :'tue' || ''')') like '%permission denied%', 'anon cannot read a group');
reset role; set role authenticated;
select pg_temp.as_user('uma'); select public.join_group(upper(:'tue_code'));
select pg_temp.as_user('vic'); select public.join_group(:'tue_code');
select pg_temp.as_user('xia'); select public.join_group(:'off_code');
select pg_temp.as_user('vic'); select public.join_group(:'off_code');  -- Vic is in both
select pg_temp.check(pg_temp.fails('select public.join_group(''nope'')') like '%expired%', 'bad code');

-- Matches go in a group; you must be in it.
select pg_temp.as_user('tara');
select public.create_match('G Tue', 'doubles', 1, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6, 'AED', :'tue');
select pg_temp.check(pg_temp.fails(format('select public.create_match(%L, %L, 1, %L, %L, %L, %L, 90, 6, %L, %L)',
  'G Sneaky', 'doubles', 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 'AED', :'off')) like '%not in that group%', 'not in that group');
select pg_temp.as_user('wes');
select public.create_match('G Office', 'doubles', 1, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6, 'AED', :'off');

-- Home: your groups only. Vic sees both; Yan (no group) sees neither.
select pg_temp.as_user('uma');  select pg_temp.check(pg_temp.home() = 'G Tue', 'Uma: her group only');
select pg_temp.as_user('xia');  select pg_temp.check(pg_temp.home() = 'G Office', 'Xia: her group only');
select pg_temp.as_user('vic');  select pg_temp.check(pg_temp.home() = 'G Office,G Tue', 'Vic: both groups');
select pg_temp.as_user('yan');  select pg_temp.check(pg_temp.home() = '', 'Yan: nothing');
select pg_temp.check((select (x ->> 'group_name') from jsonb_array_elements(public.my_matches()) x limit 1) is null, 'no cards for Yan');

-- Yan opens a shared match link: sees the match, joins it, and is in Tuesday crew.
select public.get_match(pg_temp.slug('G Tue')) as v \gset
select pg_temp.check((:'v'::jsonb -> 'group' ->> 'name') = 'Tuesday crew' and not (:'v'::jsonb ->> 'is_member')::boolean, 'link shows the group');
select public.join_match(pg_temp.mid('G Tue'));
select pg_temp.check(pg_temp.home() = 'G Tue', 'joining a match joins its group');
select public.get_match(pg_temp.slug('G Tue')) as v \gset
select pg_temp.check((:'v'::jsonb ->> 'is_member')::boolean, 'now a member');

-- Adding people: only from the match's group; guests join it.
select pg_temp.as_user('tara');
select pg_temp.check(pg_temp.fails(format('select public.add_player(%L, %L, null)', pg_temp.mid('G Tue'), pg_temp.uid('xia'))) like '%in this group%', 'Xia is not in Tuesday crew');
select public.add_player(pg_temp.mid('G Tue'), pg_temp.uid('uma'), null);
select public.add_player(pg_temp.mid('G Tue'), null, 'Guest Gus');
reset role;
select pg_temp.check(public.is_member(:'tue', pg_temp.pid('Guest Gus')), 'guest joins the group');
set role authenticated;
select pg_temp.check((select count(*) from jsonb_array_elements(public.my_players(:'tue'))) = 5, 'Tuesday crew: Tara, Uma, Vic, Yan, Gus');
select pg_temp.check(not exists (select 1 from jsonb_array_elements(public.my_players(:'tue')) x where x ->> 'full_name' = 'Xia'), 'no outsiders in the picker');
select pg_temp.as_user('xia');
select pg_temp.check((select count(*) from jsonb_array_elements(public.my_players(:'tue'))) = 0, 'cannot list a group you are not in');

-- Games and the leaderboard, per group.
select pg_temp.as_user('tara');
select public.log_game(pg_temp.mid('G Tue'), pg_temp.uid('tara'), pg_temp.uid('uma'), pg_temp.uid('yan'),
  pg_temp.pid('Guest Gus'), 'a');
select pg_temp.as_user('vic');
select public.create_guest('Guest Hal', :'off') as hal \gset
select public.log_game(null, pg_temp.uid('vic'), pg_temp.uid('xia'), pg_temp.uid('wes'), :'hal', 'b', null, null, :'off');
select pg_temp.check(pg_temp.fails(format('select public.log_game(null, %L, %L, %L, %L, %L, null, null, %L)',
  pg_temp.uid('vic'), pg_temp.uid('xia'), pg_temp.uid('wes'), pg_temp.uid('tara'), 'a', :'off')) like '%must be in the group%', 'home game: everyone in the group');
select pg_temp.check(jsonb_array_length(public.get_leaderboard(:'tue') -> 'games') = 1
                 and jsonb_array_length(public.get_leaderboard(:'off') -> 'games') = 1, 'Vic: one game in each board');
select pg_temp.check((public.get_leaderboard(:'off') -> 'group' ->> 'name') = 'Office', 'board says which group');
select pg_temp.as_user('uma');
select pg_temp.check(jsonb_array_length(public.get_leaderboard(:'off') -> 'games') = 0, 'Uma cannot see Office');
select pg_temp.check((public.get_leaderboard() -> 'group' ->> 'name') = 'Tuesday crew', 'default board: the group you play in');

-- Group page: members only; owner manages.
select pg_temp.check((public.get_group(:'tue') ->> 'my_role') = 'member' and (public.get_group(:'tue') ->> 'invite_code') = :'tue_code', 'members see the invite');
select pg_temp.check(pg_temp.fails(format('select public.get_group(%L)', :'off')) like '%not found%', 'other groups hidden');
select pg_temp.check(pg_temp.fails(format('select public.rename_group(%L, %L)', :'tue', 'Mine')) like '%owner%', 'only owner renames');
select pg_temp.check(pg_temp.fails(format('select public.remove_member(%L, %L)', :'tue', pg_temp.uid('vic'))) like '%owner%', 'only owner removes');
select pg_temp.as_user('tara');
select public.rename_group(:'tue', 'Tuesday Smashers');
select public.reset_invite(:'tue') as new_code \gset
select pg_temp.check(:'new_code' <> :'tue_code', 'new code');
select pg_temp.as_user('zed');
select pg_temp.check(pg_temp.fails(format('select public.join_group(%L)', :'tue_code')) like '%expired%', 'old link stops working');
select public.join_group(:'new_code');
select pg_temp.check((select jsonb_array_length(public.my_groups())) = 1 and (public.my_groups() -> 0 ->> 'name') = 'Tuesday Smashers', 'my groups');

-- Removed: loses the group's matches, keeps matches they're in.
select pg_temp.as_user('tara');
select public.remove_member(:'tue', pg_temp.uid('zed'));
select public.remove_member(:'tue', pg_temp.uid('yan'));
select pg_temp.as_user('zed'); select pg_temp.check(pg_temp.home() = '', 'removed: group matches gone');
select pg_temp.as_user('yan'); select pg_temp.check(pg_temp.home() = 'G Tue', 'removed but playing: still sees that match');
select pg_temp.check(jsonb_array_length(public.get_leaderboard(:'tue') -> 'games') = 0, 'removed: no leaderboard');

-- Leaving and ownership.
select pg_temp.as_user('tara');
select pg_temp.check(pg_temp.fails(format('select public.leave_group(%L)', :'tue')) like '%owner%', 'owner cannot just leave');
select pg_temp.check(pg_temp.fails(format('select public.make_owner(%L, %L)', :'tue', pg_temp.uid('xia'))) like '%Pick someone%', 'new owner must be in it');
select public.make_owner(:'tue', pg_temp.uid('uma'));
select public.leave_group(:'tue');
select pg_temp.check(pg_temp.home() = 'G Tue', 'left the group, still organising its match');
select pg_temp.as_user('uma');
select pg_temp.check((public.get_group(:'tue') ->> 'my_role') = 'owner', 'Uma owns it now');

-- Someone with no group who creates a match gets their own group.
reset role;
insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'new@grp.test', '{"full_name": "Neo Newman"}');
set role authenticated;
select pg_temp.as_user('new');
select public.create_match('G Neo', 'doubles', 1, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6);
select pg_temp.check((public.my_groups() -> 0 ->> 'name') = 'Neo''s group' and (public.my_groups() -> 0 ->> 'my_role') = 'owner', 'first match makes a group');

-- Tables stay closed.
select pg_temp.check(pg_temp.fails('select * from public.groups') like '%permission denied%', 'groups table closed');
select pg_temp.check(pg_temp.fails('select * from public.group_members') like '%permission denied%', 'members table closed');
reset role;

\o
\echo GROUPS CHECKS PASSED
