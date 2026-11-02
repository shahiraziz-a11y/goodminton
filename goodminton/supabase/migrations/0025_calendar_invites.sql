-- Calendar invites: confirmed players get the match in their calendar by email
-- (Gmail adds it to Google Calendar). It moves when the match changes and goes away
-- when they drop out. Sent with the other emails, so the same on/off switch applies.
-- Run once, after 0024. Safe to run again.

do $$ begin
  if to_regprocedure('public.merge_player(uuid, uuid)') is null then
    raise exception 'Run 0024_merge_settle_guests.sql first, then this file.';
  end if;
end $$;

-- The event as it was when queued: uid, method, sequence, start, end, title, location, url.
alter table public.email_outbox add column if not exists cal jsonb;

-- Queue an invite (or a cancel) for one person and one upcoming match. A newer one
-- replaces anything still unsent for the same match, so bursts send once.
create or replace function public.queue_calendar(p_user uuid, m public.matches, p_cancel boolean, p_keep_match boolean default true)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_uid text := m.id || '@goodminton.app';
  v_when text := public.when_label(m);
begin
  if p_user is null or m.starts_at <= now() then return false; end if;
  if not exists (select 1 from public.profiles where id = p_user and not is_guest and email_updates
                 and coalesce(email, '') like '%@%') then
    return false;
  end if;
  delete from public.email_outbox
   where user_id = p_user and kind = 'calendar' and sent_at is null and cal ->> 'uid' = v_uid;
  insert into public.email_outbox (user_id, match_id, kind, subject, body, url, cal)
  values (p_user, case when p_keep_match then m.id end, 'calendar',
          case when p_cancel then 'Cancelled: ' || m.title || ' · ' || v_when else '🏸 ' || m.title || ' · ' || v_when end,
          case when p_cancel then 'You''re no longer playing. It''s been taken off your calendar.'
               else concat_ws(chr(10), v_when, nullif(concat_ws(' · ', nullif(m.venue, ''), 'Court ' || nullif(m.courts, '')), '')) end,
          '/m/' || m.slug,
          jsonb_build_object(
            'uid', v_uid,
            'method', case when p_cancel then 'CANCEL' else 'REQUEST' end,
            -- Always increasing, so calendars take the newest version.
            'sequence', floor(extract(epoch from clock_timestamp()) - 1767225600)::int,
            'start', m.starts_at, 'end', m.starts_at + make_interval(mins => m.duration_min),
            'title', m.title,
            'location', concat_ws(' · ', nullif(m.venue, ''), 'Court ' || nullif(m.courts, '')),
            'url', '/m/' || m.slug));
  return true;
end $$;

-- Becoming confirmed adds it; leaving (or moving to the waitlist) takes it off.
create or replace function public.calendar_on_player() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
  was boolean := tg_op <> 'INSERT' and old.status = 'confirmed';
  now_in boolean := tg_op <> 'DELETE' and new.status = 'confirmed';
begin
  if was = now_in then return null; end if;
  select * into m from public.matches where id = coalesce(new.match_id, old.match_id);
  if not found then return null; end if;  -- the match itself is being deleted
  perform public.queue_calendar(coalesce(new.user_id, old.user_id), m, not now_in);
  return null;
end $$;
drop trigger if exists match_players_calendar on public.match_players;
create trigger match_players_calendar after insert or update of status or delete on public.match_players
  for each row execute function public.calendar_on_player();

-- The match moved, or its name or place changed: everyone confirmed gets the update.
create or replace function public.calendar_on_match() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if (new.starts_at, new.duration_min, new.title, new.venue, new.courts)
     is not distinct from (old.starts_at, old.duration_min, old.title, old.venue, old.courts) then
    return null;
  end if;
  for r in select user_id from public.match_players where match_id = new.id and status = 'confirmed' loop
    perform public.queue_calendar(r.user_id, new, false);
  end loop;
  return null;
end $$;
drop trigger if exists matches_calendar on public.matches;
create trigger matches_calendar after update on public.matches
  for each row execute function public.calendar_on_match();

-- A match is deleted (e.g. an empty future week when repeating stops): cancel it.
-- The cancel isn't tied to the match row, or the delete would take it too.
create or replace function public.calendar_on_match_delete() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select user_id from public.match_players where match_id = old.id and status = 'confirmed' loop
    perform public.queue_calendar(r.user_id, old, true, false);
  end loop;
  return old;
end $$;
drop trigger if exists matches_calendar_delete on public.matches;
create trigger matches_calendar_delete before delete on public.matches
  for each row execute function public.calendar_on_match_delete();

-- Sending: same as before, plus the calendar event for calendar emails.
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
    select jsonb_strip_nulls(jsonb_build_object('ids', jsonb_build_array(r.id), 'user_id', r.user_id, 'subject', r.subject,
             'body', r.body, 'url', r.url, 'cal', r.cal)) as e, r.created_at as t
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

-- Upcoming matches people are already in go on their calendars once.
do $$
declare r record;
begin
  if not exists (select 1 from public.email_outbox where kind = 'calendar') then
    for r in select mp.user_id, m from public.match_players mp join public.matches m on m.id = mp.match_id
              where mp.status = 'confirmed' and m.starts_at > now() loop
      perform public.queue_calendar(r.user_id, r.m, false);
    end loop;
  end if;
end $$;

revoke all on function public.queue_calendar(uuid, public.matches, boolean, boolean) from public, anon, authenticated;
revoke all on function public.calendar_on_player() from public, anon, authenticated;
revoke all on function public.calendar_on_match() from public, anon, authenticated;
revoke all on function public.calendar_on_match_delete() from public, anon, authenticated;
revoke all on function public.claim_due_emails() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.claim_due_emails() to service_role;
  end if;
end $$;
