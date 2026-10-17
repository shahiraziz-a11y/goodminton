-- Email updates, sent from the organiser's Gmail by the app, alongside app alerts:
--   1. A new match is created and you're a regular.
--   2. Someone joins a match you're in (confirmed or waitlist).
--   3. Someone drops out of (or is removed from) a match you're in.
--   4. A court is booked: venue, court, time and that court's line-up.
-- Joins and drop-outs are bundled: one email per person per match, 5 minutes after the first.
-- Everyone can switch emails off (link in every email, or the switch on Home).
-- Run once, after 0012. Safe to run again.

do $$ begin
  if to_regprocedure('public.run_scheduled()') is null then
    raise exception 'Run 0012_reminders_weekly_scores.sql first, then this file.';
  end if;
end $$;

alter table public.profiles add column if not exists email_updates boolean not null default true;

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  match_id uuid references public.matches (id) on delete cascade,
  kind text not null,               -- new_match | court_booked | joined | left
  subject text not null,
  body text not null,
  who text,                         -- joined/left: the person, e.g. "Priya" or "Priya (waitlist)"
  url text not null default '/',
  created_at timestamptz not null default now(),
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  attempts int not null default 0,
  error text
);
create index if not exists email_outbox_due_idx on public.email_outbox (send_after) where sent_at is null;
alter table public.email_outbox enable row level security;
revoke all on table public.email_outbox from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Writing emails
-- ---------------------------------------------------------------------------

-- Queue one email, skipping guests, people with emails off or no address, and whoever
-- caused the change.
create or replace function public.queue_email(p_user uuid, p_match uuid, p_kind text, p_subject text, p_body text,
  p_url text, p_who text default null, p_send_after timestamptz default now()) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = auth.uid() then return false; end if;
  if not exists (select 1 from public.profiles where id = p_user and not is_guest and email_updates
                 and coalesce(email, '') like '%@%') then
    return false;
  end if;
  insert into public.email_outbox (user_id, match_id, kind, subject, body, who, url, send_after)
  values (p_user, p_match, p_kind, p_subject, p_body, p_who, p_url, p_send_after);
  return true;
end $$;

