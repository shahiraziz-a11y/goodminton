-- 1. Repairs databases where 0005 (push alerts) was skipped. Running 0005 late fails,
--    because 0007 already replaced one of its functions; this adds whatever is missing
--    and is safe to run whether or not 0005 ran.
-- 2. Home screen groups: my_matches also returns whether the match has started, the
--    court numbers for confirmed players, and who won the latest game logged for it.
-- Run once, after 0007. Safe to run again.

do $$ begin
  if to_regprocedure('public.apply_court_count(uuid, integer)') is null then
    raise exception 'Run 0006_book_some_courts.sql first, then 0007, then this file.';
  end if;
  if to_regprocedure('public.payer_for(public.matches, uuid)') is null then
    raise exception 'Run 0007_anyone_adds_players_guest_billing.sql first, then this file.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Push alerts (from 0005)
-- ---------------------------------------------------------------------------

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  match_id uuid references public.matches (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  url text not null default '/',
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  devices int
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;

-- ---------------------------------------------------------------------------
-- Subscriptions (called from the browser)
-- ---------------------------------------------------------------------------

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.require_user();
begin
  if p_endpoint !~ '^https://' then raise exception 'Invalid push endpoint'; end if;
  -- An endpoint belongs to one device; if someone else signs in on it, it moves to them.
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (me, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
     set user_id = me, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end $$;

create or replace function public.delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Writing alerts
-- ---------------------------------------------------------------------------

create or replace function public.when_label(m public.matches) returns text
language sql stable as $$
  select to_char(m.starts_at at time zone m.timezone, 'Dy FMDD Mon, FMHH12:MI AM');
$$;

-- Queue one alert, skipping guests, the person who caused it, and anyone without a device.
create or replace function public.notify(p_user uuid, m public.matches, p_kind text, p_title text, p_body text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  if not exists (select 1 from public.push_subscriptions where user_id = p_user) then return; end if;
  insert into public.notifications (user_id, match_id, kind, title, body, url)
  values (p_user, m.id, p_kind, p_title, p_body, '/m/' || m.slug);
end $$;

create or replace function public.first_name(p_user uuid) returns text
language sql stable set search_path = public as $$
  select split_part(full_name, ' ', 1) from public.profiles where id = p_user;
$$;

drop trigger if exists match_players_notify on public.match_players;
create trigger match_players_notify
  after insert or update of status or delete on public.match_players
  for each row execute function public.on_player_change();

-- Booking, new courts, time changes.
create or replace function public.on_match_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if public.match_past(new) then return null; end if;
  for r in select user_id, status from public.match_players where match_id = new.id and user_id <> new.organiser_id loop
    if old.status = 'planning' and new.status = 'booked' and r.status = 'confirmed' then
      perform public.notify(r.user_id, new, 'booked', 'Court booked 🏸',
        new.title || ' · ' || public.when_label(new) || ' · ' || new.venue
        || case when new.courts <> '' then ' · ' || new.courts else '' end);
    end if;
    if new.court_count > old.court_count and r.status = 'confirmed' then
      perform public.notify(r.user_id, new, 'court_added', 'Another court added',
        new.title || ' is now ' || new.size || ' players on ' || new.court_count || ' courts.');
    end if;
    if new.starts_at <> old.starts_at then
      perform public.notify(r.user_id, new, 'rescheduled', 'Time changed',
        new.title || ' is now ' || public.when_label(new) || '.');
    end if;
  end loop;
  return null;
end $$;

drop trigger if exists matches_notify on public.matches;
create trigger matches_notify
  after update of status, court_count, starts_at on public.matches
  for each row execute function public.on_match_change();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on all functions in schema public from public, anon;
revoke all on function public.notify(uuid, public.matches, text, text, text) from authenticated;
revoke all on function public.on_player_change() from authenticated;
revoke all on function public.on_match_change() from authenticated;
revoke all on function public.when_label(public.matches) from authenticated;
revoke all on function public.first_name(uuid) from authenticated;
revoke all on table public.push_subscriptions, public.notifications from anon, authenticated;
grant execute on function public.get_match(text) to anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Home screen groups
-- ---------------------------------------------------------------------------

create or replace function public.my_matches() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.past, case when x.past then null else x.starts_at end, x.starts_at desc), '[]'::jsonb)
  from (
    select m.slug, m.title, m.venue, m.size, m.format, m.court_count, m.starts_at, m.duration_min, m.timezone, m.status,
           now() >= m.starts_at as started,
           public.match_past(m) as past, public.match_locked(m) as locked,
           (select count(*) from public.match_players where match_id = m.id and status = 'confirmed') as confirmed_count,
           (select count(*) from public.match_players where match_id = m.id and status = 'waitlist') as waitlist_count,
           case when m.organiser_id = auth.uid()
                  or exists (select 1 from public.match_players where match_id = m.id and user_id = auth.uid() and status = 'confirmed')
                then m.courts end as courts,
           (select count(*) from public.games where match_id = m.id) as games_count,
           (select string_agg(public.first_name(w), ' & ')
              from (select g.* from public.games g where g.match_id = m.id order by g.created_at desc limit 1) g,
                   unnest(case when g.winner = 'a' then array[g.a1, g.a2] else array[g.b1, g.b2] end) w
             where w is not null) as last_winners
      from public.matches m
     where m.organiser_id = auth.uid()
        or exists (select 1 from public.match_players where match_id = m.id and user_id = auth.uid())
  ) x;
$$;
