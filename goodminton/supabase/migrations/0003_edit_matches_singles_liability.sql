-- Editable matches (format, courts, time), singles, and shares owed after booking.
-- Run once, after 0001 and 0002.

-- ---------------------------------------------------------------------------
-- Format and court count. size = courts × players per court (2 singles, 4 doubles).
-- ---------------------------------------------------------------------------

alter table public.matches drop constraint if exists matches_size_check;
alter table public.matches add column format text not null default 'doubles' check (format in ('singles', 'doubles'));
alter table public.matches add column court_count smallint not null default 1 check (court_count between 1 and 4);
update public.matches set court_count = size / 4;
alter table public.matches add constraint matches_size_check
  check (size = court_count * case format when 'singles' then 2 else 4 end);

create function public.per_court(m public.matches) returns int
language sql immutable as $$ select case m.format when 'singles' then 2 else 4 end $$;

-- ---------------------------------------------------------------------------
-- One court-booking expense per match, kept in sync with cost × courts.
-- ---------------------------------------------------------------------------

alter table public.expenses add column kind text check (kind in ('court'));
update public.expenses set kind = 'court' where label like 'Court booking%';

create function public.sync_court_expense(p_match uuid) returns void
language plpgsql set search_path = public as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match;
  delete from public.expenses where match_id = m.id and kind = 'court';
  if m.status = 'booked' and m.court_cost > 0 then
    insert into public.expenses (match_id, label, amount, paid_by, kind, created_at)
    values (m.id,
            case when m.court_count = 1 then 'Court booking' else 'Court booking (' || m.court_count || ' courts)' end,
            m.court_cost * m.court_count, m.organiser_id, 'court', coalesce(m.booked_at, now()));
  end if;
end $$;

-- Keep the first n parts of "Court 3 & Court 4", or add the next numbers.
create function public.resize_courts(courts text, n int) returns text
language plpgsql immutable as $$
declare
  parts text[];
  last int;
begin
  if btrim(coalesce(courts, '')) = '' then return ''; end if;
  parts := array(select btrim(x) from unnest(string_to_array(courts, '&')) x where btrim(x) <> '');
  while array_length(parts, 1) < n loop
    last := coalesce((select max(r[1]::int) from unnest(parts) p cross join lateral regexp_matches(p, '\d+', 'g') r), 0);
    parts := parts || ('Court ' || (last + 1));
  end loop;
  return array_to_string(parts[1:n], ' & ');
end $$;

-- ---------------------------------------------------------------------------
-- Removed after booking: still owe a share until the organiser waives it.
-- ---------------------------------------------------------------------------

create table public.match_liable (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (match_id, user_id)
);
alter table public.match_liable enable row level security;

-- Who splits the costs: confirmed players plus anyone still liable.
create function public.split_ids(p_match uuid) returns uuid[]
language sql stable set search_path = public as $$
  select coalesce(array_agg(user_id order by o, seq), '{}') from (
    select user_id, 0 as o, seq from public.match_players where match_id = p_match and status = 'confirmed'
    union all
    select l.user_id, 1, 0 from public.match_liable l
     where l.match_id = p_match
       and not exists (select 1 from public.match_players mp
                        where mp.match_id = p_match and mp.user_id = l.user_id and mp.status = 'confirmed')
  ) x;
$$;

-- ---------------------------------------------------------------------------
-- Singles games: a2 and b2 empty.
-- ---------------------------------------------------------------------------

alter table public.games drop constraint if exists games_check;
alter table public.games alter column a2 drop not null;
alter table public.games alter column b2 drop not null;
alter table public.games add constraint games_players_check check (
  ((a2 is null and b2 is null and a1 <> b1)
   or (a2 is not null and b2 is not null
       and a1 <> a2 and a1 <> b1 and a1 <> b2 and a2 <> b1 and a2 <> b2 and b1 <> b2))
);

-- Nulls from singles games must not end up in the circle (NOT IN with a null never matches).
create or replace function public.circle_of(u uuid) returns setof uuid
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
  union select x from public.games g, unnest(array[g.a1, g.a2, g.b1, g.b2]) x
         where x is not null and (g.created_by = u or u in (g.a1, g.a2, g.b1, g.b2));
