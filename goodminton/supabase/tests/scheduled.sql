-- Test alerts, reminders, weekly matches and scores.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null
create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email = u || '@sch.test'), ''), false); end $$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'FAILED: %', what; end if; end $$;
create function pg_temp.fails(sql text) returns text language plpgsql as $$
begin execute sql; raise exception 'FAILED: expected error from %', sql;
exception when others then if sqlerrm like 'FAILED:%' then raise; end if; return sqlerrm; end $$;
create function pg_temp.uid(u text) returns uuid language sql security definer as $$ select id from public.profiles where email = u || '@sch.test' $$;
create function pg_temp.mid(t text) returns uuid language sql security definer as $$ select id from public.matches where title = t order by starts_at limit 1 $$;
create function pg_temp.slug(t text) returns text language sql security definer as $$ select slug from public.matches where title = t $$;
create function pg_temp.kinds(u text) returns text language sql security definer as $$
  select coalesce(string_agg(kind, ',' order by created_at, kind), '') from public.notifications where user_id = pg_temp.uid(u);
$$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@sch.test', jsonb_build_object('full_name', initcap(n) || ' S')
from unnest(array['org','a','b','c','d','e','nodevice']) n;
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
select id, 'https://push.example/' || id, 'k', 'a' from public.profiles where email like '%@sch.test' and email not like 'nodevice%';
set role authenticated;

-- ===========================================================================
-- 1. Test alert
-- ===========================================================================
select pg_temp.as_user('nodevice');
select pg_temp.check(pg_temp.fails('select public.send_test_alert()') like '%Turn on alerts%', 'test alert needs a device');
select pg_temp.as_user('a');
select public.send_test_alert() as tid \gset
select pg_temp.check((public.alert_status(:'tid') ->> 'sent') = 'false', 'test alert queued, not sent yet');
select pg_temp.as_user('b');
select pg_temp.check(public.alert_status(:'tid') is null, 'cannot see someone else''s alert');
reset role;
update public.notifications set sent_at = now(), devices = 2 where id = :'tid';
set role authenticated;
select pg_temp.as_user('a');
select pg_temp.check((public.alert_status(:'tid') ->> 'devices') = '2', 'delivery reported');
select pg_temp.check(pg_temp.fails('select public.flush_alerts()') like '%permission denied%', 'players cannot trigger the sweep');
select pg_temp.check(pg_temp.fails($$select public.set_alert_config('https://x.app', 'aaaaaaaaaaaaaaaaaaaa')$$) like '%permission denied%', 'players cannot change settings');
reset role;
select pg_temp.check(public.flush_alerts() = false, 'no sweep without settings');
select pg_temp.check(pg_temp.fails($$select public.set_alert_config('http://x.app', 'aaaaaaaaaaaaaaaaaaaa')$$) like '%https%', 'https only');
select pg_temp.check(pg_temp.fails($$select public.set_alert_config('https://x.app', 'short')$$) like '%PUSH_WEBHOOK_SECRET%', 'needs the secret');
select public.set_alert_config('https://x.app/', 'aaaaaaaaaaaaaaaaaaaa');
select pg_temp.check((select value from public.app_config where key = 'site_url') = 'https://x.app', 'address saved without trailing slash');
select pg_temp.check(public.flush_alerts() = false, 'no sweep without pg_net (local) — never errors');
delete from public.notifications;
set role authenticated;

