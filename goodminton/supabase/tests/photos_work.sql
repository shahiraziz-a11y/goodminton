-- Google photos, and work accounts kept out of groups and the app.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from public.profiles where email = u || case when u = 'wrk' then '@careem.com' else '@ph.test' end), ''), false);
end $$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
end $$;
create function pg_temp.fails(q text) returns text language plpgsql as $$
begin execute q; return ''; exception when others then return sqlerrm; end $$;
create function pg_temp.uid(u text) returns uuid language sql security definer as $$ select id from public.profiles where email = u || case when u = 'wrk' then '@careem.com' else '@ph.test' end $$;

insert into auth.users (id, email, raw_user_meta_data) values
  (gen_random_uuid(), 'org@ph.test', '{"full_name": "Org", "avatar_url": "https://lh3.example/org"}'),
  (gen_random_uuid(), 'ann@ph.test', '{"full_name": "Ann", "picture": "https://lh3.example/ann"}'),
  (gen_random_uuid(), 'out@ph.test', '{"full_name": "Out", "avatar_url": "https://lh3.example/out"}'),
  (gen_random_uuid(), 'wrk@careem.com', '{"full_name": "Worker", "avatar_url": "https://lh3.example/wrk"}');

select pg_temp.check((select avatar_url from public.profiles where id = pg_temp.uid('org')) = 'https://lh3.example/org', 'photo saved at sign-up');
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"avatar_url": "https://lh3.example/org2"}' where email = 'org@ph.test';
select pg_temp.check((select avatar_url from public.profiles where id = pg_temp.uid('org')) = 'https://lh3.example/org2', 'new photo on next sign-in');
update auth.users set raw_user_meta_data = raw_user_meta_data where email = 'ann@ph.test';
select pg_temp.check((select avatar_url from public.profiles where id = pg_temp.uid('ann')) = 'https://lh3.example/ann', '"picture" works too');

-- org's match: ann joins (so shares a group); out stays outside.
select pg_temp.as_user('org');
set role authenticated;
select public.create_match('Photo night', 'doubles', 1, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6) as slug \gset
reset role;
select id as mid, group_id as gid from public.matches where slug = :'slug' \gset
select pg_temp.as_user('ann'); set role authenticated; select public.join_match(:'mid'); reset role;

select pg_temp.as_user('org'); set role authenticated;
select public.people_photos() as ph \gset
reset role;
select pg_temp.check((:'ph'::jsonb ->> pg_temp.uid('ann')::text) = 'https://lh3.example/ann' and (:'ph'::jsonb ? pg_temp.uid('org')::text), 'my group''s photos');
select pg_temp.check(not (:'ph'::jsonb ? pg_temp.uid('out')::text), 'not strangers''');
select pg_temp.check(not has_function_privilege('anon', 'public.people_photos()', 'execute'), 'anon gets no photos');

-- Work account: a match place made before the block stays; groups don't take them.
insert into public.match_players (match_id, user_id, status) values (:'mid', pg_temp.uid('wrk'), 'confirmed');
select pg_temp.check(not exists (select 1 from public.group_members where user_id = pg_temp.uid('wrk')), 'never joins a group');
select pg_temp.check(exists (select 1 from public.match_players where user_id = pg_temp.uid('wrk')), 'old match place kept');
select pg_temp.as_user('org'); set role authenticated;
select public.my_players(:'gid') as mp \gset
reset role;
select pg_temp.check(:'mp'::text not like '%Worker%', 'not offered in Add player');
select pg_temp.as_user('wrk'); set role authenticated;
select pg_temp.check(pg_temp.fails('select public.create_match(''W'', ''doubles'', 1, ''Hall'', current_date + 3, ''20:00'', ''Asia/Dubai'', 90, 6)') like '%personal Google account%', 'work account can''t use the app');
reset role;
-- Upgrade: an old group membership is removed when the migration runs again.
alter table public.group_members disable trigger group_members_no_blocked;
insert into public.group_members (group_id, user_id) values (:'gid', pg_temp.uid('wrk'));
alter table public.group_members enable trigger group_members_no_blocked;
\i ../migrations/0022_photos_work_accounts.sql
\o /dev/null
select pg_temp.check(not exists (select 1 from public.group_members where user_id = pg_temp.uid('wrk')), 'upgrade removes them from groups');
select pg_temp.check(exists (select 1 from public.match_players where user_id = pg_temp.uid('wrk')), 'upgrade keeps their old match place');

\o
\echo PHOTOS AND WORK ACCOUNT CHECKS PASSED
