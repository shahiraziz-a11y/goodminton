-- Goodminton schema.
--
-- All reads and writes go through the SECURITY DEFINER functions below. The
-- tables have RLS enabled with no policies for other people's rows, so the
-- privacy rules (court number hidden until confirmed, names hidden from the
-- waitlist once full) are enforced here rather than trusted to the browser.
-- Every mutation locks the match row first, so "first 4 in" holds even when
-- several friends tap at the same moment.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  organiser_id uuid not null references public.profiles (id),
  title text not null check (char_length(title) between 1 and 80),
  size smallint not null check (size in (4, 8)),
  venue text not null check (char_length(venue) between 1 and 120),
  courts text not null default '' check (char_length(courts) <= 60),
  parking text not null default '' check (char_length(parking) <= 200),
  starts_at timestamptz not null,
  duration_min smallint not null check (duration_min in (60, 90, 120)),
  rsvp_close_hours smallint not null check (rsvp_close_hours in (2, 6, 24)),
  court_cost numeric(10, 2) not null check (court_cost >= 0),
  currency text not null default 'AED',
  timezone text not null default 'Asia/Dubai',
  -- 'auto': locks itself rsvp_close_hours before start. 'locked'/'open': organiser override.
  lock_state text not null default 'auto' check (lock_state in ('auto', 'locked', 'open')),
  created_at timestamptz not null default now()
);

create sequence public.match_players_seq;

create table public.match_players (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null check (status in ('confirmed', 'waitlist')),
  -- Order of arrival. Confirmed players fill courts in seq order (first 4 = court 1).
  seq bigint not null default nextval('public.match_players_seq'),
  promoted boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (match_id, user_id)
);
create index match_players_user_idx on public.match_players (user_id);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  amount numeric(10, 2) not null check (amount > 0),
  paid_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index expenses_match_idx on public.expenses (match_id);

-- A settlement records how much of the "from owes to" transfer has been paid.
-- If expenses change later and the transfer grows, the difference shows as open.
create table public.settlements (
  match_id uuid not null references public.matches (id) on delete cascade,
  from_user uuid not null references public.profiles (id),
  to_user uuid not null references public.profiles (id),
  amount numeric(10, 2) not null check (amount > 0),
  settled_by uuid not null references public.profiles (id),
  settled_at timestamptz not null default now(),
  primary key (match_id, from_user, to_user)
);

alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.expenses enable row level security;
alter table public.settlements enable row level security;

create policy "read own profile" on public.profiles
  for select to authenticated using (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Profile from Google sign-in
-- ---------------------------------------------------------------------------

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, avatar_url)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''),
             nullif(new.raw_user_meta_data ->> 'name', ''),
             split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function public.match_locked(m public.matches) returns boolean
language sql stable set search_path = public as $$
  select m.lock_state = 'locked'
      or (m.lock_state = 'auto' and now() >= m.starts_at - make_interval(hours => m.rsvp_close_hours));
$$;

create function public.match_past(m public.matches) returns boolean
language sql stable set search_path = public as $$
  select now() >= m.starts_at + make_interval(mins => m.duration_min);
$$;

-- "Court 2" -> "Court 3": bump the first number in the courts text.
create function public.next_court(courts text) returns text
language sql immutable as $$
  select case
    when courts ~ '\d' then regexp_replace(courts, '\d+', ((substring(courts from '\d+'))::int + 1)::text)
    else 'Court 2'
  end;
$$;

-- Locks and returns the match row, raising if it doesn't exist.
create function public.lock_match(p_match uuid) returns public.matches
language plpgsql set search_path = public as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match for update;
  if not found then raise exception 'Match not found' using errcode = 'P0002'; end if;
  return m;
end $$;

create function public.require_user() returns uuid
language plpgsql stable set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '28000'; end if;
  return auth.uid();
end $$;

