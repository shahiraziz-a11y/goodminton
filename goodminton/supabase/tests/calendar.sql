-- Calendar invites by email: on confirm, on change, on drop-out, on delete.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\pset tuples_only on
\o /dev/null

create function pg_temp.as_user(u text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce((select id::text from public.profiles where email = u || '@cal.test'), ''), false);
end $$;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
end $$;
create function pg_temp.uid(u text) returns uuid language sql security definer as $$ select id from public.profiles where email = u || '@cal.test' $$;
-- The newest unsent calendar email for someone: REQUEST / CANCEL / none.
create function pg_temp.cal(u text) returns text language sql security definer as $$
  select coalesce((select cal ->> 'method' from public.email_outbox
                    where user_id = pg_temp.uid(u) and kind = 'calendar' and sent_at is null
                    order by created_at desc limit 1), 'none')
$$;
create function pg_temp.n(u text) returns bigint language sql security definer as $$
  select count(*) from public.email_outbox where user_id = pg_temp.uid(u) and kind = 'calendar' and sent_at is null
$$;

insert into auth.users (id, email, raw_user_meta_data)
select gen_random_uuid(), n || '@cal.test', jsonb_build_object('full_name', initcap(n))
from unnest(array['org','ann','ben','cat','dan','off']) n;
update public.profiles set email_updates = false where email = 'off@cal.test';

-- The organiser creates a match: they're in, so it goes on their calendar.
select pg_temp.as_user('org'); set role authenticated;
select public.create_match('Cal night', 'doubles', 1, 'Hall', (now() + interval '3 days')::date, '20:00', 'Asia/Dubai', 90, 6) as slug \gset
reset role;
select id as mid from public.matches where slug = :'slug' \gset
select pg_temp.check(pg_temp.cal('org') = 'REQUEST', 'organiser gets an invite');
select to_jsonb(e) as ev from public.email_outbox e where user_id = pg_temp.uid('org') and kind = 'calendar' \gset
select pg_temp.check((:'ev'::jsonb -> 'cal' ->> 'uid') = :'mid' || '@goodminton.app'
                 and (:'ev'::jsonb -> 'cal' ->> 'location') = 'Hall'
                 and ((:'ev'::jsonb -> 'cal' ->> 'end')::timestamptz - (:'ev'::jsonb -> 'cal' ->> 'start')::timestamptz) = interval '90 minutes', 'event details');
select pg_temp.check((:'ev'::jsonb ->> 'subject') like '🏸 Cal night · %', 'subject');

-- Joining sends one to yourself; emails off gets none.
select pg_temp.as_user(u), public.join_match(:'mid') from unnest(array['ann','ben','off']) u;
\o /dev/null
select pg_temp.check(pg_temp.cal('ann') = 'REQUEST' and pg_temp.cal('ben') = 'REQUEST', 'joiners get invites');
select pg_temp.check(pg_temp.cal('off') = 'none', 'emails off: no invite');
-- Full: cat waits, no invite yet.
select pg_temp.as_user('cat'); set role authenticated; select public.join_match(:'mid'); reset role;
select pg_temp.check(pg_temp.cal('cat') = 'none', 'waitlist: no invite');

-- Ben drops out: his unsent invite becomes a cancel; cat moves up and gets one.
select pg_temp.as_user('ben'); set role authenticated; select public.leave_match(:'mid'); reset role;
select pg_temp.check(pg_temp.cal('ben') = 'CANCEL' and pg_temp.n('ben') = 1, 'drop out: one cancel replaces the invite');
select pg_temp.check(pg_temp.cal('cat') = 'REQUEST', 'promoted: invite');

-- Sent emails stay; a time change sends everyone confirmed an update with a higher sequence.
update public.email_outbox set sent_at = now() where kind = 'calendar';
select (cal ->> 'sequence')::int as seq1 from public.email_outbox where user_id = pg_temp.uid('ann') and kind = 'calendar' \gset
select pg_sleep(1.1);
update public.matches set starts_at = starts_at + interval '1 hour' where id = :'mid';
select pg_temp.check(pg_temp.cal('org') = 'REQUEST' and pg_temp.cal('ann') = 'REQUEST' and pg_temp.cal('cat') = 'REQUEST' and pg_temp.cal('ben') = 'none', 'moved: confirmed players updated');
select pg_temp.check((select (cal ->> 'sequence')::int from public.email_outbox where user_id = pg_temp.uid('ann') and kind = 'calendar' and sent_at is null) > :seq1, 'sequence goes up');
-- Other edits (e.g. RSVP window) don't.
update public.email_outbox set sent_at = now() where kind = 'calendar';
update public.matches set rsvp_close_hours = 2 where id = :'mid';
select pg_temp.check(pg_temp.n('ann') = 0, 'unrelated edit: nothing');

-- Guests never get one.
select pg_temp.as_user('ann'); set role authenticated; select public.add_player(:'mid', null, 'Guesty'); reset role;
select pg_temp.check(not exists (select 1 from public.email_outbox e join public.profiles p on p.id = e.user_id where p.is_guest), 'guests: none');

-- The match is deleted: the cancel survives the delete.
delete from public.matches where id = :'mid';
select pg_temp.check(pg_temp.cal('org') = 'CANCEL' and pg_temp.cal('ann') = 'CANCEL', 'deleted: cancels kept');

-- claim_due_emails passes the event through.
delete from public.email_outbox where user_id not in (select id from public.profiles where email like '%@cal.test');
select public.claim_due_emails() as due \gset
select pg_temp.check((select bool_and(x -> 'cal' ->> 'method' = 'CANCEL') from jsonb_array_elements(:'due'::jsonb) x where x ->> 'to' like '%@cal.test')
                 and (select count(*) from jsonb_array_elements(:'due'::jsonb) x where x ? 'cal') >= 2, 'claimed with cal');

\o
\echo CALENDAR CHECKS PASSED