-- ===========================================================================
-- 2. Reminders
-- ===========================================================================
select pg_temp.as_user('org');
select public.create_match('Tomorrow', 'doubles', 2, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6);
select pg_temp.as_user(u), public.join_match(pg_temp.mid('Tomorrow')) from unnest(array['a','b','c','d','nodevice']) u;
select pg_temp.as_user('a'); select public.book_court(pg_temp.mid('Tomorrow'), 1, 'Hall', 'Court 3', '', 100);
reset role;
update public.matches set created_at = now() - interval '2 days', starts_at = now() + interval '20 hours' where id = pg_temp.mid('Tomorrow');
delete from public.notifications;
-- 20 hours out: the day-before reminder, once, to confirmed players with a device.
select public.send_reminders();
-- Only the day-before ones count here (on a Monday the weekly debt nudge also goes out).
select pg_temp.check((select count(*) from public.notifications where kind = 'reminder_day') = 5, 'day-before to org, a, b, c, d');
delete from public.notifications where kind = 'reminder_debt';
select pg_temp.check(public.send_reminders() = 0, 'not sent twice');
select pg_temp.check(pg_temp.kinds('a') = 'reminder_day' and pg_temp.kinds('nodevice') = '', 'player reminded; no device, no alert');
select pg_temp.check((select title from public.notifications where user_id = pg_temp.uid('d')) like '🏸 Tomorrow · %', 'reminder title');
select pg_temp.check((select body from public.notifications where user_id = pg_temp.uid('d')) like 'Hall · Court 3%', 'reminder says where');
-- 90 minutes out: the 2-hour reminder.
select pg_temp.check(public.send_reminders(now() + interval '18 hours 30 minutes') = 5, '2h reminder');
select pg_temp.check(pg_temp.kinds('b') = 'reminder_day,reminder_soon', 'both reminders');
-- Sign-ups closed with court 2 (Dan + Nodevice) unbooked: the organiser hears, once.
update public.matches set lock_state = 'locked' where id = pg_temp.mid('Tomorrow');
select public.send_reminders(now() + interval '18 hours 30 minutes');
select public.send_reminders(now() + interval '18 hours 30 minutes');
select pg_temp.check((select count(*) from public.notifications where user_id = pg_temp.uid('org') and kind = 'reminder_book') = 1, 'organiser told once');
select pg_temp.check((select title from public.notifications where kind = 'reminder_book') = 'Book court 2 for Tomorrow', 'names the unbooked court');
-- A match created minutes ago doesn't get a day-before reminder.
set role authenticated;
select pg_temp.as_user('org');
select public.create_match('Last minute', 'doubles', 1, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6);
reset role;
update public.matches set starts_at = now() + interval '10 hours' where id = pg_temp.mid('Last minute');
delete from public.notifications;
select public.send_reminders();
select pg_temp.check(not exists (select 1 from public.notifications where kind = 'reminder_day' and match_id = pg_temp.mid('Last minute')), 'no day-before for a just-made match');
delete from public.notifications where kind = 'reminder_debt';  -- today's Monday nudge, if today is a Monday

-- Money: Monday 10:30 Dubai, everyone who owes gets one nudge that week.
-- 'Tomorrow' has court 1 booked by Ann for 100, shared by org, a, b, c: 25 each.
select pg_temp.check(public.send_reminders('2026-10-19 06:30+00') >= 3, 'Monday nudges sent');
select pg_temp.check((select string_agg(split_part(p.email, '@', 1), ',' order by p.email) from public.notifications n join public.profiles p on p.id = n.user_id
                       where n.kind = 'reminder_debt' and p.email like '%@sch.test') = 'b,c,org', 'the three who owe Ann; not Ann; not court 2');
select pg_temp.check((select title from public.notifications n where n.kind = 'reminder_debt' and n.user_id = pg_temp.uid('b')) = 'You owe AED 25', 'amount owed');
create function pg_temp.debts() returns bigint language sql security definer as $$
  select count(*) from public.notifications n join public.profiles p on p.id = n.user_id where n.kind = 'reminder_debt' and p.email like '%@sch.test';
$$;
select public.send_reminders('2026-10-19 08:00+00');
select pg_temp.check(pg_temp.debts() = 3, 'once a week');
delete from public.notifications;
select public.send_reminders('2026-10-27 06:30+00');
select pg_temp.check(pg_temp.debts() = 0, 'only Mondays');
select public.send_reminders('2026-10-26 05:00+00');
select pg_temp.check(pg_temp.debts() = 0, 'not before 10am');
-- Settled up: no nudge next week.
set role authenticated;
select pg_temp.as_user('a');
select public.set_settled(pg_temp.mid('Tomorrow'), pg_temp.uid(u), pg_temp.uid('a'), 25) from unnest(array['b','c','org']) u;
reset role;
delete from public.notifications;
select public.send_reminders('2026-10-26 06:30+00');
select pg_temp.check(pg_temp.debts() = 0, 'settled: no nudge');

