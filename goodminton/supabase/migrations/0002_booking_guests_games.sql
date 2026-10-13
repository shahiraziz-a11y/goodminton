-- Plan first, book later; guest players; game results and leaderboard.
-- Safe to run once on a database that already has 0001_init.sql.

-- ---------------------------------------------------------------------------
-- Guest players: name-only profiles the organiser adds, with no Google account.
-- ---------------------------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles alter column id set default gen_random_uuid();
alter table public.profiles add column is_guest boolean not null default false;
alter table public.profiles add column created_by uuid references public.profiles (id) on delete set null;
-- Real accounts still go away with their auth user.
create function public.delete_profile_for_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.profiles where id = old.id and not is_guest;
  return old;
end $$;
create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.delete_profile_for_user();

-- ---------------------------------------------------------------------------
-- Matches start as a plan; the organiser books the court later.
-- ---------------------------------------------------------------------------

alter table public.matches drop constraint if exists matches_venue_check;
alter table public.matches add constraint matches_venue_check check (char_length(venue) <= 120);
alter table public.matches alter column venue set default '';
alter table public.matches alter column court_cost set default 0;
alter table public.matches add column status text not null default 'planning'
  check (status in ('planning', 'booked'));
alter table public.matches add column booked_at timestamptz;

-- ---------------------------------------------------------------------------
-- Games: one doubles result, pair A vs pair B.
-- ---------------------------------------------------------------------------

create table public.games (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references public.matches (id) on delete set null,
  created_by uuid not null references public.profiles (id),
  played_on date not null default current_date,
  a1 uuid not null references public.profiles (id),
  a2 uuid not null references public.profiles (id),
  b1 uuid not null references public.profiles (id),
  b2 uuid not null references public.profiles (id),
  winner text not null check (winner in ('a', 'b')),
  created_at timestamptz not null default now(),
  check (a1 <> a2 and a1 <> b1 and a1 <> b2 and a2 <> b1 and a2 <> b2 and b1 <> b2)
);
create index games_created_by_idx on public.games (created_by);
alter table public.games enable row level security;

-- Everyone who has ever been in a match, kept after they drop out or are removed,
-- so the organiser can still find them later.
create table public.match_history (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (match_id, user_id)
);
alter table public.match_history enable row level security;
insert into public.match_history (match_id, user_id) select match_id, user_id from public.match_players;

create function public.remember_player() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.match_history (match_id, user_id) values (new.match_id, new.user_id) on conflict do nothing;
  return new;
end $$;
create trigger match_players_history
  after insert on public.match_players
  for each row execute function public.remember_player();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Everyone I've shared a match or a game with, plus guests I created, plus me.
create function public.circle_of(u uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select u
  union select h2.user_id from public.match_history h1
          join public.match_history h2 on h2.match_id = h1.match_id
         where h1.user_id = u
  union select m.organiser_id from public.matches m
          join public.match_history h on h.match_id = m.id where h.user_id = u
  union select h.user_id from public.matches m
          join public.match_history h on h.match_id = m.id where m.organiser_id = u
  union select id from public.profiles where created_by = u and is_guest
  union select unnest(array[g.a1, g.a2, g.b1, g.b2]) from public.games g
         where g.created_by = u or u in (g.a1, g.a2, g.b1, g.b2);
$$;

create function public.require_organiser(m public.matches) returns uuid
language plpgsql stable set search_path = public as $$
begin
  if auth.uid() is distinct from m.organiser_id then
    raise exception 'Only the organiser can do that';
  end if;
  return auth.uid();
end $$;

create function public.new_guest(p_name text, p_owner uuid) returns uuid
language plpgsql set search_path = public as $$
declare v_id uuid;
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 60 then
    raise exception 'Enter a name for the player';
  end if;
  insert into public.profiles (full_name, is_guest, created_by)
  values (btrim(p_name), true, p_owner) returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Match functions (replacing 0001 versions where behaviour changed)
-- ---------------------------------------------------------------------------

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
  show_names := can_see or (n_conf < m.size and my_status is distinct from 'waitlist');
  role := case
    when me is null then 'anon'
    when is_org then 'organiser'
    when my_status is not null then my_status
    else 'outsider'
  end;

  return jsonb_build_object(
    'id', m.id, 'slug', m.slug, 'title', m.title, 'size', m.size, 'venue', m.venue,
    'status', m.status,
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
               'id', p.id, 'full_name', p.full_name, 'promoted', mp.promoted, 'joined_at', mp.joined_at,
               'is_guest', p.is_guest)
             else jsonb_build_object('hidden', true) end order by mp.seq)
        from public.match_players mp join public.profiles p on p.id = mp.user_id
       where mp.match_id = m.id and mp.status = 'confirmed'), '[]'::jsonb),
    'waitlist', case when is_org then coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'is_guest', p.is_guest) order by mp.seq)
        from public.match_players mp join public.profiles p on p.id = mp.user_id
       where mp.match_id = m.id and mp.status = 'waitlist'), '[]'::jsonb) end,
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
                      union select user_id from public.match_players where match_id = m.id)), '{}'::jsonb) end
  );
