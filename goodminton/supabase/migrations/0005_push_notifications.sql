-- Push notifications: device subscriptions, and an outbox of alerts written by triggers
-- at the moment something happens. A Supabase Database Webhook on inserts into
-- public.notifications calls the app's /api/push route, which delivers them.
-- Run once, after 0004.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;

create table public.notifications (
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
create index notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;

-- ---------------------------------------------------------------------------
-- Subscriptions (called from the browser)
-- ---------------------------------------------------------------------------

create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
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

create function public.delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Writing alerts
-- ---------------------------------------------------------------------------

create function public.when_label(m public.matches) returns text
language sql stable as $$
  select to_char(m.starts_at at time zone m.timezone, 'Dy FMDD Mon, FMHH12:MI AM');
$$;

-- Queue one alert, skipping guests, the person who caused it, and anyone without a device.
create function public.notify(p_user uuid, m public.matches, p_kind text, p_title text, p_body text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  if not exists (select 1 from public.push_subscriptions where user_id = p_user) then return; end if;
  insert into public.notifications (user_id, match_id, kind, title, body, url)
  values (p_user, m.id, p_kind, p_title, p_body, '/m/' || m.slug);
end $$;

create function public.first_name(p_user uuid) returns text
language sql stable set search_path = public as $$
  select split_part(full_name, ' ', 1) from public.profiles where id = p_user;
$$;

-- Joins, promotions, demotions, removals.
create function public.on_player_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
  n_conf int;
  n_wait int;
  actor uuid := auth.uid();
begin
  select * into m from public.matches where id = coalesce(new.match_id, old.match_id);
  if not found or public.match_past(m) then return null; end if;
  select count(*) filter (where status = 'confirmed'), count(*) filter (where status = 'waitlist')
    into n_conf, n_wait from public.match_players where match_id = m.id;

  if tg_op = 'INSERT' and new.user_id <> m.organiser_id then
    if actor = m.organiser_id then
      perform public.notify(new.user_id, m, 'added', public.first_name(m.organiser_id) || ' added you to ' || m.title,
        case when new.status = 'confirmed' then 'You''re in · ' else 'You''re on the waitlist · ' end || public.when_label(m));
    else
      perform public.notify(m.organiser_id, m, 'joined',
        public.first_name(new.user_id) || case when new.status = 'confirmed' then ' joined ' else ' joined the waitlist for ' end || m.title,
        n_conf || '/' || m.size || ' confirmed' || case when n_wait > 0 then ' · ' || n_wait || ' waiting' else '' end);
      if new.status = 'confirmed' and n_conf = m.size then
        perform public.notify(m.organiser_id, m, 'full', m.title || ' is full',
          m.size || '/' || m.size || ' confirmed.' || case when m.status = 'planning' then ' Time to book the court.' else '' end);
      end if;
    end if;

  elsif tg_op = 'UPDATE' and old.status = 'waitlist' and new.status = 'confirmed' then
    perform public.notify(new.user_id, m, 'promoted', 'You''re in! 🏸',
      'A spot opened in ' || m.title || ' · ' || public.when_label(m));

  elsif tg_op = 'UPDATE' and old.status = 'confirmed' and new.status = 'waitlist' then
    perform public.notify(new.user_id, m, 'demoted', 'Moved to the waitlist',
      m.title || ' now has ' || m.size || ' spots. You''re near the front of the line.');

  elsif tg_op = 'DELETE' and actor = old.user_id then
    perform public.notify(m.organiser_id, m, 'left',
      public.first_name(old.user_id) || case when old.status = 'confirmed' then ' dropped out of ' else ' left the waitlist for ' end || m.title,
      n_conf || '/' || m.size || ' confirmed' || case when n_wait > 0 then ' · ' || n_wait || ' waiting' else '' end);

  elsif tg_op = 'DELETE' and actor = m.organiser_id and old.user_id <> m.organiser_id then
    perform public.notify(old.user_id, m, 'removed', 'Removed from ' || m.title,
      public.first_name(m.organiser_id) || ' removed you from the match.'
      || case when old.status = 'confirmed' and m.status = 'booked'
              then ' The court is booked, so you still owe your share unless someone takes your spot.' else '' end);
  end if;
  return null;
end $$;

create trigger match_players_notify
  after insert or update of status or delete on public.match_players
  for each row execute function public.on_player_change();

-- Booking, new courts, time changes.
create function public.on_match_change() returns trigger
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