-- Promote waitlisted players (oldest first) into free confirmed spots.
-- They go to the back of the confirmed order. Returns the promoted user ids.
create function public.fill_from_waitlist(m public.matches) returns uuid[]
language plpgsql set search_path = public as $$
declare
  free int;
  nxt uuid;
  promoted uuid[] := '{}';
begin
  select m.size - count(*) into free from public.match_players
   where match_id = m.id and status = 'confirmed';
  for nxt in
    select user_id from public.match_players
     where match_id = m.id and status = 'waitlist'
     order by seq limit greatest(free, 0)
  loop
    update public.match_players
       set status = 'confirmed', promoted = true, seq = nextval('public.match_players_seq')
     where match_id = m.id and user_id = nxt;
    promoted := promoted || nxt;
  end loop;
  return promoted;
end $$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- The match as the current viewer is allowed to see it. Works signed out.
create function public.get_match(p_slug text) returns jsonb
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
  result jsonb;
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
  -- Names are visible while there are open spots; once full, only to people in the match.
  show_names := can_see or (n_conf < m.size and my_status is distinct from 'waitlist');
  role := case
    when me is null then 'anon'
    when is_org then 'organiser'
    when my_status is not null then my_status
    else 'outsider'
  end;

  result := jsonb_build_object(
    'id', m.id, 'slug', m.slug, 'title', m.title, 'size', m.size, 'venue', m.venue,
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
      'full_name', (select full_name from public.profiles where id = me)),
    'confirmed_count', n_conf,
    'waitlist_count', n_wait,
    'players', coalesce((
      select jsonb_agg(case when show_names then jsonb_build_object(
               'id', p.id, 'full_name', p.full_name, 'promoted', mp.promoted, 'joined_at', mp.joined_at)
             else jsonb_build_object('hidden', true) end order by mp.seq)
        from public.match_players mp join public.profiles p on p.id = mp.user_id
       where mp.match_id = m.id and mp.status = 'confirmed'), '[]'::jsonb),
    'waitlist', case when is_org then coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name) order by mp.seq)
        from public.match_players mp join public.profiles p on p.id = mp.user_id
       where mp.match_id = m.id and mp.status = 'waitlist'), '[]'::jsonb) end,
    'expenses', case when can_see then coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'label', e.label, 'amount', e.amount, 'paid_by', e.paid_by)
                       order by e.created_at)
        from public.expenses e where e.match_id = m.id), '[]'::jsonb) end,
    'settlements', case when can_see then coalesce((
      select jsonb_agg(jsonb_build_object('from', s.from_user, 'to', s.to_user, 'amount', s.amount))
        from public.settlements s where s.match_id = m.id), '[]'::jsonb) end,
    -- Expense payers who have since dropped out still need a name in the split.
    'people', case when can_see then coalesce((
      select jsonb_object_agg(p.id, p.full_name) from public.profiles p
       where p.id in (select paid_by from public.expenses where match_id = m.id
                      union select user_id from public.match_players where match_id = m.id)), '{}'::jsonb) end
  );
  return result;
end $$;

-- Matches I organise or have joined, for the home screen.
create function public.my_matches() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.past, case when x.past then null else x.starts_at end, x.starts_at desc), '[]'::jsonb)
  from (
    select m.slug, m.title, m.venue, m.size, m.starts_at, m.timezone,
           public.match_past(m) as past, public.match_locked(m) as locked,
           (select count(*) from public.match_players where match_id = m.id and status = 'confirmed') as confirmed_count,
           (select count(*) from public.match_players where match_id = m.id and status = 'waitlist') as waitlist_count
      from public.matches m
     where m.organiser_id = auth.uid()
        or exists (select 1 from public.match_players where match_id = m.id and user_id = auth.uid())
  ) x;
$$;

