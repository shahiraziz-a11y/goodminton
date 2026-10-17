-- Email updates: who gets which email, bundling, opting out, sending.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null
create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin perform set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email = u || '@mail.test'), ''), false); end $$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'FAILED: %', what; end if; end $$;
create function pg_temp.fails(sql text) returns text language plpgsql as $$
begin execute sql; raise exception 'FAILED: expected error from %', sql;
exception when others then if sqlerrm like 'FAILED:%' then raise; end if; return sqlerrm; end $$;
create function pg_temp.uid(u text) returns uuid language sql security definer as $$ select id from public.profiles where email = u || '@mail.test' $$;
create function pg_temp.mid(t text) returns uuid language sql security definer as $$ select id from public.matches where title = t order by starts_at limit 1 $$;
-- Who has unsent emails of a kind for a match: "a,org"
create function pg_temp.to(t text, k text) returns text language sql security definer as $$
  select coalesce(string_agg(split_part(p.email, '@', 1), ',' order by p.email), '')
    from public.email_outbox e join public.profiles p on p.id = e.user_id
   where e.match_id = pg_temp.mid(t) and e.kind = k and e.sent_at is null;
$$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@mail.test', jsonb_build_object('full_name', initcap(n) || ' M')
from unnest(array['org','a','b','c','d','e','off','stranger']) n;
-- Other suites leave emails behind in this shared database; start clean.
delete from public.email_outbox;
set role authenticated;
select pg_temp.as_user('off'); select public.set_email_updates(false);
select pg_temp.check((public.get_email_updates() ->> 'on') = 'false', 'switched off');
select pg_temp.as_user('a');
select pg_temp.check((public.get_email_updates() ->> 'on') = 'true' and (public.get_email_updates() ->> 'email') = 'a@mail.test', 'on by default');

-- ===========================================================================
-- Joins, waitlist, drop-outs, removals
-- ===========================================================================
select pg_temp.as_user('stranger');
select public.create_match('Stranger match', 'doubles', 1, '', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6);
select pg_temp.as_user('org');
select public.create_match('E1', 'doubles', 1, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6);
select pg_temp.check(pg_temp.to('E1', 'new_match') = '', 'first match: nobody to tell');
select pg_temp.as_user('a'); select public.join_match(pg_temp.mid('E1'));
select pg_temp.check(pg_temp.to('E1', 'joined') = 'org', 'Ann joins: organiser told, not Ann');
select pg_temp.as_user('b'); select public.join_match(pg_temp.mid('E1'));
select pg_temp.check(pg_temp.to('E1', 'joined') = 'a,org,org', 'Ben joins: Ann and organiser told');
select pg_temp.as_user('off'); select public.join_match(pg_temp.mid('E1'));
select pg_temp.as_user('d'); select public.join_match(pg_temp.mid('E1'));
reset role;
select pg_temp.check((select who from public.email_outbox where match_id = pg_temp.mid('E1') and kind = 'joined' order by created_at desc limit 1) = 'D (waitlist)', 'waitlist joins are labelled');
select pg_temp.check(not exists (select 1 from public.email_outbox where user_id = pg_temp.uid('off')), 'emails off: none queued');
select pg_temp.check((select bool_and(send_after > now() + interval '4 minutes') from public.email_outbox where kind in ('joined', 'left')), 'joins wait 5 minutes to bundle');
set role authenticated;
-- The organiser adds a guest: the organiser isn't told about their own action; the guest has no email.
select pg_temp.as_user('org'); select public.add_player(pg_temp.mid('E1'), null, 'Guest G');
reset role;
select pg_temp.check((select count(*) from public.email_outbox e join public.profiles p on p.id = e.user_id
                       where e.match_id = pg_temp.mid('E1') and e.who = 'Guest (waitlist)' and p.email = 'org@mail.test') = 0, 'actor not told');