$$;

-- ---------------------------------------------------------------------------
-- Reads
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
    'liable', case when can_see then coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name) order by l.created_at)
        from public.match_liable l join public.profiles p on p.id = l.user_id
       where l.match_id = m.id and l.user_id = any (public.split_ids(m.id))
         and not exists (select 1 from public.match_players mp
                          where mp.match_id = m.id and mp.user_id = l.user_id and mp.status = 'confirmed')), '[]'::jsonb) end,
    'split_ids', case when can_see then to_jsonb(public.split_ids(m.id)) end,
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
                      union select user_id from public.match_liable where match_id = m.id)), '{}'::jsonb) end
  );
end $$;

create or replace function public.my_matches() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.past, case when x.past then null else x.starts_at end, x.starts_at desc), '[]'::jsonb)
  from (
    select m.slug, m.title, m.venue, m.size, m.format, m.court_count, m.starts_at, m.timezone, m.status,
           public.match_past(m) as past, public.match_locked(m) as locked,
           (select count(*) from public.match_players where match_id = m.id and status = 'confirmed') as confirmed_count,
           (select count(*) from public.match_players where match_id = m.id and status = 'waitlist') as waitlist_count
      from public.matches m
     where m.organiser_id = auth.uid()
        or exists (select 1 from public.match_players where match_id = m.id and user_id = auth.uid())
  ) x;
$$;

-- Balances include matches I was removed from after booking but still owe for.
create or replace function public.my_ledger() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'slug', m.slug, 'title', m.title, 'starts_at', m.starts_at,
    'timezone', m.timezone, 'currency', m.currency,
    'players', to_jsonb(public.split_ids(m.id)),
    'expenses', (select coalesce(jsonb_agg(jsonb_build_object('amount', amount, 'paid_by', paid_by)), '[]'::jsonb)
                   from public.expenses where match_id = m.id),
    'settlements', (select coalesce(jsonb_agg(jsonb_build_object('from', from_user, 'to', to_user, 'amount', amount)), '[]'::jsonb)
                      from public.settlements where match_id = m.id),
    'people', (select coalesce(jsonb_object_agg(p.id, p.full_name), '{}'::jsonb) from public.profiles p
                where p.id in (select paid_by from public.expenses where match_id = m.id
                               union select user_id from public.match_players where match_id = m.id
                               union select user_id from public.match_liable where match_id = m.id))
  ) order by m.starts_at desc), '[]'::jsonb)
  from public.matches m
  where m.organiser_id = auth.uid()
     or auth.uid() = any (public.split_ids(m.id));
$$;

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

drop function public.create_match(text, int, text, text, text, date, time, text, int, int, numeric, text);

create function public.create_match(
  p_title text, p_format text, p_court_count int, p_venue text,
  p_date date, p_time time, p_timezone text, p_duration_min int,
  p_rsvp_close_hours int, p_currency text default 'AED'
) returns text
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  v_slug text;
  v_id uuid;
begin
  if p_format not in ('singles', 'doubles') then raise exception 'Pick singles or doubles'; end if;
  if p_court_count not between 1 and 4 then raise exception 'Pick 1 to 4 courts'; end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    p_timezone := 'UTC';
  end if;
  v_slug := coalesce(nullif(left(trim(both '-' from regexp_replace(lower(p_title), '[^a-z0-9]+', '-', 'g')), 24), ''), 'match')
            || '-' || substr(md5(gen_random_uuid()::text), 1, 6);

  insert into public.matches (slug, organiser_id, title, format, court_count, size, venue, starts_at,
                              duration_min, rsvp_close_hours, currency, timezone)
  values (v_slug, me, btrim(p_title), p_format, p_court_count,
          p_court_count * case p_format when 'singles' then 2 else 4 end,
          btrim(coalesce(p_venue, '')), (p_date + p_time) at time zone p_timezone,
          p_duration_min, p_rsvp_close_hours, coalesce(p_currency, 'AED'), p_timezone)
  returning id into v_id;

  insert into public.match_players (match_id, user_id, status) values (v_id, me, 'confirmed');
  return v_slug;
end $$;