-- Everyone in a match: confirmed and waitlisted players, plus the organiser.
create or replace function public.match_members(p_match uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select user_id from public.match_players where match_id = p_match
  union select organiser_id from public.matches where id = p_match;
$$;

-- 2 and 3: joins and drop-outs, bundled 5 minutes.
create or replace function public.email_on_player_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
  v_user uuid := coalesce(new.user_id, old.user_id);
  v_who text;
  r record;
begin
  select * into m from public.matches where id = coalesce(new.match_id, old.match_id);
  if not found or public.match_past(m) then return null; end if;
  if tg_op = 'INSERT' then
    v_who := public.first_name(v_user) || case when new.status = 'waitlist' then ' (waitlist)' else '' end;
  else
    v_who := public.first_name(v_user);
  end if;
  for r in select u from public.match_members(m.id) u where u <> v_user loop
    perform public.queue_email(r.u, m.id, case when tg_op = 'INSERT' then 'joined' else 'left' end,
      m.title, '', '/m/' || m.slug, v_who, now() + interval '5 minutes');
  end loop;
  return null;
end $$;

drop trigger if exists match_players_email on public.match_players;
create trigger match_players_email
  after insert or delete on public.match_players
  for each row execute function public.email_on_player_change();

-- 4: a court is booked. Everyone in the match hears, with that court's line-up.
create or replace function public.email_on_court_booked() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
  lineup text;
  open_courts int;
  r record;
begin
  select * into m from public.matches where id = new.match_id;
  if not found or public.match_past(m) then return null; end if;
  select string_agg(public.first_name(user_id), ', ' order by seq) into lineup
    from public.match_players where match_id = m.id and status = 'confirmed' and court = new.court;
  select count(*) into open_courts from generate_series(1, m.court_count) c where not public.court_booked(m.id, c);
  for r in select u from public.match_members(m.id) u loop
    perform public.queue_email(r.u, m.id, 'court_booked',
      'Court booked: ' || m.title || ' · ' || public.when_label(m),
      new.label || ' at ' || coalesce(nullif(m.venue, ''), 'the venue') || ' is booked'
        || case when new.booked_by is distinct from r.u then ' by ' || public.first_name(new.booked_by) else '' end || '.' || chr(10)
        || 'When: ' || public.when_label(m) || ' (' || m.duration_min || ' min)' || chr(10)
        || 'On this court: ' || coalesce(lineup, 'nobody yet') || chr(10)
        || case when nullif(m.parking, '') is not null then 'Parking: ' || m.parking || chr(10) else '' end
        || case when open_courts = 0 then 'Every court is booked, so the plan is final.'
                else open_courts || ' court' || case when open_courts > 1 then 's are' else ' is' end || ' still to be booked.' end,
      '/m/' || m.slug);
  end loop;
  return null;
end $$;

drop trigger if exists match_courts_email on public.match_courts;
create trigger match_courts_email
  after insert on public.match_courts
  for each row execute function public.email_on_court_booked();

-- 1: a new match. Weekly copies go to last week's players; one-off matches go to
-- everyone who played in this organiser's matches in the last 8 weeks.
create or replace function public.email_on_new_match() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in
    select distinct u from (
      select unnest(new.regulars) as u where new.series_id is not null
      union
      select mp.user_id from public.match_players mp join public.matches x on x.id = mp.match_id
       where new.series_id is null and x.organiser_id = new.organiser_id and x.id <> new.id
         and mp.status = 'confirmed' and x.starts_at > now() - interval '8 weeks'
    ) s where u <> new.organiser_id
  loop
    perform public.queue_email(r.u, new.id, 'new_match',
      'New match: ' || new.title || ' · ' || public.when_label(new),
      public.first_name(new.organiser_id) || ' set up ' || new.title || ' for ' || public.when_label(new)
        || coalesce(' at ' || nullif(new.venue, ''), '') || '.' || chr(10)
        || new.size || ' spots, ' || case when new.format = 'singles' then 'singles' else 'doubles' end
        || ' on ' || new.court_count || ' court' || case when new.court_count > 1 then 's' else '' end || '.' || chr(10)
        || case when new.regulars_until is not null then 'You get first dibs for 12 hours. ' else '' end
        || 'Tap to join.',
      '/m/' || new.slug);
  end loop;
  return null;
end $$;

drop trigger if exists matches_email_new on public.matches;
create trigger matches_email_new
  after insert on public.matches
  for each row execute function public.email_on_new_match();

-- ---------------------------------------------------------------------------
-- Sending emails (called by the app with the service key)
-- ---------------------------------------------------------------------------

-- Claim everything due and return it as ready-to-send emails. Joins and drop-outs
-- for the same person and match become one email.
create or replace function public.claim_due_emails() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  claimed public.email_outbox[];
  result jsonb;
begin
  with c as (
    update public.email_outbox set sent_at = now()
     where id in (select id from public.email_outbox
                   where sent_at is null and send_after <= now() and attempts < 5
                   order by created_at limit 200 for update skip locked)
    returning *
  )
  select array_agg(c order by c.created_at) into claimed from c;
  if claimed is null then return '[]'::jsonb; end if;

  with rows as (select * from unnest(claimed)),
  singles as (
    select jsonb_build_object('ids', jsonb_build_array(r.id), 'user_id', r.user_id, 'subject', r.subject,
             'body', r.body, 'url', r.url) as e, r.created_at as t
      from rows r where r.kind not in ('joined', 'left')
  ),
  batches as (
    select r.user_id, r.match_id, min(r.created_at) as t, jsonb_agg(r.id) as ids,
           string_agg(r.who, ', ' order by r.created_at) filter (where r.kind = 'joined') as joined,
           string_agg(r.who, ', ' order by r.created_at) filter (where r.kind = 'left') as left_,
           min(r.subject) as title, min(r.url) as url
      from rows r where r.kind in ('joined', 'left')
     group by r.user_id, r.match_id
  ),
  bundled as (
    select jsonb_build_object('ids', b.ids, 'user_id', b.user_id,
             'subject', b.title || ': ' || concat_ws(', ',
                 b.joined || ' joined', b.left_ || ' dropped out'),
             'body', concat_ws(chr(10),
                 case when b.joined is not null then 'Joined: ' || b.joined end,
                 case when b.left_ is not null then 'Dropped out: ' || b.left_ end,
                 (select 'Now ' || count(*) filter (where mp.status = 'confirmed') || '/' || m.size || ' in'
                         || case when count(*) filter (where mp.status = 'waitlist') > 0
                                 then ' · ' || count(*) filter (where mp.status = 'waitlist') || ' waiting' else '' end
                         || ' · ' || public.when_label(m)
                    from public.matches m left join public.match_players mp on mp.match_id = m.id
                   where m.id = b.match_id group by m.id)),
             'url', b.url) as e, b.t
      from batches b
  )
  select coalesce(jsonb_agg(x.e || jsonb_build_object(
           'to', p.email, 'name', p.full_name) order by x.t), '[]'::jsonb)
    into result
    from (select * from singles union all select * from bundled) x
    join public.profiles p on p.id = (x.e ->> 'user_id')::uuid
   where p.email_updates;
  return result;
end $$;

-- A send failed: put it back for the next sweep (gives up after 5 tries).
create or replace function public.unclaim_emails(p_ids uuid[], p_error text) returns void
language sql security definer set search_path = public as $$
  update public.email_outbox set sent_at = null, attempts = attempts + 1, error = left(p_error, 500)
   where id = any (p_ids);
$$;

-- Ask the app to send what's due (immediately for new rows; the sweep catches the rest).
create or replace function public.flush_emails() returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_url text := (select value from public.app_config where key = 'site_url');
  v_secret text := (select value from public.app_config where key = 'push_secret');
begin
  if v_url is null or v_secret is null or to_regproc('net.http_post') is null then return false; end if;
  if not exists (select 1 from public.email_outbox where sent_at is null and send_after <= now() and attempts < 5) then
    return false;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using v_url || '/api/email', jsonb_build_object('type', 'SEND'),
          jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret);
  return true;
