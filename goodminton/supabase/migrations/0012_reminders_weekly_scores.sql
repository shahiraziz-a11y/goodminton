-- 1. Alerts that reach people: the database sends each new alert to the app
--    straight away (no webhook needed), a 5-minute sweep retries any that failed,
--    and a test alert to check it all works.
-- 2. Reminders on a schedule: the day before and 2 hours before a match, the
--    organiser when sign-ups close with an unbooked court, and a weekly nudge to
--    anyone who owes money.
-- 3. Weekly matches: "repeat every week" makes next week's match automatically,
--    optionally giving last week's players first dibs for 12 hours.
-- 4. Scores: games can record the score.
-- 5. Errors from people's phones are recorded (app_errors), kept 30 days.
-- The schedule needs Supabase's pg_cron and pg_net (turned on below where available).
-- Run once, after 0011. Safe to run again.

do $$ begin
  if to_regprocedure('public.keep_last_pairing()') is null then
    raise exception 'Run 0011_organiser_can_drop_out.sql first, then this file.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Settings the schedule needs (site address and push secret). Private.
-- ---------------------------------------------------------------------------

create table if not exists public.app_config (key text primary key, value text not null);
alter table public.app_config enable row level security;
revoke all on table public.app_config from anon, authenticated;

-- One-time setup from the SQL editor:
--   select public.set_alert_config('https://your-app.vercel.app', 'your PUSH_WEBHOOK_SECRET');
create or replace function public.set_alert_config(p_site_url text, p_push_secret text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if p_site_url !~ '^https://' then raise exception 'Use the full https:// address of the app'; end if;
  if coalesce(length(p_push_secret), 0) < 16 then raise exception 'Paste the PUSH_WEBHOOK_SECRET from Vercel'; end if;
  insert into public.app_config values ('site_url', rtrim(p_site_url, '/')) on conflict (key) do update set value = excluded.value;
  insert into public.app_config values ('push_secret', p_push_secret) on conflict (key) do update set value = excluded.value;
  return 'Saved. New alerts are sent straight away, and retried every 5 minutes if needed.';
end $$;

-- ---------------------------------------------------------------------------
-- 1. Test alert and delivery sweep
-- ---------------------------------------------------------------------------

create or replace function public.send_test_alert() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  v_id uuid;
begin
  if not exists (select 1 from public.push_subscriptions where user_id = me) then
    raise exception 'Turn on alerts on this device first';
  end if;
  insert into public.notifications (user_id, kind, title, body, url)
  values (me, 'test', 'Alerts are working 🏸', 'You''ll hear about bookings, spots opening and reminders.', '/')
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.alert_status(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('sent', sent_at is not null, 'devices', devices)
    from public.notifications where id = p_id and user_id = auth.uid();
$$;

-- Ask the app to send anything still unsent (the webhook normally does it at once).
create or replace function public.flush_alerts() returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_url text := (select value from public.app_config where key = 'site_url');
  v_secret text := (select value from public.app_config where key = 'push_secret');
begin
  if v_url is null or v_secret is null or to_regproc('net.http_post') is null then return false; end if;
  if not exists (select 1 from public.notifications
                  where sent_at is null and created_at < now() - interval '30 seconds'
                    and created_at > now() - interval '1 day') then
    return false;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using v_url || '/api/push', jsonb_build_object('type', 'FLUSH'),
          jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret);
  return true;
end $$;

-- Send each new alert straight away: the database calls the app itself (no Supabase
-- webhook needed). If a webhook is also set up, the app sends each alert only once.
create or replace function public.send_alert_now() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_url text := (select value from public.app_config where key = 'site_url');
  v_secret text := (select value from public.app_config where key = 'push_secret');
begin
  if v_url is null or v_secret is null or to_regproc('net.http_post') is null then return null; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using v_url || '/api/push',
          jsonb_build_object('type', 'INSERT', 'table', 'notifications', 'record', to_jsonb(new)),
          jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret);
  return null;
exception when others then
  return null; -- never block the action that caused the alert; the 5-minute sweep retries
end $$;

drop trigger if exists notifications_send_now on public.notifications;
create trigger notifications_send_now
  after insert on public.notifications
  for each row execute function public.send_alert_now();

