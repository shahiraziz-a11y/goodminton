-- The last logged pairing becomes the court's pairing until someone changes it.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null
create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email = u || '@pair.test'), ''), false); end $$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'FAILED: %', what; end if; end $$;
create function pg_temp.uid(u text) returns uuid language sql security definer as $$ select id from public.profiles where email = u || '@pair.test' $$;
create function pg_temp.mid(t text) returns uuid language sql security definer as $$ select id from public.matches where title = t $$;
create function pg_temp.order_of(t text) returns text language sql security definer as $$
  select string_agg(coalesce(mp.court::text, 'w') || split_part(p.email, '@', 1), ',' order by mp.court, mp.seq)
    from public.match_players mp join public.profiles p on p.id = mp.user_id join public.matches m on m.id = mp.match_id
   where m.title = t and mp.status = 'confirmed';
$$;
insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@pair.test', jsonb_build_object('full_name', initcap(n)) from unnest(array['o','a','b','c','d','e','f','g']) n;
set role authenticated;

select pg_temp.as_user('o');
select public.create_match('Pairs', 'doubles', 2, '', (now() + interval '2 days')::date, '20:00', 'Asia/Dubai', 90, 6);
select pg_temp.as_user(u), public.join_match(pg_temp.mid('Pairs')) from unnest(array['a','b','c','d','e','f','g']) u;
select pg_temp.check(pg_temp.order_of('Pairs') = '1o,1a,1b,1c,2d,2e,2f,2g', 'join order');

-- Court 1 plays O+C vs A+B: that becomes court 1's pairing. Court 2 untouched.
select pg_temp.as_user('a');
select public.log_game(pg_temp.mid('Pairs'), pg_temp.uid('o'), pg_temp.uid('c'), pg_temp.uid('a'), pg_temp.uid('b'), 'a');
select pg_temp.check(pg_temp.order_of('Pairs') = '1o,1c,1a,1b,2d,2e,2f,2g', 'last pairing kept for court 1');
-- Logging the same pairing again changes nothing.
select public.log_game(pg_temp.mid('Pairs'), pg_temp.uid('o'), pg_temp.uid('c'), pg_temp.uid('a'), pg_temp.uid('b'), 'b');
select pg_temp.check(pg_temp.order_of('Pairs') = '1o,1c,1a,1b,2d,2e,2f,2g', 'same pairing stays');
-- Sides swapped (A+B on the left) is also remembered.
select public.log_game(pg_temp.mid('Pairs'), pg_temp.uid('a'), pg_temp.uid('b'), pg_temp.uid('c'), pg_temp.uid('o'), 'a');
select pg_temp.check(pg_temp.order_of('Pairs') = '1a,1b,1c,1o,2d,2e,2f,2g', 'new pairing replaces the old');
-- Someone shuffles: that's the pairing now.
select public.set_court_order(pg_temp.mid('Pairs'), array[pg_temp.uid('o'), pg_temp.uid('a'), pg_temp.uid('b'), pg_temp.uid('c')]);
select pg_temp.check(pg_temp.order_of('Pairs') = '1o,1a,1b,1c,2d,2e,2f,2g', 'shuffle overrides');

-- A mixed game across courts doesn't reorder anything.
select public.log_game(pg_temp.mid('Pairs'), pg_temp.uid('o'), pg_temp.uid('d'), pg_temp.uid('a'), pg_temp.uid('e'), 'a');
select pg_temp.check(pg_temp.order_of('Pairs') = '1o,1a,1b,1c,2d,2e,2f,2g', 'cross-court game leaves courts alone');
-- Games outside a match don't touch any match.
select public.log_game(null, pg_temp.uid('a'), pg_temp.uid('c'), pg_temp.uid('o'), pg_temp.uid('b'), 'a');
select pg_temp.check(pg_temp.order_of('Pairs') = '1o,1a,1b,1c,2d,2e,2f,2g', 'free games leave matches alone');

-- Singles: the two players swap sides.
select pg_temp.as_user('o');
select public.create_match('Singles pairs', 'singles', 1, '', (now() + interval '2 days')::date, '20:00', 'Asia/Dubai', 60, 6);
select pg_temp.as_user('a'); select public.join_match(pg_temp.mid('Singles pairs'));
select public.log_game(pg_temp.mid('Singles pairs'), pg_temp.uid('a'), null, pg_temp.uid('o'), null, 'b');
select pg_temp.check(pg_temp.order_of('Singles pairs') = '1a,1o', 'singles sides kept');

reset role;
\o
\echo PAIRING CHECKS PASSED