exception when others then
  return false;
end $$;

create or replace function public.send_emails_now() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.flush_emails();
  return null;
end $$;

drop trigger if exists email_outbox_send_now on public.email_outbox;
create trigger email_outbox_send_now
  after insert on public.email_outbox
  for each statement execute function public.send_emails_now();

create or replace function public.run_scheduled() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.roll_recurring();
  perform public.send_reminders();
  perform public.flush_alerts();
  perform public.flush_emails();
  delete from public.app_errors where created_at < now() - interval '30 days';
  delete from public.reminders_sent where sent_at < now() - interval '60 days';
  delete from public.email_outbox where created_at < now() - interval '30 days';
end $$;

-- ---------------------------------------------------------------------------
-- The switch on Home
-- ---------------------------------------------------------------------------

create or replace function public.get_email_updates() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('on', email_updates, 'email', email) from public.profiles where id = auth.uid();
$$;

create or replace function public.set_email_updates(p_on boolean) returns void
language sql security definer set search_path = public as $$
  update public.profiles set email_updates = coalesce(p_on, true) where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.queue_email(uuid, uuid, text, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.match_members(uuid) from public, anon, authenticated;
revoke all on function public.email_on_player_change() from public, anon, authenticated;
revoke all on function public.email_on_court_booked() from public, anon, authenticated;
revoke all on function public.email_on_new_match() from public, anon, authenticated;
revoke all on function public.claim_due_emails() from public, anon, authenticated;
revoke all on function public.unclaim_emails(uuid[], text) from public, anon, authenticated;
revoke all on function public.flush_emails() from public, anon, authenticated;
revoke all on function public.send_emails_now() from public, anon, authenticated;
revoke all on function public.get_email_updates() from public, anon;
revoke all on function public.set_email_updates(boolean) from public, anon;
grant execute on function public.get_email_updates() to authenticated;
grant execute on function public.set_email_updates(boolean) to authenticated;
-- The app's server (service key) claims and sends emails.
do $$ begin
  if exists (select from pg_roles where rolname = 'service_role') then
    grant execute on function public.claim_due_emails() to service_role;
    grant execute on function public.unclaim_emails(uuid[], text) to service_role;
    grant select, update on table public.profiles to service_role;
  end if;
end $$;