end $$;

-- Venue is optional now; court cost is added to the split when the court is booked.
create or replace function public.create_match(
  p_title text, p_size int, p_venue text, p_courts text, p_parking text,
  p_date date, p_time time, p_timezone text, p_duration_min int,
  p_rsvp_close_hours int, p_court_cost numeric, p_currency text default 'AED'
) returns text
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  v_slug text;
  v_id uuid;
begin
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    p_timezone := 'UTC';
  end if;
  v_slug := coalesce(nullif(left(trim(both '-' from regexp_replace(lower(p_title), '[^a-z0-9]+', '-', 'g')), 24), ''), 'match')
            || '-' || substr(md5(gen_random_uuid()::text), 1, 6);

  insert into public.matches (slug, organiser_id, title, size, venue, courts, parking, starts_at,
                              duration_min, rsvp_close_hours, court_cost, currency, timezone)
  values (v_slug, me, btrim(p_title), p_size, btrim(coalesce(p_venue, '')), btrim(coalesce(p_courts, '')),
          btrim(coalesce(p_parking, '')), (p_date + p_time) at time zone p_timezone,
          p_duration_min, p_rsvp_close_hours, coalesce(p_court_cost, 0), coalesce(p_currency, 'AED'), p_timezone)
  returning id into v_id;

  insert into public.match_players (match_id, user_id, status) values (v_id, me, 'confirmed');
  return v_slug;
end $$;

-- Court booked: record the details and lock in the players. Calling it again edits the details.
create function public.book_match(p_match uuid, p_venue text, p_courts text, p_parking text, p_court_cost numeric)
returns void
language plpgsql security definer set search_path = public as $$
declare
  m public.matches := public.lock_match(p_match);
  v_courts text := btrim(coalesce(p_courts, ''));
  first_booking boolean;
begin
  perform public.require_organiser(m);
  if btrim(coalesce(p_venue, '')) = '' then raise exception 'Add the venue'; end if;
  if v_courts = '' then raise exception 'Add the court number'; end if;
  if coalesce(p_court_cost, 0) < 0 then raise exception 'Court cost can''t be negative'; end if;
  if m.size = 8 and v_courts !~ '&' then
    v_courts := v_courts || ' & ' || public.next_court(v_courts);
  end if;
  first_booking := m.status <> 'booked';

  update public.matches
     set status = 'booked', booked_at = coalesce(booked_at, now()),
         venue = btrim(p_venue), courts = v_courts, parking = btrim(coalesce(p_parking, '')),
         court_cost = coalesce(p_court_cost, 0)
   where id = m.id;

  if first_booking and coalesce(p_court_cost, 0) > 0
     and not exists (select 1 from public.expenses where match_id = m.id and label like 'Court booking%') then
    insert into public.expenses (match_id, label, amount, paid_by)
    values (m.id, case when m.size = 8 then 'Court booking (2 courts)' else 'Court booking' end,
            p_court_cost * (m.size / 4), m.organiser_id);
  end if;
end $$;