-- ---------------------------------------------------------------------------
-- 2. Reminders
-- ---------------------------------------------------------------------------

create table if not exists public.reminders_sent (key text primary key, sent_at timestamptz not null default now());
alter table public.reminders_sent enable row level security;
revoke all on table public.reminders_sent from anon, authenticated;

-- Queue an alert once per key (and only for people with a device).
create or replace function public.remind_once(p_key text, p_user uuid, p_match uuid, p_kind text, p_title text, p_body text, p_url text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.push_subscriptions where user_id = p_user) then return false; end if;
  insert into public.reminders_sent (key) values (p_key) on conflict do nothing;
  if not found then return false; end if;
  insert into public.notifications (user_id, match_id, kind, title, body, url)
  values (p_user, p_match, p_kind, p_title, p_body, p_url);
  return true;
end $$;

-- Each person's balance per match: paid - shares + settlements (negative: they owe).
create or replace function public.match_balances() returns table (match_id uuid, user_id uuid, currency text, net numeric)
language sql stable security definer set search_path = public as $$
  with s as (select m.id, m.currency, public.split_ids(m.id) ids,
                    (select coalesce(sum(amount), 0) from public.expenses e where e.match_id = m.id) total
               from public.matches m where public.split_ready(m.id)),
  people as (select id, currency, unnest(ids) u from s
             union select s.id, s.currency, e.paid_by from s join public.expenses e on e.match_id = s.id)
  select p.id, p.u, p.currency, round(
      (select coalesce(sum(amount), 0) from public.expenses e where e.match_id = p.id and e.paid_by = p.u)
    - (select total / greatest(cardinality(ids), 1) * (select count(*) from unnest(ids) x where x = p.u) from s where s.id = p.id)
    + (select coalesce(sum(amount), 0) from public.settlements t where t.match_id = p.id and t.from_user = p.u)
    - (select coalesce(sum(amount), 0) from public.settlements t where t.match_id = p.id and t.to_user = p.u), 2)
  from people p;
$$;