-- Everything needed to work out balances across matches I'm confirmed in.
create function public.my_ledger() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'slug', m.slug, 'title', m.title, 'starts_at', m.starts_at,
    'timezone', m.timezone, 'currency', m.currency,
    'players', (select coalesce(jsonb_agg(user_id order by seq), '[]'::jsonb) from public.match_players
                 where match_id = m.id and status = 'confirmed'),
    'expenses', (select coalesce(jsonb_agg(jsonb_build_object('amount', amount, 'paid_by', paid_by)), '[]'::jsonb)
                   from public.expenses where match_id = m.id),
    'settlements', (select coalesce(jsonb_agg(jsonb_build_object('from', from_user, 'to', to_user, 'amount', amount)), '[]'::jsonb)
                      from public.settlements where match_id = m.id),
    'people', (select coalesce(jsonb_object_agg(p.id, p.full_name), '{}'::jsonb) from public.profiles p
                where p.id in (select paid_by from public.expenses where match_id = m.id
                               union select user_id from public.match_players where match_id = m.id))
  ) order by m.starts_at desc), '[]'::jsonb)
  from public.matches m
  where m.organiser_id = auth.uid()
     or exists (select 1 from public.match_players
                 where match_id = m.id and user_id = auth.uid() and status = 'confirmed');
$$;

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

create function public.create_match(
  p_title text, p_size int, p_venue text, p_courts text, p_parking text,
  p_date date, p_time time, p_timezone text, p_duration_min int,
  p_rsvp_close_hours int, p_court_cost numeric, p_currency text default 'AED'
) returns text
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  v_slug text;
  v_courts text := btrim(coalesce(p_courts, ''));
  v_id uuid;
begin
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    p_timezone := 'UTC';
  end if;
  if p_size = 8 and v_courts <> '' and v_courts !~ '&' then
    v_courts := v_courts || ' & ' || public.next_court(v_courts);
  end if;
  v_slug := coalesce(nullif(left(trim(both '-' from regexp_replace(lower(p_title), '[^a-z0-9]+', '-', 'g')), 24), ''), 'match')
            || '-' || substr(md5(gen_random_uuid()::text), 1, 6);

  insert into public.matches (slug, organiser_id, title, size, venue, courts, parking, starts_at,
                              duration_min, rsvp_close_hours, court_cost, currency, timezone)
  values (v_slug, me, btrim(p_title), p_size, btrim(p_venue), v_courts, btrim(coalesce(p_parking, '')),
          (p_date + p_time) at time zone p_timezone,
          p_duration_min, p_rsvp_close_hours, p_court_cost, coalesce(p_currency, 'AED'), p_timezone)
  returning id into v_id;

  insert into public.match_players (match_id, user_id, status) values (v_id, me, 'confirmed');
  if p_court_cost > 0 then
    insert into public.expenses (match_id, label, amount, paid_by)
    values (v_id, case when p_size = 8 then 'Court booking (2 courts)' else 'Court booking' end,
            case when p_size = 8 then p_court_cost * 2 else p_court_cost end, me);
  end if;
  return v_slug;
end $$;

-- Returns {status: 'confirmed'|'waitlist', position, filled}.
create function public.join_match(p_match uuid) returns jsonb
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
  if public.match_locked(m) then raise exception 'Sign-ups are closed'; end if;

  select count(*) filter (where status = 'confirmed'), count(*) filter (where status = 'waitlist')
    into n_conf, n_wait from public.match_players where match_id = m.id;

  if n_conf < m.size then
    insert into public.match_players (match_id, user_id, status) values (m.id, me, 'confirmed');
    return jsonb_build_object('status', 'confirmed', 'filled', n_conf + 1 = m.size);
  end if;
  insert into public.match_players (match_id, user_id, status) values (m.id, me, 'waitlist');
  return jsonb_build_object('status', 'waitlist', 'position', n_wait + 1, 'filled', false);
end $$;