-- ===========================================================================
-- 3. Weekly matches (no regulars-first window)
-- ===========================================================================
set role authenticated;
select pg_temp.as_user('org');
select public.create_match('Weekly', 'doubles', 1, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6);
select pg_temp.as_user('a');
select pg_temp.check(pg_temp.fails(format('select public.set_repeat(%L, true, true)', pg_temp.mid('Weekly'))) like '%Only the organiser%', 'only organiser sets repeat');
select pg_temp.as_user(u), public.join_match(pg_temp.mid('Weekly')) from unnest(array['a','b']) u;
select pg_temp.as_user('a'); select public.add_player(pg_temp.mid('Weekly'), null, 'Guest G');
select pg_temp.as_user('org'); select public.set_repeat(pg_temp.mid('Weekly'), true, true);
reset role;
-- Not started yet: nothing rolls.
select pg_temp.check(public.roll_recurring() = 0, 'nothing before it starts');
update public.matches set starts_at = now() - interval '10 minutes' where id = pg_temp.mid('Weekly');
delete from public.notifications;
select pg_temp.check(public.roll_recurring() = 1, 'next week made once it starts');
select pg_temp.check(public.roll_recurring() = 0, 'only one copy');
select id as next_id, slug as next_slug from public.matches where title = 'Weekly' order by starts_at desc limit 1 \gset
select pg_temp.check((select starts_at - (select starts_at from public.matches where id = pg_temp.mid('Weekly')) from public.matches where id = :'next_id') = interval '7 days', 'a week later');
select pg_temp.check((select repeat_weekly from public.matches where id = :'next_id') and not (select repeat_weekly from public.matches where id = pg_temp.mid('Weekly')), 'repeat moves to the new one');
select pg_temp.check((select status || '/' || courts || '/' || venue from public.matches where id = :'next_id') = 'planning//Hall', 'not booked, same venue');
select pg_temp.check((select string_agg(split_part(p.email, '@', 1), ',') from public.match_players mp join public.profiles p on p.id = mp.user_id
                       where mp.match_id = :'next_id') = 'org', 'organiser in; nobody else yet');
select pg_temp.check(cardinality((select regulars from public.matches where id = :'next_id')) = 3, 'regulars: org, a, b (not the guest)');
select pg_temp.check(pg_temp.kinds('a') = 'repeat' and pg_temp.kinds('b') = 'repeat' and pg_temp.kinds('org') = '', 'regulars told');
select pg_temp.check((select body from public.notifications where user_id = pg_temp.uid('a')) like '%Tap to join.', 'no first dibs');
select pg_temp.check((select regulars_until from public.matches where id = :'next_id') is null
                 and not (select regulars_first from public.matches where id = :'next_id'), 'no regulars window, even when asked for');
-- Anyone gets straight in while there's room.
set role authenticated;
select pg_temp.as_user('c');
select public.join_match(:'next_id') ->> 'status' as s \gset
select pg_temp.check(:'s' = 'confirmed', 'newcomer gets straight in');
select pg_temp.as_user('a');
select public.join_match(:'next_id') ->> 'status' as s \gset
select pg_temp.check(:'s' = 'confirmed', 'last week''s player gets straight in');
select public.get_match(:'next_slug') as v \gset
select pg_temp.check((:'v'::jsonb ->> 'repeat_weekly') = 'true' and (:'v'::jsonb ->> 'regulars_until') is null, 'match shows weekly, no window');
reset role;
set role authenticated;
select pg_temp.as_user('d');
select public.join_match(:'next_id') ->> 'status' as s \gset
select pg_temp.check(:'s' = 'confirmed', 'anyone joins after the window');
-- Organiser stops repeating.
select pg_temp.as_user('org'); select public.set_repeat(:'next_id', false, false);
reset role;
update public.matches set starts_at = now() - interval '5 minutes' where id = :'next_id';
select pg_temp.check(public.roll_recurring() = 0, 'stopped: no more weeks');
-- Organiser who wasn't playing isn't added next week.
set role authenticated;
select pg_temp.as_user('org');
select public.create_match('Weekly 2', 'doubles', 1, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6);
select public.set_repeat(pg_temp.mid('Weekly 2'), true, false);
select pg_temp.as_user('a'); select public.join_match(pg_temp.mid('Weekly 2'));
select pg_temp.as_user('org'); select public.leave_match(pg_temp.mid('Weekly 2'));
reset role;
update public.matches set starts_at = now() - interval '5 minutes' where id = pg_temp.mid('Weekly 2');
select public.roll_recurring();
select pg_temp.check((select count(*) from public.match_players mp join public.matches m on m.id = mp.match_id
                       where m.title = 'Weekly 2' and m.starts_at > now()) = 0, 'organiser not playing: not added');