create or replace function public.send_reminders(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
  r record;
  sent int := 0;
  place text;
  open_courts text;
  week text := to_char(p_now at time zone 'Asia/Dubai', 'IYYY-IW');
begin
  for m in select * from public.matches where starts_at > p_now and starts_at < p_now + interval '25 hours' loop
    place := concat_ws(' · ', nullif(m.venue, ''), nullif(m.courts, ''));
    -- The day before (from 24h out until 3h out, so a late first run still sends it once).
    if p_now >= m.starts_at - interval '24 hours' and p_now < m.starts_at - interval '3 hours'
       and m.created_at < p_now - interval '1 hour' then
      for r in select user_id from public.match_players where match_id = m.id and status = 'confirmed' loop
        if public.remind_once('day:' || m.id || ':' || r.user_id, r.user_id, m.id, 'reminder_day',
             '🏸 ' || m.title || ' · ' || public.when_label(m),
             case when m.status = 'booked' then coalesce(nullif(place, ''), 'Court booked') else 'Court not booked yet' end
             || ' · You''re playing.', '/m/' || m.slug) then sent := sent + 1; end if;
      end loop;
    end if;
    -- 2 hours before.
    if p_now >= m.starts_at - interval '2 hours' then
      for r in select user_id from public.match_players where match_id = m.id and status = 'confirmed' loop
        if public.remind_once('2h:' || m.id || ':' || r.user_id, r.user_id, m.id, 'reminder_soon',
             m.title || ' starts at ' || to_char(m.starts_at at time zone m.timezone, 'FMHH12:MI AM'),
             coalesce(nullif(place, ''), 'Venue TBC'), '/m/' || m.slug) then sent := sent + 1; end if;
      end loop;
    end if;
    -- Sign-ups have closed and a court with players isn't booked: tell the organiser.
    if public.match_locked(m) then
      select string_agg('court ' || c, ', ' order by c) into open_courts
        from generate_series(1, m.court_count) c
       where not public.court_booked(m.id, c)
         and exists (select 1 from public.match_players where match_id = m.id and status = 'confirmed' and court = c);
      if open_courts is not null and public.remind_once('book:' || m.id, m.organiser_id, m.id, 'reminder_book',
           'Book ' || open_courts || ' for ' || m.title,
           'Sign-ups have closed and ' || open_courts || ' isn''t booked yet. Players can still drop out until it is.',
           '/m/' || m.slug) then sent := sent + 1; end if;
    end if;
  end loop;

  -- Mondays from 10am (Dubai): one nudge a week to anyone who owes money.
  if extract(isodow from p_now at time zone 'Asia/Dubai') = 1 and extract(hour from p_now at time zone 'Asia/Dubai') >= 10 then
    for r in
      select b.user_id, b.currency, -sum(b.net) as owed, count(*) as n
        from public.match_balances() b join public.profiles p on p.id = b.user_id and not p.is_guest
       where b.net < -0.5
       group by b.user_id, b.currency
    loop
      if public.remind_once('debt:' || week || ':' || r.user_id || ':' || r.currency, r.user_id, null, 'reminder_debt',
           'You owe ' || r.currency || ' ' || trim_scale(round(r.owed, 2)),
           'From ' || r.n || ' match' || case when r.n > 1 then 'es' else '' end || '. Tap to see who to pay.', '/balances') then
        sent := sent + 1;
      end if;
    end loop;
  end if;
  return sent;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Weekly matches
-- ---------------------------------------------------------------------------

alter table public.matches add column if not exists repeat_weekly boolean not null default false;
alter table public.matches add column if not exists regulars_first boolean not null default false;
alter table public.matches add column if not exists series_id uuid;
alter table public.matches add column if not exists regulars uuid[] not null default '{}';
alter table public.matches add column if not exists regulars_until timestamptz;

create or replace function public.set_repeat(p_match uuid, p_weekly boolean, p_regulars_first boolean) returns void
language plpgsql security definer set search_path = public as $$
declare m public.matches := public.lock_match(p_match);
begin
  perform public.require_organiser(m);
  update public.matches set repeat_weekly = coalesce(p_weekly, false),
         regulars_first = coalesce(p_weekly, false) and coalesce(p_regulars_first, false)
   where id = m.id;
end $$;

-- Once a weekly match starts, make next week's: same name, format, courts, venue,
-- time and organiser. Nothing is booked. Last week's players are told.
create or replace function public.roll_recurring(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
  n public.matches;
  made int := 0;
  r record;
  v_series uuid;
  v_regulars uuid[];
begin
  for m in
    select * from public.matches
     where repeat_weekly and starts_at <= p_now and starts_at > p_now - interval '7 days'
  loop
    v_series := coalesce(m.series_id, m.id);
    continue when exists (select 1 from public.matches x
                           where coalesce(x.series_id, x.id) = v_series and x.starts_at = m.starts_at + interval '7 days');
    -- Next week's copy takes over the repeat; this one stops.
    update public.matches set repeat_weekly = false where id = m.id;
    select coalesce(array_agg(mp.user_id order by mp.seq), '{}') into v_regulars
      from public.match_players mp join public.profiles p on p.id = mp.user_id
     where mp.match_id = m.id and mp.status = 'confirmed' and not p.is_guest;
    insert into public.matches (slug, organiser_id, title, format, court_count, size, venue, parking, starts_at,
                                duration_min, rsvp_close_hours, court_cost, currency, timezone,
                                repeat_weekly, regulars_first, series_id, regulars, regulars_until)
    values (coalesce(nullif(left(trim(both '-' from regexp_replace(lower(m.title), '[^a-z0-9]+', '-', 'g')), 24), ''), 'match')
              || '-' || substr(md5(gen_random_uuid()::text), 1, 6),
            m.organiser_id, m.title, m.format, m.court_count, m.size, m.venue, m.parking, m.starts_at + interval '7 days',
            m.duration_min, m.rsvp_close_hours, m.court_cost, m.currency, m.timezone,
            true, m.regulars_first, v_series, v_regulars,
            case when m.regulars_first then p_now + interval '12 hours' end)
    returning * into n;
    if m.organiser_id = any (v_regulars) then
      insert into public.match_players (match_id, user_id, status) values (n.id, m.organiser_id, 'confirmed');
    end if;
    for r in select unnest(v_regulars) as u loop
      perform public.notify(r.u, n, 'repeat', n.title || ' next week is open',
        public.when_label(n) || case when n.regulars_first then ' · You get first dibs for 12 hours.' else ' · Tap to join.' end);
    end loop;
    made := made + 1;
  end loop;

  -- First-dibs window over: free spots go to the waitlist, in order.
  for n in select * from public.matches where regulars_until is not null and regulars_until <= p_now loop
    update public.matches set regulars_until = null where id = n.id;
    perform public.fill_from_waitlist(n);
  end loop;
  return made;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Errors reported by the app (written by the server with the service key).
--    See them: select * from public.app_errors order by created_at desc limit 50;
-- ---------------------------------------------------------------------------

create table if not exists public.app_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid,
  page text,
  message text not null,
  detail text,
  user_agent text
);
create index if not exists app_errors_created_idx on public.app_errors (created_at desc);
alter table public.app_errors enable row level security;
revoke all on table public.app_errors from anon, authenticated;

create or replace function public.run_scheduled() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.roll_recurring();
  perform public.send_reminders();
  perform public.flush_alerts();
  delete from public.app_errors where created_at < now() - interval '30 days';
  delete from public.reminders_sent where sent_at < now() - interval '60 days';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Scores
-- ---------------------------------------------------------------------------

alter table public.games add column if not exists score_a smallint check (score_a between 0 and 99);
alter table public.games add column if not exists score_b smallint check (score_b between 0 and 99);

drop function if exists public.log_game(uuid, uuid, uuid, uuid, uuid, text);
create or replace function public.log_game(p_match uuid, p_a1 uuid, p_a2 uuid, p_b1 uuid, p_b2 uuid, p_winner text,
  p_score_a int default null, p_score_b int default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  m public.matches;
  v_id uuid;
  v_date date := current_date;
  ids uuid[] := array_remove(array[p_a1, p_a2, p_b1, p_b2], null);
begin
  if p_winner not in ('a', 'b') then raise exception 'Tap the side that won'; end if;
  -- Scores are optional; if given, both sides, and the winner scored more.
  if (p_score_a is null) <> (p_score_b is null) then raise exception 'Enter both scores, or neither'; end if;
  if p_score_a is not null and (p_score_a not between 0 and 99 or p_score_b not between 0 and 99) then
    raise exception 'Scores are 0 to 99';
  end if;
  if p_score_a is not null and (p_score_a = p_score_b or (p_score_a > p_score_b) <> (p_winner = 'a')) then
    raise exception 'The winning side needs the higher score';
  end if;
  if (p_a2 is null) <> (p_b2 is null) or p_a1 is null or p_b1 is null then
    raise exception 'Pick the same number of players on each side';
  end if;
  if p_match is not null then
    select * into m from public.matches where id = p_match;
    if not found then raise exception 'Match not found'; end if;
    if me <> m.organiser_id and not exists (
      select 1 from public.match_players where match_id = m.id and user_id = me and status = 'confirmed') then
      raise exception 'Only players in this match can log results';
    end if;
    if (select count(*) from public.match_players
         where match_id = m.id and status = 'confirmed' and user_id = any (ids)) <> array_length(ids, 1) then
      raise exception 'All players must be confirmed in this match';
    end if;
    v_date := (m.starts_at at time zone m.timezone)::date;
  elsif exists (select x from unnest(ids) x where x not in (select public.circle_of(me))) then
    raise exception 'You can only log games with people you''ve played with';
  end if;

  insert into public.games (match_id, created_by, played_on, a1, a2, b1, b2, winner, score_a, score_b)
  values (p_match, me, v_date, p_a1, p_a2, p_b1, p_b2, p_winner, p_score_a, p_score_b)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.get_leaderboard() returns jsonb
language sql stable security definer set search_path = public as $$
  with circle as (select public.circle_of(auth.uid()) as id),
  g as (
    select g.*, m.title as match_title from public.games g
      left join public.matches m on m.id = g.match_id
     where g.created_by in (select id from circle)
        or auth.uid() in (g.a1, g.a2, g.b1, g.b2)
     order by g.played_on desc, g.created_at desc
     limit 1000
  )
  select jsonb_build_object(
    'games', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'played_on', played_on, 'match_title', match_title, 'created_by', created_by,
        'a', case when a2 is null then jsonb_build_array(a1) else jsonb_build_array(a1, a2) end,
        'b', case when b2 is null then jsonb_build_array(b1) else jsonb_build_array(b1, b2) end,
        'winner', winner, 'score_a', score_a, 'score_b', score_b)
        order by played_on desc, created_at desc) from g), '[]'::jsonb),
    'people', coalesce((select jsonb_object_agg(p.id, p.full_name) from public.profiles p
        where p.id in (select x from g, unnest(array[a1, a2, b1, b2]) x where x is not null)), '{}'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- Changed reads and writes
-- ---------------------------------------------------------------------------

create or replace function public.join_match(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  m public.matches := public.lock_match(p_match);
  n_conf int;
  n_wait int;
begin
  if exists (select 1 from public.match_players where match_id = m.id and user_id = me) then
    raise exception 'You''re already in this match';
  end if;
  if public.match_past(m) then raise exception 'This match has already been played'; end if;
  if public.match_locked(m) and me <> m.organiser_id then raise exception 'Sign-ups are closed'; end if;

  select count(*) filter (where status = 'confirmed'), count(*) filter (where status = 'waitlist')
    into n_conf, n_wait from public.match_players where match_id = m.id;

  -- A weekly match's regulars get first dibs: others wait until the window ends.
  if m.regulars_until is not null and now() < m.regulars_until and me <> m.organiser_id and not (me = any (m.regulars)) then
    insert into public.match_players (match_id, user_id, status) values (m.id, me, 'waitlist');
    return jsonb_build_object('status', 'waitlist', 'position', n_wait + 1, 'filled', false, 'regulars_until', m.regulars_until);
  end if;
  if n_conf < m.size then
    insert into public.match_players (match_id, user_id, status) values (m.id, me, 'confirmed');
    return jsonb_build_object('status', 'confirmed', 'filled', n_conf + 1 = m.size);
  end if;
  insert into public.match_players (match_id, user_id, status) values (m.id, me, 'waitlist');
  return jsonb_build_object('status', 'waitlist', 'position', n_wait + 1, 'filled', false);
end $$;

create or replace function public.get_match(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  m public.matches;
  me uuid := auth.uid();
  my_status text;
  wait_pos int;
  n_conf int;
  n_wait int;
  is_org boolean;
  can_see boolean;
  show_names boolean;
  role text;
begin
  select * into m from public.matches where slug = p_slug;
  if not found then return null; end if;

  is_org := me is not null and me = m.organiser_id;
  select status into my_status from public.match_players where match_id = m.id and user_id = me;
  select count(*) filter (where status = 'confirmed'), count(*) filter (where status = 'waitlist')
    into n_conf, n_wait from public.match_players where match_id = m.id;
  if my_status = 'waitlist' then
    select count(*) + 1 into wait_pos from public.match_players
     where match_id = m.id and status = 'waitlist'
       and seq < (select seq from public.match_players where match_id = m.id and user_id = me);
  end if;

  can_see := is_org or my_status = 'confirmed';
  -- Names are always public (anyone with the link); court numbers and costs are not.
  show_names := true;
  role := case
    when me is null then 'anon'
    when is_org then 'organiser'
    when my_status is not null then my_status
    else 'outsider'
  end;

  return jsonb_build_object(
    'id', m.id, 'slug', m.slug, 'title', m.title, 'size', m.size, 'venue', m.venue,
    'format', m.format, 'court_count', m.court_count, 'status', m.status,
    'starts_at', m.starts_at, 'duration_min', m.duration_min, 'rsvp_close_hours', m.rsvp_close_hours,
    'court_cost', m.court_cost, 'currency', m.currency, 'timezone', m.timezone,
    'lock_state', m.lock_state, 'locked', public.match_locked(m), 'past', public.match_past(m),
    'created_at', m.created_at,
    'courts', case when can_see then m.courts end,
    'parking', case when can_see then m.parking end,
    'organiser', (select jsonb_build_object('id', p.id, 'full_name', p.full_name)
                    from public.profiles p where p.id = m.organiser_id),
    'viewer', jsonb_build_object(
      'id', me, 'role', role, 'wait_pos', wait_pos,
      -- My place on the player list: confirmed, waitlist or null (an organiser may not be playing).
      'status', my_status,
      'full_name', (select full_name from public.profiles where id = me)),
    'confirmed_count', n_conf,
    'waitlist_count', n_wait,
    'players', coalesce((
      select jsonb_agg(case when show_names then jsonb_build_object(
               'id', p.id, 'full_name', p.full_name, 'promoted', mp.promoted, 'joined_at', mp.joined_at,
               'is_guest', p.is_guest)
             else jsonb_build_object('hidden', true) end || jsonb_build_object('court', mp.court) order by mp.court, mp.seq)
        from public.match_players mp join public.profiles p on p.id = mp.user_id
       where mp.match_id = m.id and mp.status = 'confirmed'), '[]'::jsonb),
    'waitlist', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'is_guest', p.is_guest) order by mp.seq)
        from public.match_players mp join public.profiles p on p.id = mp.user_id
       where mp.match_id = m.id and mp.status = 'waitlist'), '[]'::jsonb),
    'liable', case when can_see then coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name) order by l.created_at)
        from public.match_liable l join public.profiles p on p.id = l.user_id
       where l.match_id = m.id and l.user_id = any (public.share_holders(m.id))
         and not exists (select 1 from public.match_players mp
                          where mp.match_id = m.id and mp.user_id = l.user_id and mp.status = 'confirmed')), '[]'::jsonb) end,
    'split_ids', case when can_see then to_jsonb(public.split_ids(m.id)) end,
    'split_ready', public.split_ready(m.id),
    'repeat_weekly', m.repeat_weekly or exists (select 1 from public.matches x
                       where x.series_id = coalesce(m.series_id, m.id) and x.starts_at > m.starts_at),
    'repeats', m.repeat_weekly,
    'regulars_first', m.regulars_first,
    'regulars_until', m.regulars_until,
    'is_regular', me = any (m.regulars),
    -- Games logged in this match, newest first, with names (names are public).
    'games', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'created_by', g.created_by, 'winner', g.winner, 'score_a', g.score_a, 'score_b', g.score_b,
        'a', (select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name) order by x.o)
                from unnest(array[g.a1, g.a2]) with ordinality x(id, o) join public.profiles p on p.id = x.id),
        'b', (select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name) order by x.o)
                from unnest(array[g.b1, g.b2]) with ordinality x(id, o) join public.profiles p on p.id = x.id))
        order by g.created_at desc)
      from public.games g where g.match_id = m.id), '[]'::jsonb),
    -- One entry per court: whether it's booked; number, cost and booker for confirmed players.
    'court_info', (select jsonb_agg(jsonb_build_object('court', c, 'booked', mc.court is not null)
                     || case when can_see and mc.court is not null then jsonb_build_object(
                          'label', mc.label, 'cost', mc.cost, 'booked_by', mc.booked_by,
                          'booked_by_name', (select full_name from public.profiles where id = mc.booked_by)) else '{}'::jsonb end
                     order by c)
                     from generate_series(1, m.court_count) c
                     left join public.match_courts mc on mc.match_id = m.id and mc.court = c),
    -- Guests (no login) and who pays their share.
    'billed_to', case when can_see then coalesce((
      select jsonb_object_agg(x.guest, x.payer) from (
        select mp.user_id as guest, public.payer_for(m, mp.user_id) as payer
          from public.match_players mp join public.profiles p on p.id = mp.user_id
         where mp.match_id = m.id and p.is_guest
      ) x), '{}'::jsonb) end,
    'added_by', coalesce((
      select jsonb_object_agg(mp.user_id, mp.added_by) from public.match_players mp
       where mp.match_id = m.id and mp.added_by is not null
         and (can_see or show_names)), '{}'::jsonb),
    'expenses', case when can_see then coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'label', e.label, 'amount', e.amount, 'paid_by', e.paid_by)
                       order by e.created_at)
        from public.expenses e where e.match_id = m.id), '[]'::jsonb) end,
    'settlements', case when can_see then coalesce((
      select jsonb_agg(jsonb_build_object('from', s.from_user, 'to', s.to_user, 'amount', s.amount))
        from public.settlements s where s.match_id = m.id), '[]'::jsonb) end,
    'people', case when can_see then coalesce((
      select jsonb_object_agg(p.id, p.full_name) from public.profiles p
       where p.id in (select paid_by from public.expenses where match_id = m.id
                      union select user_id from public.match_players where match_id = m.id
                      union select user_id from public.match_liable where match_id = m.id
                      union select booked_by from public.match_courts where match_id = m.id
                      union select public.payer_for(m, mp.user_id) from public.match_players mp
                       where mp.match_id = m.id)), '{}'::jsonb) end
  );
