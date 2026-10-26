-- Extra players (organiser lets waitlisted people play, rotating), and costs split only once sign-ups close.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email = u || '@xtra.test'), ''), false);
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
create function pg_temp.uid(u text) returns uuid language sql security definer as $$ select id from public.profiles where email = u || '@xtra.test' $$;
create function pg_temp.layout(p_match uuid) returns text language sql security definer as $$
  select string_agg(k || ':' || names, ' | ' order by k) from (
    select case when mp.status = 'waitlist' then 'w' else mp.court::text end as k,
           string_agg(split_part(p.email, '@', 1) || case when mp.extra then '*' else '' end, ',' order by mp.seq) as names
      from public.match_players mp join public.profiles p on p.id = mp.user_id
     where mp.match_id = p_match group by 1) x;
$$;
create function pg_temp.split(p_match uuid) returns text language sql security definer as $$
  select string_agg(split_part(p.email, '@', 1), ',' order by x.ord)
    from unnest(public.split_ids(p_match)) with ordinality x(id, ord) join public.profiles p on p.id = x.id;
$$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@xtra.test', jsonb_build_object('full_name', initcap(n))
from unnest(array['org','a','b','c','d','e','f','g','h','i']) n;

-- One doubles court: org, a, b, c in; d, e, f wait.
set role authenticated;
select pg_temp.as_user('org');
select public.create_match('Extras', 'doubles', 1, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6) as slug \gset
reset role; select id as mid from public.matches where slug = :'slug' \gset
set role authenticated;
select pg_temp.as_user(u), public.join_match(:'mid') from unnest(array['a','b','c','d','e','f']) u;
reset role;
select pg_temp.check(pg_temp.layout(:'mid') = '1:org,a,b,c | w:d,e,f', 'start');
set role authenticated;

-- Only the organiser lets people in.
select pg_temp.as_user('a');
select pg_temp.check(pg_temp.fails(format('select public.allow_extra(%L, %L)', :'mid', pg_temp.uid('d'))) like '%organiser%', 'only organiser');
select pg_temp.as_user('org');
select pg_temp.check(pg_temp.fails(format('select public.allow_extra(%L, %L)', :'mid', pg_temp.uid('a'))) like '%waitlist%', 'only from the waitlist');
select public.allow_extra(:'mid', pg_temp.uid('d')) as r \gset
select pg_temp.check((:'r'::jsonb ->> 'on_court')::int = 5, 'five on court');
select public.allow_extra(:'mid', pg_temp.uid('e'));
select pg_temp.check(pg_temp.fails(format('select public.allow_extra(%L, %L)', :'mid', pg_temp.uid('f'))) like '%already has 2 extra%', 'no third extra');
reset role;
select pg_temp.check(pg_temp.layout(:'mid') = '1:org,a,b,c,d*,e* | w:f', 'two extras, f still waits');
set role authenticated;

-- The match screen shows who's extra.
select public.get_match(:'slug') as v \gset
select pg_temp.check((select count(*) from jsonb_array_elements(:'v'::jsonb -> 'players') x where (x ->> 'extra')::boolean) = 2, 'extras flagged');

-- A regular drops out: the extra keeps playing, nobody is promoted, and they're no longer "extra".
select pg_temp.as_user('a'); select public.leave_match(:'mid');
reset role;
select pg_temp.check(pg_temp.layout(:'mid') = '1:org,b,c,d,e* | w:f', 'no promotion; one extra left');
set role authenticated;

-- Book the court: nothing is owed until sign-ups close.
select pg_temp.as_user('org'); select public.book_court(:'mid', 1, 'Hall', 'Court 5', '', 150);
select pg_temp.check((public.get_match(:'slug') ->> 'split_ready')::boolean = false, 'no split while sign-ups are open');
select pg_temp.as_user('d');
select pg_temp.check(jsonb_array_length(public.my_ledger()) = 0, 'nothing owed yet');
select public.add_expense(:'mid', 'Shuttles', 25);  -- costs can still be added
-- Lock now: the split appears, extras included.
select pg_temp.as_user('org'); select public.set_lock(:'mid', true);
select pg_temp.check((public.get_match(:'slug') ->> 'split_ready')::boolean, 'split once locked');
reset role;
select pg_temp.check(pg_temp.split(:'mid') = 'org,b,c,d,e', 'five share, extra included');
set role authenticated;
select pg_temp.as_user('e');
select pg_temp.check(jsonb_array_length(public.my_ledger()) = 1, 'the extra sees their share');

-- Reopening sign-ups hides the split again until the match starts.
select pg_temp.as_user('org'); select public.set_lock(:'mid', false);
select pg_temp.check((public.get_match(:'slug') ->> 'split_ready')::boolean = false, 'reopened: not split');
reset role;
update public.matches set starts_at = now() - interval '5 minutes' where id = :'mid';
select pg_temp.check(public.split_ready(:'mid'), 'started: split even if reopened');
set role authenticated;

-- Two courts: the organiser picks the court.
select pg_temp.as_user('org');
select public.create_match('Two courts', 'doubles', 2, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6) as slug2 \gset
reset role; select id as m2 from public.matches where slug = :'slug2' \gset
set role authenticated;
select pg_temp.as_user(u), public.join_match(:'m2') from unnest(array['a','b','c','d','e','f','g','h']) u;
select pg_temp.as_user('i'); select public.join_match(:'m2');
select pg_temp.as_user('org');
select pg_temp.check(pg_temp.fails(format('select public.allow_extra(%L, %L)', :'m2', pg_temp.uid('h'))) like '%Pick a court%', 'two courts: pick one');
select public.allow_extra(:'m2', pg_temp.uid('h'), 2);
reset role;
select pg_temp.check(pg_temp.layout(:'m2') = '1:org,a,b,c | 2:d,e,f,g,h* | w:i', 'extra on court 2');

-- Past and anon.
set role anon;
select pg_temp.check(pg_temp.fails(format('select public.allow_extra(%L, %L)', :'m2', pg_temp.uid('i'))) like '%permission denied%', 'anon cannot');
reset role;

\o
\echo EXTRAS CHECKS PASSED