select pg_temp.check(not exists (select 1 from public.email_outbox e join public.profiles p on p.id = e.user_id where p.is_guest), 'guests never emailed');
set role authenticated;
-- A waitlisted player hears about later joins too.
select pg_temp.as_user('e'); select public.join_match(pg_temp.mid('E1'));
reset role;
select pg_temp.check(exists (select 1 from public.email_outbox where user_id = pg_temp.uid('d') and who = 'E (waitlist)'), 'waitlisted Dan told');
set role authenticated;
-- Drop-outs and removals: everyone else in the match hears.
select pg_temp.as_user('b'); select public.leave_match(pg_temp.mid('E1'));
select pg_temp.check(pg_temp.to('E1', 'left') like '%a%' and pg_temp.to('E1', 'left') like '%org%' and pg_temp.to('E1', 'left') not like '%b%', 'Ben drops out: others told, not Ben');
select pg_temp.as_user('org'); select public.remove_player(pg_temp.mid('E1'), pg_temp.uid('e'));
reset role;
select pg_temp.check(not exists (select 1 from public.email_outbox where who = 'E' and kind = 'left' and user_id in (pg_temp.uid('org'), pg_temp.uid('e'))), 'removal: not the organiser who did it, not the removed');
select pg_temp.check(exists (select 1 from public.email_outbox where who = 'E' and kind = 'left' and user_id = pg_temp.uid('a')), 'removal: Ann told');

-- ===========================================================================
-- Sending: bundled, claimed once, retried on failure
-- ===========================================================================
select pg_temp.check(public.claim_due_emails() = '[]'::jsonb, 'nothing due before 5 minutes');
update public.email_outbox set send_after = now() where kind in ('joined', 'left');
select public.claim_due_emails() as batch \gset
select x as org_mail from jsonb_array_elements(:'batch'::jsonb) x where x ->> 'to' = 'org@mail.test' \gset
select pg_temp.check((select count(*) from jsonb_array_elements(:'batch'::jsonb) x where x ->> 'to' = 'org@mail.test') = 1, 'one email per person per match');
select pg_temp.check((:'org_mail'::jsonb ->> 'subject') = 'E1: A, B, Off, D (waitlist), E (waitlist) joined, B dropped out', 'bundled subject (Off still mentioned; only their own emails are off)');
select pg_temp.check((:'org_mail'::jsonb ->> 'body') like 'Joined: A, B, Off, D (waitlist), E (waitlist)' || chr(10) || 'Dropped out: B' || chr(10) || 'Now 4/4 in · 1 waiting · %', 'bundled body with the count now (Dan moved up)');
select pg_temp.check((:'org_mail'::jsonb ->> 'url') like '/m/e1-%' and (:'org_mail'::jsonb ->> 'name') = 'Org M', 'link and name');
select pg_temp.check(public.claim_due_emails() = '[]'::jsonb, 'claimed once');
-- A failed send goes back in the queue, up to 5 tries.
select public.unclaim_emails(array(select jsonb_array_elements_text(:'org_mail'::jsonb -> 'ids'))::uuid[], 'smtp down');
select pg_temp.check(jsonb_array_length(public.claim_due_emails()) = 1, 'retried after a failure');
update public.email_outbox set sent_at = null, attempts = 5 where user_id = pg_temp.uid('org');
select pg_temp.check(public.claim_due_emails() = '[]'::jsonb, 'gives up after 5 tries');
-- Someone switches off after an email was queued: it isn't sent.
set role authenticated;
select pg_temp.as_user('c'); select public.join_match(pg_temp.mid('E1'));
select pg_temp.as_user('a'); select public.set_email_updates(false);
reset role;
update public.email_outbox set send_after = now() where sent_at is null;
select pg_temp.check(not exists (select 1 from jsonb_array_elements(public.claim_due_emails()) x where x ->> 'to' = 'a@mail.test'), 'switched off later: not sent');
set role authenticated;
select pg_temp.as_user('a'); select public.set_email_updates(true);

