-- Upgrading to 0016: people stuck waiting behind a regulars window move into free spots.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email = u || '@noreg.test'), ''), false);
end $$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
end $$;
create function pg_temp.layout(p_match uuid) returns text language sql security definer as $$
  select string_agg(k || ':' || names, ' | ' order by k) from (
    select case when mp.status = 'waitlist' then 'w' else mp.court::text end as k, string_agg(split_part(p.email, '@', 1), ',' order by mp.seq) as names
      from public.match_players mp join public.profiles p on p.id = mp.user_id
     where mp.match_id = p_match group by 1) x;
$$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@noreg.test', jsonb_build_object('full_name', initcap(n))
from unnest(array['org','ann','ben','cat','dan','eve']) n;

-- A weekly copy from before 0016: window still open, three people waiting with room for three.
select pg_temp.as_user('org');
set role authenticated;
select public.create_match('Tuesday', 'doubles', 1, 'Hall', (now() + interval '4 days')::date, '20:00', 'Asia/Dubai', 90, 6) as slug \gset
reset role;
select id as mid from public.matches where slug = :'slug' \gset
update public.matches set repeat_weekly = true, regulars_first = true, regulars_until = now() + interval '6 hours' where id = :'mid';
insert into public.match_players (match_id, user_id, status)
select :'mid', id, 'waitlist' from public.profiles where email in ('ann@noreg.test', 'ben@noreg.test', 'cat@noreg.test', 'dan@noreg.test') order by email;
select pg_temp.check(pg_temp.layout(:'mid') = '1:org | w:ann,ben,cat,dan', 'stuck before the upgrade');
-- A past match with a waitlist is left alone.
select pg_temp.as_user('org');
set role authenticated;
select public.create_match('Old', 'doubles', 1, 'Hall', (now() + interval '4 days')::date, '20:00', 'Asia/Dubai', 90, 6) as old_slug \gset
reset role;
select id as old from public.matches where slug = :'old_slug' \gset
insert into public.match_players (match_id, user_id, status) select :'old', id, 'waitlist' from public.profiles where email = 'eve@noreg.test';
update public.matches set starts_at = now() - interval '3 days' where id = :'old';

select pg_temp.as_user('');
\i ../migrations/0016_no_regulars_first.sql
\o /dev/null

select pg_temp.check(pg_temp.layout(:'mid') = '1:org,ann,ben,cat | w:dan', 'first three move in, in order; the fourth waits for a court');
select pg_temp.check((select regulars_until is null and not regulars_first from public.matches where id = :'mid'), 'window gone');
select pg_temp.check(pg_temp.layout(:'old') = '1:org | w:eve', 'past matches untouched');

-- Asking for regulars first does nothing now; newcomers get in.
select pg_temp.as_user('org');
set role authenticated;
select public.set_repeat(:'mid', true, true);
select pg_temp.as_user('eve');
select public.join_match(:'mid') ->> 'status' as s \gset
reset role;
select pg_temp.check(:'s' = 'waitlist' and (select not regulars_first from public.matches where id = :'mid'), 'full match still waitlists; no regulars flag');

\o
\echo NO REGULARS CHECKS PASSED