end $$;

create or replace function public.my_matches() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.past, case when x.past then null else x.starts_at end, x.starts_at desc), '[]'::jsonb)
  from (
    select m.slug, m.title, m.venue, m.size, m.format, m.court_count, m.starts_at, m.duration_min, m.timezone, m.status,
           now() >= m.starts_at as started,
           m.repeat_weekly or m.series_id is not null as weekly,
           -- My place in it: organiser, confirmed, waitlist, or null when I'm not in it.
           case when m.organiser_id = auth.uid() then 'organiser'
                else (select status from public.match_players where match_id = m.id and user_id = auth.uid()) end as my_role,
           public.match_past(m) as past, public.match_locked(m) as locked,
           (select count(*) from public.match_players where match_id = m.id and status = 'confirmed') as confirmed_count,
           (select count(*) from public.match_players where match_id = m.id and status = 'waitlist') as waitlist_count,
           case when m.organiser_id = auth.uid()
                  or exists (select 1 from public.match_players where match_id = m.id and user_id = auth.uid() and status = 'confirmed')
                then m.courts end as courts,
           (select count(*) from public.games where match_id = m.id) as games_count,
           (select count(*) from public.match_courts where match_id = m.id) as booked_courts,
           (select string_agg(public.first_name(w), ' & ')
              from (select g.* from public.games g where g.match_id = m.id order by g.created_at desc limit 1) g,
                   unnest(case when g.winner = 'a' then array[g.a1, g.a2] else array[g.b1, g.b2] end) w
             where w is not null) as last_winners
      from public.matches m
     where auth.uid() is not null
  ) x;