-- Organiser edits the match. Fewer spots: the most recent joiners (never the organiser)
-- go to the front of the waitlist. More spots: the waitlist moves up.
create function public.update_match(
  p_match uuid, p_title text, p_format text, p_court_count int,
  p_date date, p_time time, p_duration_min int, p_rsvp_close_hours int
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.matches := public.lock_match(p_match);
  v_size int;
  n_conf int;
  demoted int := 0;
  promoted uuid[];
  front bigint;
  r record;
begin
  perform public.require_organiser(m);
  if public.match_past(m) then raise exception 'This match has already been played'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 80 then raise exception 'Add a match name'; end if;
  if p_format not in ('singles', 'doubles') then raise exception 'Pick singles or doubles'; end if;
  if p_court_count not between 1 and 4 then raise exception 'Pick 1 to 4 courts'; end if;
  if p_duration_min not in (60, 90, 120) then raise exception 'Pick a duration'; end if;
  if p_rsvp_close_hours not in (2, 6, 24) then raise exception 'Pick when RSVPs close'; end if;
  v_size := p_court_count * case p_format when 'singles' then 2 else 4 end;

  update public.matches
     set title = btrim(p_title), format = p_format, court_count = p_court_count, size = v_size,
         starts_at = (p_date + p_time) at time zone timezone,
         duration_min = p_duration_min, rsvp_close_hours = p_rsvp_close_hours,
         courts = public.resize_courts(courts, p_court_count)
   where id = m.id returning * into m;

  select count(*) into n_conf from public.match_players where match_id = m.id and status = 'confirmed';
  if n_conf > v_size then
    select coalesce(min(seq), 0) into front from public.match_players where match_id = m.id;
    for r in
      select user_id from public.match_players
       where match_id = m.id and status = 'confirmed' and user_id <> m.organiser_id
       order by seq desc limit n_conf - v_size
    loop
      -- Ahead of everyone already waiting; among the moved, earlier joiners stay ahead.
      demoted := demoted + 1;
      update public.match_players set status = 'waitlist', seq = front - demoted
       where match_id = m.id and user_id = r.user_id;
    end loop;
  else
    promoted := public.fill_from_waitlist(m);
  end if;

  perform public.sync_court_expense(m.id);
  return jsonb_build_object('demoted', demoted, 'promoted', coalesce(array_length(promoted, 1), 0));
end $$;

-- Waitlist full enough for another court: add one and confirm them.
create or replace function public.upgrade_match(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  m public.matches := public.lock_match(p_match);
  n_wait int;
begin
  perform public.require_organiser(m);
  if m.court_count >= 4 then raise exception 'That''s the most courts'; end if;
  if public.match_past(m) then raise exception 'This match has already been played'; end if;
  select count(*) into n_wait from public.match_players where match_id = m.id and status = 'waitlist';
  if n_wait < public.per_court(m) then
    raise exception 'Need % on the waitlist to open another court', public.per_court(m);
  end if;
  update public.matches
     set court_count = court_count + 1, size = size + public.per_court(m),
         courts = public.resize_courts(courts, court_count + 1)
   where id = m.id returning * into m;
  perform public.fill_from_waitlist(m);
  perform public.sync_court_expense(m.id);
end $$;

-- Court booked (or details edited). Cost is per court; the split gets cost × courts.
create or replace function public.book_match(p_match uuid, p_venue text, p_courts text, p_parking text, p_court_cost numeric)
returns void
language plpgsql security definer set search_path = public as $$
declare
  m public.matches := public.lock_match(p_match);
begin
  perform public.require_organiser(m);
  if btrim(coalesce(p_venue, '')) = '' then raise exception 'Add the venue'; end if;
  if btrim(coalesce(p_courts, '')) = '' then raise exception 'Add the court number'; end if;
  if coalesce(p_court_cost, 0) < 0 then raise exception 'Court cost can''t be negative'; end if;
  update public.matches
     set status = 'booked', booked_at = coalesce(booked_at, now()),
         venue = btrim(p_venue), courts = public.resize_courts(btrim(p_courts), court_count),
         parking = btrim(coalesce(p_parking, '')), court_cost = coalesce(p_court_cost, 0)
   where id = m.id;
  perform public.sync_court_expense(m.id);
end $$;

-- Removing a confirmed player after booking keeps them in the cost split.
create or replace function public.remove_player(p_match uuid, p_user uuid) returns jsonb
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
  if v_status = 'confirmed' and m.status = 'booked' then
    insert into public.match_liable (match_id, user_id) values (m.id, p_user) on conflict do nothing;
  end if;
  if v_status = 'confirmed' then promoted := public.fill_from_waitlist(m); end if;
  return jsonb_build_object('status', v_status, 'still_owes', v_status = 'confirmed' and m.status = 'booked',
    'promoted', (select full_name from public.profiles where id = promoted[1]));
end $$;

create function public.waive_share(p_match uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.matches := public.lock_match(p_match);
begin
  perform public.require_organiser(m);
  delete from public.match_liable where match_id = m.id and user_id = p_user;
end $$;

-- Pairs on one court. Court c holds positions per_court*c .. per_court*c + per_court - 1.
create or replace function public.set_court_order(p_match uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  m public.matches := public.lock_match(p_match);
  k int := public.per_court(m);
  pos int[];
  seqs bigint[];
begin
  if me <> m.organiser_id and not exists (
    select 1 from public.match_players where match_id = m.id and user_id = me and status = 'confirmed') then
    raise exception 'Only players in this match can change pairs';
  end if;
  if coalesce(array_length(p_ids, 1), 0) <> k or (select count(distinct x) from unnest(p_ids) x) <> k then
    raise exception 'Pick % different players', k;
  end if;
  select array_agg(rn order by rn), array_agg(seq order by rn) into pos, seqs from (
    select user_id, seq, row_number() over (order by seq) - 1 as rn
      from public.match_players where match_id = m.id and status = 'confirmed'
  ) o where user_id = any (p_ids);
  if coalesce(array_length(pos, 1), 0) <> k or pos[1] % k <> 0 or pos[k] <> pos[1] + k - 1 then
    raise exception 'Those players aren''t on the same court';
  end if;
  for i in 1..k loop
    update public.match_players set seq = seqs[i] where match_id = m.id and user_id = p_ids[i];
  end loop;
end $$;

-- Singles: pass p_a2 and p_b2 as null.
create or replace function public.log_game(p_match uuid, p_a1 uuid, p_a2 uuid, p_b1 uuid, p_b2 uuid, p_winner text)
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

  insert into public.games (match_id, created_by, played_on, a1, a2, b1, b2, winner)
  values (p_match, me, v_date, p_a1, p_a2, p_b1, p_b2, p_winner)
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
        'winner', winner)
        order by played_on desc, created_at desc) from g), '[]'::jsonb),
    'people', coalesce((select jsonb_object_agg(p.id, p.full_name) from public.profiles p
        where p.id in (select x from g, unnest(array[a1, a2, b1, b2]) x where x is not null)), '{}'::jsonb)
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
grant execute on function public.create_match(text, text, int, text, date, time, text, int, int, text) to authenticated;
grant execute on function public.update_match(uuid, text, text, int, date, time, int, int) to authenticated;
grant execute on function public.join_match(uuid) to authenticated;
grant execute on function public.leave_match(uuid) to authenticated;
grant execute on function public.set_lock(uuid, boolean) to authenticated;
grant execute on function public.upgrade_match(uuid) to authenticated;
grant execute on function public.add_expense(uuid, text, numeric) to authenticated;
grant execute on function public.set_settled(uuid, uuid, uuid, numeric) to authenticated;
grant execute on function public.book_match(uuid, text, text, text, numeric) to authenticated;
grant execute on function public.remove_player(uuid, uuid) to authenticated;
grant execute on function public.waive_share(uuid, uuid) to authenticated;
grant execute on function public.add_player(uuid, uuid, text) to authenticated;
grant execute on function public.set_court_order(uuid, uuid[]) to authenticated;
grant execute on function public.my_players() to authenticated;
grant execute on function public.create_guest(text) to authenticated;
grant execute on function public.log_game(uuid, uuid, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.delete_game(uuid) to authenticated;
grant execute on function public.get_leaderboard() to authenticated;