select pg_temp.check((select regulars_until from public.matches where title = 'Weekly 2' and starts_at > now()) is null, 'no first dibs');

-- ===========================================================================
-- 4. Scores
-- ===========================================================================
set role authenticated;
select pg_temp.as_user('org');
select public.create_match('Scored', 'doubles', 1, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6);
select pg_temp.as_user(u), public.join_match(pg_temp.mid('Scored')) from unnest(array['a','b','c']) u;
select pg_temp.as_user('a');
select pg_temp.check(pg_temp.fails(format('select public.log_game(%L, %L, %L, %L, %L, %L, 21, null)', pg_temp.mid('Scored'), pg_temp.uid('org'), pg_temp.uid('a'), pg_temp.uid('b'), pg_temp.uid('c'), 'a')) like '%both scores%', 'both scores or neither');
select pg_temp.check(pg_temp.fails(format('select public.log_game(%L, %L, %L, %L, %L, %L, 17, 21)', pg_temp.mid('Scored'), pg_temp.uid('org'), pg_temp.uid('a'), pg_temp.uid('b'), pg_temp.uid('c'), 'a')) like '%higher score%', 'winner scored more');
select pg_temp.check(pg_temp.fails(format('select public.log_game(%L, %L, %L, %L, %L, %L, 21, 21)', pg_temp.mid('Scored'), pg_temp.uid('org'), pg_temp.uid('a'), pg_temp.uid('b'), pg_temp.uid('c'), 'a')) like '%higher score%', 'no ties');
select pg_temp.check(pg_temp.fails(format('select public.log_game(%L, %L, %L, %L, %L, %L, 130, 2)', pg_temp.mid('Scored'), pg_temp.uid('org'), pg_temp.uid('a'), pg_temp.uid('b'), pg_temp.uid('c'), 'a')) like '%0 to 99%', 'score range');
select public.log_game(pg_temp.mid('Scored'), pg_temp.uid('org'), pg_temp.uid('a'), pg_temp.uid('b'), pg_temp.uid('c'), 'a', 21, 17);
select public.log_game(pg_temp.mid('Scored'), pg_temp.uid('org'), pg_temp.uid('a'), pg_temp.uid('b'), pg_temp.uid('c'), 'b');
select public.get_leaderboard() as lb \gset
select pg_temp.check(exists (select 1 from jsonb_array_elements(:'lb'::jsonb -> 'games') g where g ->> 'score_a' = '21' and g ->> 'score_b' = '17'), 'leaderboard has the score');
select pg_temp.check(exists (select 1 from jsonb_array_elements(:'lb'::jsonb -> 'games') g where g ->> 'score_a' is null), 'score optional');
-- The match shows its games, newest first, with names, to anyone.
select pg_temp.as_user('e');
select public.get_match(pg_temp.slug('Scored')) as v \gset
select pg_temp.check(jsonb_array_length(:'v'::jsonb -> 'games') = 2, 'two games on the match');
select pg_temp.check((:'v'::jsonb -> 'games' -> 1 ->> 'score_a') = '21' and (:'v'::jsonb -> 'games' -> 1 -> 'a' -> 0 ->> 'full_name') = 'Org S', 'names and score');

reset role;
\o
\echo SCHEDULED CHECKS PASSED
