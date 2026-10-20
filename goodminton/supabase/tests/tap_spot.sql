-- Tapping an open spot on a court joins that court.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email = u || '@tap.test'), ''), false);
end $$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
end $$;
create function pg_temp.layout(p_match uuid) returns text language sql security definer as $$
  select string_agg(k || ':' || names, ' | ' order by k) from (
    select coalesce(mp.court::text, 'w') as k, string_agg(split_part(p.email, '@', 1), ',' order by mp.seq) as names
      from public.match_players mp join public.profiles p on p.id = mp.user_id
     where mp.match_id = p_match group by 1) x;
$$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@tap.test', jsonb_build_object('full_name', initcap(n))
from unnest(array['org','ann','ben','cat','dan','eve','fay','gus','hal']) n;

-- Two courts of doubles; the organiser is on court 1.
select pg_temp.as_user('org');
set role authenticated;
select public.create_match('Tap night', 'doubles', 2, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6) as slug \gset
reset role;
select id as mid from public.matches where slug = :'slug' \gset
set role authenticated;

-- Ann taps a spot on court 2; Ben joins without picking and fills court 1.
select pg_temp.as_user('ann'); select public.join_match(:'mid', 2) as j \gset
select pg_temp.check((:'j'::jsonb ->> 'court')::int = 2 and (:'j'::jsonb ->> 'status') = 'confirmed', 'ann on the court she tapped');
select pg_temp.as_user('ben'); select public.join_match(:'mid');
reset role;
select pg_temp.check(pg_temp.layout(:'mid') = '1:org,ben | 2:ann', 'no-pick join uses the first free court');
set role authenticated;

-- Court 1 fills up; tapping it then puts you on a court with room instead.
select pg_temp.as_user('cat'); select public.join_match(:'mid', 1);
select pg_temp.as_user('dan'); select public.join_match(:'mid', 1);
select pg_temp.as_user('eve'); select public.join_match(:'mid', 1) as j \gset
select pg_temp.check((:'j'::jsonb ->> 'court')::int = 2, 'full court falls back to one with room');
-- Nonsense court numbers are ignored.
select pg_temp.as_user('fay'); select public.join_match(:'mid', 9) as j \gset
select pg_temp.check((:'j'::jsonb ->> 'court')::int = 2, 'unknown court ignored');
select pg_temp.as_user('gus'); select public.join_match(:'mid', 2) as j \gset
select pg_temp.check((:'j'::jsonb ->> 'filled')::boolean, 'last spot fills the match');
-- Full: tapping a court still means the waitlist.
select pg_temp.as_user('hal'); select public.join_match(:'mid', 2) as j \gset
select pg_temp.check((:'j'::jsonb ->> 'status') = 'waitlist', 'full match waitlists');
reset role;
select pg_temp.check(pg_temp.layout(:'mid') = '1:org,ben,cat,dan | 2:ann,eve,fay,gus | w:hal', 'final layout');

-- Only signed-in people can join, and there is one join_match (old calls use the default).
select pg_temp.check(not has_function_privilege('anon', 'public.join_match(uuid, int)', 'execute')
                 and has_function_privilege('authenticated', 'public.join_match(uuid, int)', 'execute'), 'anon cannot join');
select pg_temp.check((select count(*) from pg_proc where proname = 'join_match' and pronamespace = 'public'::regnamespace) = 1, 'one join_match');

\o
\echo TAP SPOT CHECKS PASSED