-- Once the court is booked, confirmed players can't drop out themselves.
create or replace function public.leave_match(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  m public.matches := public.lock_match(p_match);
  my_status text;
  promoted uuid[];
begin
  if me = m.organiser_id then raise exception 'Organisers can''t drop out of their own match'; end if;
  if public.match_past(m) then raise exception 'This match has already been played'; end if;
  select status into my_status from public.match_players where match_id = m.id and user_id = me;
  if my_status is null then raise exception 'You''re not in this match'; end if;
  if my_status = 'confirmed' and m.status = 'booked' then
    raise exception 'The court is booked, so players are locked in. Ask the organiser to remove you.';
  end if;
  delete from public.match_players where match_id = m.id and user_id = me;
  if my_status = 'confirmed' then promoted := public.fill_from_waitlist(m); end if;
  return jsonb_build_object('status', my_status, 'promoted',
    (select full_name from public.profiles where id = promoted[1]));
end $$;

-- Organiser override: remove anyone (except themselves), even after booking.
create function public.remove_player(p_match uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.matches := public.lock_match(p_match);
  v_status text;
  promoted uuid[];
begin
  perform public.require_organiser(m);
  if p_user = m.organiser_id then raise exception 'You can''t remove yourself'; end if;
  delete from public.match_players where match_id = m.id and user_id = p_user returning status into v_status;
  if v_status is null then raise exception 'That player isn''t in this match'; end if;
  if v_status = 'confirmed' then promoted := public.fill_from_waitlist(m); end if;
  return jsonb_build_object('status', v_status, 'promoted',
    (select full_name from public.profiles where id = promoted[1]));
end $$;

-- Organiser adds someone from their circle (p_user) or a new guest by name (p_name).
-- Ignores the sign-up lock; still respects the player count.
create function public.add_player(p_match uuid, p_user uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid;
  m public.matches := public.lock_match(p_match);
  v_user uuid := p_user;
  n_conf int;
  n_wait int;
begin
  me := public.require_organiser(m);
  if public.match_past(m) then raise exception 'This match has already been played'; end if;
  if v_user is null then
    v_user := public.new_guest(p_name, me);
  elsif v_user not in (select public.circle_of(me)) then
    raise exception 'You can only add people you''ve played with';
  end if;
  if exists (select 1 from public.match_players where match_id = m.id and user_id = v_user) then
    raise exception 'Already in this match';
  end if;
  select count(*) filter (where status = 'confirmed'), count(*) filter (where status = 'waitlist')
    into n_conf, n_wait from public.match_players where match_id = m.id;
  if n_conf < m.size then
    insert into public.match_players (match_id, user_id, status) values (m.id, v_user, 'confirmed');
    return jsonb_build_object('status', 'confirmed', 'filled', n_conf + 1 = m.size);
  end if;
  insert into public.match_players (match_id, user_id, status) values (m.id, v_user, 'waitlist');
  return jsonb_build_object('status', 'waitlist', 'position', n_wait + 1, 'filled', false);
end $$;

-- 4 waiting on a full 4-player match: go to 8 on two courts.
-- Before booking there's no court cost to add yet; booking adds it for both courts.
create or replace function public.upgrade_match(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m public.matches := public.lock_match(p_match);
  n_wait int;
begin
  perform public.require_organiser(m);
  if m.size <> 4 then raise exception 'Already on two courts'; end if;
  if public.match_past(m) then raise exception 'This match has already been played'; end if;
  select count(*) into n_wait from public.match_players where match_id = m.id and status = 'waitlist';
  if n_wait < 4 then raise exception 'Need 4 on the waitlist to open a second court'; end if;

  update public.matches
     set size = 8,
         courts = case when courts = '' then '' else courts || ' & ' || public.next_court(courts) end
   where id = m.id returning * into m;
  perform public.fill_from_waitlist(m);
  if m.status = 'booked' and m.court_cost > 0 then
    insert into public.expenses (match_id, label, amount, paid_by)
    values (m.id, 'Court booking (2nd court)', m.court_cost, m.organiser_id);
  end if;
end $$;

-- Reorder the 4 players on one court (who partners whom). Left pair = first two.
create function public.set_court_order(p_match uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  m public.matches := public.lock_match(p_match);
  pos int[];
  seqs bigint[];
begin
  if me <> m.organiser_id and not exists (
    select 1 from public.match_players where match_id = m.id and user_id = me and status = 'confirmed') then
    raise exception 'Only players in this match can change pairs';
  end if;
  if coalesce(array_length(p_ids, 1), 0) <> 4 or (select count(distinct x) from unnest(p_ids) x) <> 4 then
    raise exception 'Pick 4 different players';
  end if;
  -- Positions (0-based) in the confirmed order; a court is positions 4c..4c+3.
  select array_agg(rn order by rn), array_agg(seq order by rn) into pos, seqs from (
    select user_id, seq, row_number() over (order by seq) - 1 as rn
      from public.match_players where match_id = m.id and status = 'confirmed'
  ) o where user_id = any (p_ids);
  if coalesce(array_length(pos, 1), 0) <> 4 or pos[1] % 4 <> 0 or pos[4] <> pos[1] + 3 then
    raise exception 'Those players aren''t on the same court';
  end if;
  for i in 1..4 loop
    update public.match_players set seq = seqs[i] where match_id = m.id and user_id = p_ids[i];
  end loop;
end $$;

create or replace function public.my_matches() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.past, case when x.past then null else x.starts_at end, x.starts_at desc), '[]'::jsonb)
  from (
    select m.slug, m.title, m.venue, m.size, m.starts_at, m.timezone, m.status,
           public.match_past(m) as past, public.match_locked(m) as locked,
           (select count(*) from public.match_players where match_id = m.id and status = 'confirmed') as confirmed_count,
           (select count(*) from public.match_players where match_id = m.id and status = 'waitlist') as waitlist_count
      from public.matches m
     where m.organiser_id = auth.uid()
        or exists (select 1 from public.match_players where match_id = m.id and user_id = auth.uid())
  ) x;
$$;

-- ---------------------------------------------------------------------------
-- Players, games, leaderboard
-- ---------------------------------------------------------------------------

-- People I can pick for a game or add to a match.
create function public.my_players() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'is_guest', p.is_guest)
                            order by p.id <> auth.uid(), lower(p.full_name)), '[]'::jsonb)
    from public.profiles p where p.id in (select public.circle_of(auth.uid()));