-- ===========================================================================
-- Court booked: everyone in the match, straight away, with the line-up
-- ===========================================================================
reset role; delete from public.email_outbox; set role authenticated;
select pg_temp.as_user('a'); select public.book_court(pg_temp.mid('E1'), 1, 'Big Hall', 'Court 3', 'Gate B', 100);
select pg_temp.check(pg_temp.to('E1', 'court_booked') = 'c,d,org', 'everyone but the booker (and those off)');
reset role;
select body as b from public.email_outbox where kind = 'court_booked' and user_id = pg_temp.uid('org') \gset
select pg_temp.check(:'b' like 'Court 3 at Big Hall is booked by A.%', 'who booked');
select pg_temp.check(:'b' like '%On this court: Org, A, Off, D%' and :'b' like '%Parking: Gate B%' and :'b' like '%plan is final.', 'line-up, parking, final');
select pg_temp.check((select bool_and(send_after <= now()) from public.email_outbox where kind = 'court_booked'), 'sent straight away');
select pg_temp.check((select subject from public.email_outbox where kind = 'court_booked' limit 1) like 'Court booked: E1 · %', 'subject');

-- ===========================================================================
-- New matches: the organiser's recent players, or last week's regulars
-- ===========================================================================
delete from public.email_outbox;
set role authenticated;
select pg_temp.as_user('org');
select public.create_match('E2', 'doubles', 1, '', (now() + interval '5 days')::date, '19:00', 'Asia/Dubai', 90, 6);
select pg_temp.check(pg_temp.to('E2', 'new_match') = 'a,d', 'recent confirmed players told (not the organiser, not waitlisted Cara, not Off who switched off)');
reset role;
select pg_temp.check((select body from public.email_outbox where kind = 'new_match' limit 1) like 'Org set up E2 for %' || chr(10) || '4 spots, doubles on 1 court.%Tap to join.', 'new match body');
select pg_temp.check(not exists (select 1 from public.email_outbox where user_id = pg_temp.uid('stranger')), 'strangers never told');
-- A stranger's new match doesn't email our group.
delete from public.email_outbox;
set role authenticated;
select pg_temp.as_user('stranger');
select public.create_match('Stranger 2', 'doubles', 1, '', (now() + interval '5 days')::date, '19:00', 'Asia/Dubai', 90, 6);
select pg_temp.check(pg_temp.to('Stranger 2', 'new_match') = '', 'other organisers'' players are not ours');
-- Weekly: next week's copy goes to this week's players.
select pg_temp.as_user('org');
select public.create_match('Weekly E', 'doubles', 1, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6);
select public.set_repeat(pg_temp.mid('Weekly E'), true, true);
select pg_temp.as_user(u), public.join_match(pg_temp.mid('Weekly E')) from unnest(array['b','e']) u;
reset role;
delete from public.email_outbox;
update public.matches set starts_at = now() - interval '5 minutes' where id = pg_temp.mid('Weekly E');
select pg_temp.as_user('');  -- the scheduler runs signed out
select public.roll_recurring();
select pg_temp.check((select string_agg(split_part(p.email, '@', 1), ',' order by p.email) from public.email_outbox e join public.profiles p on p.id = e.user_id
                       join public.matches m on m.id = e.match_id where m.title = 'Weekly E' and e.kind = 'new_match') = 'b,e', 'weekly: regulars told');
select pg_temp.check((select body from public.email_outbox where kind = 'new_match' limit 1) like '%first dibs for 12 hours.%', 'mentions first dibs');

-- ===========================================================================
-- Played matches, privacy
-- ===========================================================================
delete from public.email_outbox;
update public.matches set starts_at = now() - interval '3 hours' where id = pg_temp.mid('E2');
insert into public.match_players (match_id, user_id, status) values (pg_temp.mid('E2'), pg_temp.uid('b'), 'waitlist');
select pg_temp.check(pg_temp.to('E2', 'joined') = '', 'no emails about played matches');
set role authenticated;
select pg_temp.check(pg_temp.fails('select * from public.email_outbox') like '%permission denied%', 'outbox closed');
select pg_temp.check(pg_temp.fails('select public.claim_due_emails()') like '%permission denied%', 'players cannot claim emails');
select pg_temp.check(pg_temp.fails($$select public.queue_email(gen_random_uuid(), null, 'x', 's', 'b', '/')$$) like '%permission denied%', 'players cannot write emails');
reset role;
select pg_temp.check(public.flush_emails() = false, 'no pg_net here: never errors');

reset role;
\o
\echo EMAIL CHECKS PASSED