$$;

-- ---------------------------------------------------------------------------
-- Schedule (Supabase): every 5 minutes. Skipped where pg_cron isn't available.
-- ---------------------------------------------------------------------------

do $$ begin
  begin create extension if not exists pg_net with schema extensions;
  exception when others then raise notice 'pg_net not available here: %', sqlerrm; end;
  begin create extension if not exists pg_cron;
  exception when others then raise notice 'pg_cron not available here: %', sqlerrm; end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$select cron.schedule('goodminton-every-5-min', '*/5 * * * *', 'select public.run_scheduled()')$q$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.set_alert_config(text, text) from public, anon, authenticated;
revoke all on function public.flush_alerts() from public, anon, authenticated;
revoke all on function public.send_alert_now() from public, anon, authenticated;
revoke all on function public.remind_once(text, uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.match_balances() from public, anon, authenticated;
revoke all on function public.send_reminders(timestamptz) from public, anon, authenticated;
revoke all on function public.roll_recurring(timestamptz) from public, anon, authenticated;
revoke all on function public.run_scheduled() from public, anon, authenticated;
revoke all on function public.send_test_alert() from public, anon;
revoke all on function public.alert_status(uuid) from public, anon;
revoke all on function public.set_repeat(uuid, boolean, boolean) from public, anon;
revoke all on function public.log_game(uuid, uuid, uuid, uuid, uuid, text, int, int) from public, anon;
grant execute on function public.send_test_alert() to authenticated;
grant execute on function public.alert_status(uuid) to authenticated;
grant execute on function public.set_repeat(uuid, boolean, boolean) to authenticated;
grant execute on function public.log_game(uuid, uuid, uuid, uuid, uuid, text, int, int) to authenticated;