$$;

create function public.create_guest(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  return public.new_guest(p_name, public.require_user());
end $$;

-- Log a doubles result. With a match: the 4 must be confirmed in it and the caller
-- must be in it. Without: the 4 must be in the caller's circle.
create function public.log_game(p_match uuid, p_a1 uuid, p_a2 uuid, p_b1 uuid, p_b2 uuid, p_winner text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  m public.matches;
  v_id uuid;
  v_date date := current_date;
begin
  if p_winner not in ('a', 'b') then raise exception 'Tap the pair that won'; end if;
  if p_match is not null then
    select * into m from public.matches where id = p_match;
    if not found then raise exception 'Match not found'; end if;
    if me <> m.organiser_id and not exists (
      select 1 from public.match_players where match_id = m.id and user_id = me and status = 'confirmed') then
      raise exception 'Only players in this match can log results';
    end if;
    if (select count(*) from public.match_players
         where match_id = m.id and status = 'confirmed' and user_id in (p_a1, p_a2, p_b1, p_b2)) <> 4 then
      raise exception 'All 4 players must be confirmed in this match';
    end if;
    v_date := (m.starts_at at time zone m.timezone)::date;
  elsif exists (select x from unnest(array[p_a1, p_a2, p_b1, p_b2]) x
                 where x not in (select public.circle_of(me))) then
    raise exception 'You can only log games with people you''ve played with';
  end if;

  insert into public.games (match_id, created_by, played_on, a1, a2, b1, b2, winner)
  values (p_match, me, v_date, p_a1, p_a2, p_b1, p_b2, p_winner)
  returning id into v_id;
  return v_id;
end $$;

create function public.delete_game(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  g public.games;
begin
  select * into g from public.games where id = p_game;
  if not found then raise exception 'Game not found'; end if;
  if me <> g.created_by and me is distinct from (select organiser_id from public.matches where id = g.match_id) then
    raise exception 'Only the person who logged it can remove it';
  end if;
  delete from public.games where id = p_game;
end $$;

-- Games logged by anyone in my circle, or that I played in.
create function public.get_leaderboard() returns jsonb
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
        'a', jsonb_build_array(a1, a2), 'b', jsonb_build_array(b1, b2), 'winner', winner)
        order by played_on desc, created_at desc) from g), '[]'::jsonb),
    'people', coalesce((select jsonb_object_agg(p.id, p.full_name) from public.profiles p
        where p.id in (select unnest(array[a1, a2, b1, b2]) from g)), '{}'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- Grants
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
grant execute on function public.book_match(uuid, text, text, text, numeric) to authenticated;
grant execute on function public.remove_player(uuid, uuid) to authenticated;
grant execute on function public.add_player(uuid, uuid, text) to authenticated;
grant execute on function public.set_court_order(uuid, uuid[]) to authenticated;
grant execute on function public.my_players() to authenticated;
grant execute on function public.create_guest(text) to authenticated;
grant execute on function public.log_game(uuid, uuid, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.delete_game(uuid) to authenticated;
grant execute on function public.get_leaderboard() to authenticated;