-- Drop out (confirmed) or leave the waitlist. Returns {promoted: name|null}.
create function public.leave_match(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  m public.matches := public.lock_match(p_match);
  my_status text;
  promoted uuid[];
begin
  if me = m.organiser_id then raise exception 'Organisers can''t drop out of their own match'; end if;
  if public.match_past(m) then raise exception 'This match has already been played'; end if;
  delete from public.match_players where match_id = m.id and user_id = me returning status into my_status;
  if my_status is null then raise exception 'You''re not in this match'; end if;
  if my_status = 'confirmed' then promoted := public.fill_from_waitlist(m); end if;
  return jsonb_build_object('status', my_status, 'promoted',
    (select full_name from public.profiles where id = promoted[1]));
end $$;

create function public.set_lock(p_match uuid, p_locked boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  m public.matches := public.lock_match(p_match);
begin
  if me <> m.organiser_id then raise exception 'Only the organiser can do that'; end if;
  update public.matches set lock_state = case when p_locked then 'locked' else 'open' end where id = m.id;
end $$;

-- 4 waiting on a full 4-player match: go to 8 on two courts.
create function public.upgrade_match(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  m public.matches := public.lock_match(p_match);
  n_wait int;
begin
  if me <> m.organiser_id then raise exception 'Only the organiser can do that'; end if;
  if m.size <> 4 then raise exception 'Already on two courts'; end if;
  if public.match_past(m) then raise exception 'This match has already been played'; end if;
  select count(*) into n_wait from public.match_players where match_id = m.id and status = 'waitlist';
  if n_wait < 4 then raise exception 'Need 4 on the waitlist to open a second court'; end if;

  update public.matches
     set size = 8,
         courts = case when courts = '' then '' else courts || ' & ' || public.next_court(courts) end
   where id = m.id returning * into m;
  perform public.fill_from_waitlist(m);
  if m.court_cost > 0 then
    insert into public.expenses (match_id, label, amount, paid_by)
    values (m.id, 'Court booking (2nd court)', m.court_cost, m.organiser_id);
  end if;
end $$;

create function public.add_expense(p_match uuid, p_label text, p_amount numeric) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  m public.matches := public.lock_match(p_match);
begin
  if me <> m.organiser_id and not exists (
    select 1 from public.match_players where match_id = m.id and user_id = me and status = 'confirmed') then
    raise exception 'Only confirmed players can add expenses';
  end if;
  insert into public.expenses (match_id, label, amount, paid_by) values (m.id, btrim(p_label), p_amount, me);
end $$;

-- Mark a transfer as paid (p_amount > 0) or unpaid (null). Either side or the organiser can.
create function public.set_settled(p_match uuid, p_from uuid, p_to uuid, p_amount numeric) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  m public.matches;
begin
  select * into m from public.matches where id = p_match;
  if not found then raise exception 'Match not found'; end if;
  if me not in (p_from, p_to, m.organiser_id) then
    raise exception 'Only the people involved or the organiser can mark this';
  end if;
  if p_amount is null then
    delete from public.settlements where match_id = p_match and from_user = p_from and to_user = p_to;
  else
    insert into public.settlements (match_id, from_user, to_user, amount, settled_by)
    values (p_match, p_from, p_to, p_amount, me)
    on conflict (match_id, from_user, to_user)
      do update set amount = excluded.amount, settled_by = me, settled_at = now();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Grants. Functions are executable by PUBLIC by default, so start from nothing.
-- ---------------------------------------------------------------------------

revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles to authenticated;

grant execute on function public.get_match(text) to anon, authenticated;
grant execute on function public.my_matches() to authenticated;
grant execute on function public.my_ledger() to authenticated;
grant execute on function public.create_match(text, int, text, text, text, date, time, text, int, int, numeric, text) to authenticated;
grant execute on function public.join_match(uuid) to authenticated;
grant execute on function public.leave_match(uuid) to authenticated;
grant execute on function public.set_lock(uuid, boolean) to authenticated;
grant execute on function public.upgrade_match(uuid) to authenticated;
grant execute on function public.add_expense(uuid, text, numeric) to authenticated;
grant execute on function public.set_settled(uuid, uuid, uuid, numeric) to authenticated;
