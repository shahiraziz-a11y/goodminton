-- Book courts one at a time. Each court is booked (and paid) on its own, by the
-- organiser or any confirmed player. Booking a court locks in only the players on
-- that court; the others can still drop out until their court is booked too.
-- Costs are split between the players on booked courts.
-- Run once, after 0008.

do $$ begin
  if to_regprocedure('public.first_name(uuid)') is null then
    raise exception 'Run 0008_home_groups.sql first, then this file.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Which court each confirmed player is on (null on the waitlist).
alter table public.match_players add column court smallint check (court between 1 and 4);

-- A row per booked court.
create table public.match_courts (
  match_id uuid not null references public.matches (id) on delete cascade,
  court smallint not null check (court between 1 and 4),
  label text not null check (char_length(label) between 1 and 30),
  cost numeric(10, 2) not null default 0 check (cost >= 0),
  booked_by uuid not null references public.profiles (id),
  booked_at timestamptz not null default now(),
  primary key (match_id, court)
);
alter table public.match_courts enable row level security;
revoke all on table public.match_courts from anon, authenticated;

alter table public.expenses add column court smallint;
-- "Court 3 & Court 4 & …" for up to four booked courts.
alter table public.matches drop constraint if exists matches_courts_check;
alter table public.matches add constraint matches_courts_check check (char_length(courts) <= 200);

-- Existing matches: confirmed players fill courts in join order; booked matches
-- have every court booked by the organiser at the per-court cost.
update public.match_players mp set court = least(x.c, x.court_count)
  from (select mp2.match_id, mp2.user_id, m.court_count,
               (row_number() over (partition by mp2.match_id order by mp2.seq) - 1)
                 / (case m.format when 'singles' then 2 else 4 end) + 1 as c
          from public.match_players mp2 join public.matches m on m.id = mp2.match_id
         where mp2.status = 'confirmed') x
 where mp.match_id = x.match_id and mp.user_id = x.user_id;

insert into public.match_courts (match_id, court, label, cost, booked_by, booked_at)
select m.id, g.c,
       left(coalesce(nullif(btrim((string_to_array(public.resize_courts(m.courts, m.court_count), ' & '))[g.c]), ''), 'Court ' || g.c), 30),
       m.court_cost, m.organiser_id, coalesce(m.booked_at, now())
  from public.matches m cross join lateral generate_series(1, m.court_count) g(c)
 where m.status = 'booked';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function public.court_booked(p_match uuid, p_court int) returns boolean
language sql stable set search_path = public as $$
  select p_court is not null and exists (select 1 from public.match_courts where match_id = p_match and court = p_court);
$$;

create function public.split_ready(p_match uuid) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from public.match_courts where match_id = p_match and cost > 0);
$$;

-- The court a newly confirmed player goes on: an open spot on a booked court first
-- (it's already paid for), then the lowest-numbered court with room.
create function public.free_court(m public.matches) returns int
language sql stable set search_path = public as $$
  select c from generate_series(1, m.court_count) c
   where (select count(*) from public.match_players
           where match_id = m.id and status = 'confirmed' and court = c) < public.per_court(m)
   order by public.court_booked(m.id, c) desc, c
   limit 1;
$$;

-- Every confirmed player gets a court; the waitlist has none.
create function public.assign_court() returns trigger
language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  if new.status = 'waitlist' then
    new.court := null;
  elsif new.court is null and (tg_op = 'INSERT' or old.status = 'waitlist') then
    select * into m from public.matches where id = new.match_id;
    new.court := public.free_court(m);
  end if;
  return new;
end $$;

create trigger match_players_assign_court
  before insert or update of status on public.match_players
  for each row execute function public.assign_court();

create or replace function public.fill_from_waitlist(m public.matches) returns uuid[]
language plpgsql set search_path = public as $$
declare
  nxt uuid;
  promoted uuid[] := '{}';
begin
  while public.free_court(m) is not null loop
    select user_id into nxt from public.match_players
     where match_id = m.id and status = 'waitlist' order by seq limit 1;
    exit when nxt is null;
    update public.match_players
       set status = 'confirmed', promoted = true, seq = nextval('public.match_players_seq')
     where match_id = m.id and user_id = nxt;
    promoted := promoted || nxt;
  end loop;
  return promoted;
end $$;

-- After the courts or format change: players on courts that no longer exist, or
-- beyond a court's capacity, move to free spots; if none, to the front of the
-- waitlist (earlier joiners stay ahead). The organiser always keeps a spot.
create function public.repack(p_match uuid) returns jsonb
language plpgsql set search_path = public as $$
declare
  m public.matches;
  k int;
  c int;
  demoted int := 0;
  front bigint;
  promoted uuid[];
  r record;
begin
  select * into m from public.matches where id = p_match;
  k := public.per_court(m);
  update public.match_players set court = null
   where match_id = m.id and status = 'confirmed' and (court is null or court > m.court_count);
  update public.match_players mp set court = null
    from (select user_id, row_number() over (partition by court order by (user_id = m.organiser_id) desc, seq) as rn
            from public.match_players where match_id = m.id and status = 'confirmed' and court is not null) x
   where mp.match_id = m.id and mp.user_id = x.user_id and x.rn > k;
  for r in
    select user_id from public.match_players
     where match_id = m.id and status = 'confirmed' and court is null
     order by (user_id = m.organiser_id) desc, seq
  loop
    c := public.free_court(m);
    exit when c is null;
    update public.match_players set court = c where match_id = m.id and user_id = r.user_id;
  end loop;
  select coalesce(min(seq), 0) into front from public.match_players where match_id = m.id;
  for r in
    select user_id from public.match_players
     where match_id = m.id and status = 'confirmed' and court is null
     order by seq desc
  loop
    demoted := demoted + 1;
    update public.match_players set status = 'waitlist', seq = front - demoted
     where match_id = m.id and user_id = r.user_id;
  end loop;
  promoted := public.fill_from_waitlist(m);
  return jsonb_build_object('demoted', demoted, 'promoted', coalesce(array_length(promoted, 1), 0));
end $$;

-- One court expense per booked court with a cost, paid by whoever booked it.
create or replace function public.sync_court_expense(p_match uuid) returns void
language plpgsql set search_path = public as $$
begin
  delete from public.expenses where match_id = p_match and kind = 'court';
  insert into public.expenses (match_id, label, amount, paid_by, kind, court, created_at)
  select match_id, left(case when label ~* '^court' then label else 'Court ' || label end || ' booking', 80),
         cost, booked_by, 'court', court, booked_at
    from public.match_courts where match_id = p_match and cost > 0;
end $$;

-- Keep the match's summary fields in step with its booked courts.
create function public.refresh_bookings(p_match uuid) returns void
language plpgsql set search_path = public as $$
begin
  update public.matches m
     set status = case when exists (select 1 from public.match_courts where match_id = m.id) then 'booked' else 'planning' end,
         courts = coalesce((select string_agg(label, ' & ' order by court) from public.match_courts where match_id = m.id), ''),
         booked_at = (select min(booked_at) from public.match_courts where match_id = m.id)
   where m.id = p_match;
  perform public.sync_court_expense(p_match);
end $$;

-- Who owes a share: before any booking, everyone confirmed (a preview; nothing is
-- charged). After, the players on booked courts, plus players removed from a booked
-- court while their spot is still empty (most recently removed first).
create or replace function public.share_holders(p_match uuid) returns uuid[]
language sql stable set search_path = public as $$
  with m as (select * from public.matches where id = p_match),
  booked as (select court from public.match_courts where match_id = p_match),
  conf as (
    select user_id, seq from public.match_players
     where match_id = p_match and status = 'confirmed'
       and (not exists (select 1 from booked) or court in (select court from booked))
  ),
  owing as (
    select l.user_id, l.created_at from public.match_liable l
     where l.match_id = p_match
       and l.user_id not in (select user_id from public.match_players where match_id = p_match and status = 'confirmed')
     order by l.created_at desc
     limit greatest((select count(*) from booked) * (select case format when 'singles' then 2 else 4 end from m)
                    - (select count(*) from conf where exists (select 1 from booked)), 0)
  )
  select coalesce(array_agg(user_id order by o, k), '{}') from (
    select user_id, 0 as o, seq::numeric as k from conf
    union all
    select user_id, 1, extract(epoch from created_at)::numeric from owing
  ) x;
$$;

-- ---------------------------------------------------------------------------
-- Booking
-- ---------------------------------------------------------------------------

-- Book a court (or edit its details). The organiser or any confirmed player can book;
-- only whoever booked it, or the organiser, can change it. The booker pays the court.
create function public.book_court(
  p_match uuid, p_court int, p_venue text, p_label text, p_parking text, p_cost numeric
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  m public.matches := public.lock_match(p_match);
  cur public.match_courts;
  is_new boolean;
begin
  if me <> m.organiser_id and not exists (
    select 1 from public.match_players where match_id = m.id and user_id = me and status = 'confirmed') then
    raise exception 'Only players in this match can book a court';
  end if;
  if public.match_past(m) then raise exception 'This match has already been played'; end if;
  if p_court is null or p_court not between 1 and m.court_count then raise exception 'That court isn''t part of this match'; end if;
  if btrim(coalesce(p_venue, '')) = '' then raise exception 'Add the venue'; end if;
  if btrim(coalesce(p_label, '')) = '' then raise exception 'Add the court number'; end if;
  if coalesce(p_cost, 0) < 0 then raise exception 'Court cost can''t be negative'; end if;
  select * into cur from public.match_courts where match_id = m.id and court = p_court;
  is_new := not found;
  if not is_new and me <> m.organiser_id and me <> cur.booked_by then
    raise exception 'Only % or the organiser can change this booking', public.first_name(cur.booked_by);
  end if;
  -- Venue first, so the booking alert names it.
  update public.matches
     set venue = left(btrim(p_venue), 120), parking = left(btrim(coalesce(p_parking, '')), 200),
         court_cost = coalesce(p_cost, 0)
   where id = m.id;
  insert into public.match_courts (match_id, court, label, cost, booked_by)
  values (m.id, p_court, left(btrim(p_label), 30), coalesce(p_cost, 0), me)
  on conflict (match_id, court) do update set label = excluded.label, cost = excluded.cost;
  perform public.refresh_bookings(m.id);
  return jsonb_build_object('court', p_court, 'new', is_new);
end $$;

-- Undo a booking (e.g. booked by mistake). Players on that court can drop out again.
create function public.cancel_court(p_match uuid, p_court int) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  m public.matches := public.lock_match(p_match);
  cur public.match_courts;
begin
  select * into cur from public.match_courts where match_id = m.id and court = p_court;
  if not found then raise exception 'That court isn''t booked'; end if;
  if me <> m.organiser_id and me <> cur.booked_by then
    raise exception 'Only % or the organiser can cancel this booking', public.first_name(cur.booked_by);
  end if;
  if public.match_past(m) then raise exception 'This match has already been played'; end if;
  delete from public.match_courts where match_id = m.id and court = p_court;
  perform public.prune_debts(m.id);
  perform public.refresh_bookings(m.id);
end $$;

-- The previous all-at-once booking, kept for apps that haven't updated yet:
-- the organiser books every court (optionally first dropping to p_court_count).
create or replace function public.book_match(
  p_match uuid, p_venue text, p_courts text, p_parking text, p_court_cost numeric, p_court_count int default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.matches := public.lock_match(p_match);
  moved jsonb := jsonb_build_object('demoted', 0, 'promoted', 0);
  labels text[];
begin
  perform public.require_organiser(m);
  if btrim(coalesce(p_venue, '')) = '' then raise exception 'Add the venue'; end if;
  if btrim(coalesce(p_courts, '')) = '' then raise exception 'Add the court number'; end if;
  if coalesce(p_court_cost, 0) < 0 then raise exception 'Court cost can''t be negative'; end if;
  if public.match_past(m) then raise exception 'This match has already been played'; end if;
  if p_court_count is not null then
    moved := public.apply_court_count(m.id, p_court_count);
    select * into m from public.matches where id = m.id;
  end if;
  update public.matches
     set venue = btrim(p_venue), parking = btrim(coalesce(p_parking, '')), court_cost = coalesce(p_court_cost, 0)
   where id = m.id;
  labels := string_to_array(public.resize_courts(btrim(p_courts), m.court_count), ' & ');
  for c in 1..m.court_count loop
    insert into public.match_courts (match_id, court, label, cost, booked_by)
    values (m.id, c, left(btrim(labels[c]), 30), coalesce(p_court_cost, 0), auth.uid())
    on conflict (match_id, court) do update set label = excluded.label, cost = excluded.cost;
  end loop;
  perform public.refresh_bookings(m.id);
  return moved;
end $$;

-- ---------------------------------------------------------------------------
-- Courts and players
-- ---------------------------------------------------------------------------

create or replace function public.apply_court_count(p_match uuid, p_court_count int) returns jsonb
language plpgsql set search_path = public as $$
declare
  m public.matches;
  res jsonb;
begin
  select * into m from public.matches where id = p_match;
  if p_court_count not between 1 and 4 then raise exception 'Pick 1 to 4 courts'; end if;
  if p_court_count = m.court_count then return jsonb_build_object('demoted', 0, 'promoted', 0); end if;
  perform public.prune_debts(m.id);
  delete from public.match_courts where match_id = m.id and court > p_court_count;
  update public.matches set court_count = p_court_count, size = p_court_count * public.per_court(m) where id = m.id;
  res := public.repack(m.id);
  perform public.prune_debts(m.id);
  perform public.refresh_bookings(m.id);
  return res;
end $$;

-- Dropping courts cancels their bookings; their players move to free spots or the waitlist.
create or replace function public.update_match(
  p_match uuid, p_title text, p_format text, p_court_count int,
  p_date date, p_time time, p_duration_min int, p_rsvp_close_hours int
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.matches := public.lock_match(p_match);
  res jsonb;
begin
  perform public.require_organiser(m);
  if public.match_past(m) then raise exception 'This match has already been played'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 80 then raise exception 'Add a match name'; end if;
  if p_format not in ('singles', 'doubles') then raise exception 'Pick singles or doubles'; end if;
  if p_court_count not between 1 and 4 then raise exception 'Pick 1 to 4 courts'; end if;
  if p_duration_min not in (60, 90, 120) then raise exception 'Pick a duration'; end if;
  if p_rsvp_close_hours not in (2, 6, 24) then raise exception 'Pick when RSVPs close'; end if;
  perform public.prune_debts(m.id);
  delete from public.match_courts where match_id = m.id and court > p_court_count;
  update public.matches
     set title = btrim(p_title), format = p_format, court_count = p_court_count,
         size = p_court_count * case p_format when 'singles' then 2 else 4 end,
         starts_at = (p_date + p_time) at time zone timezone,
         duration_min = p_duration_min, rsvp_close_hours = p_rsvp_close_hours
   where id = m.id;
  res := public.repack(m.id);
  perform public.prune_debts(m.id);
  perform public.refresh_bookings(m.id);
  return res;
end $$;

-- Opens another court for the waitlist. It isn't booked: book it when you're ready.
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
  perform public.prune_debts(m.id);
  update public.matches set court_count = court_count + 1, size = size + public.per_court(m)
   where id = m.id returning * into m;
  perform public.fill_from_waitlist(m);
  perform public.prune_debts(m.id);
  perform public.refresh_bookings(m.id);
end $$;

-- Players on a booked court are locked in; everyone else can still drop out.
create or replace function public.leave_match(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  m public.matches := public.lock_match(p_match);
  my_status text;
  my_court int;
  promoted uuid[];
begin
  if me = m.organiser_id then raise exception 'Organisers can''t drop out of their own match'; end if;
  if public.match_past(m) then raise exception 'This match has already been played'; end if;
  select status, court into my_status, my_court from public.match_players where match_id = m.id and user_id = me;
  if my_status is null then raise exception 'You''re not in this match'; end if;
  if my_status = 'confirmed' and public.court_booked(m.id, my_court) then
    raise exception 'Your court is booked, so you''re locked in. Ask the organiser to remove you.';
  end if;
  delete from public.match_players where match_id = m.id and user_id = me;
  if my_status = 'confirmed' then promoted := public.fill_from_waitlist(m); end if;
  return jsonb_build_object('status', my_status, 'promoted',
    (select full_name from public.profiles where id = promoted[1]));
end $$;

create or replace function public.remove_player(p_match uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  m public.matches := public.lock_match(p_match);
  v_status text;
  v_court int;
  v_added_by uuid;
  promoted uuid[];
begin
  if p_user = m.organiser_id then raise exception 'The organiser can''t be removed'; end if;
  select status, court, added_by into v_status, v_court, v_added_by from public.match_players where match_id = m.id and user_id = p_user;
  if v_status is null then raise exception 'That player isn''t in this match'; end if;
  if me <> m.organiser_id and me is distinct from v_added_by then
    raise exception 'Only the organiser or whoever added them can remove a player';
  end if;
  delete from public.match_players where match_id = m.id and user_id = p_user;
  if v_status = 'confirmed' and public.court_booked(m.id, v_court) then
    insert into public.match_liable (match_id, user_id) values (m.id, p_user)
    on conflict (match_id, user_id) do update set created_at = now();
  end if;
  if v_status = 'confirmed' then promoted := public.fill_from_waitlist(m); end if;
  return jsonb_build_object('status', v_status, 'still_owes', p_user = any (public.share_holders(m.id)),
    'promoted', (select full_name from public.profiles where id = promoted[1]));
end $$;

-- Reorder the players on one court (pairs: first two vs last two).
create or replace function public.set_court_order(p_match uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  m public.matches := public.lock_match(p_match);
  k int := public.per_court(m);
  seqs bigint[];
begin
  if me <> m.organiser_id and not exists (
    select 1 from public.match_players where match_id = m.id and user_id = me and status = 'confirmed') then
    raise exception 'Only players in this match can change pairs';
  end if;
  if coalesce(array_length(p_ids, 1), 0) <> k or (select count(distinct x) from unnest(p_ids) x) <> k then
    raise exception 'Pick % different players', k;
  end if;
  if (select count(*) from public.match_players where match_id = m.id and status = 'confirmed' and user_id = any (p_ids)) <> k
     or (select count(distinct court) from public.match_players where match_id = m.id and user_id = any (p_ids)) <> 1 then
    raise exception 'Those players aren''t on the same court';
  end if;
  select array_agg(seq order by seq) into seqs from public.match_players where match_id = m.id and user_id = any (p_ids);
  for i in 1..k loop
    update public.match_players set seq = seqs[i] where match_id = m.id and user_id = p_ids[i];
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Alerts
-- ---------------------------------------------------------------------------

-- A court is booked: tell its players, and the organiser if someone else booked it.
create function public.on_court_booked() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
  r record;
begin
  select * into m from public.matches where id = new.match_id;
  if public.match_past(m) then return null; end if;
  for r in select user_id from public.match_players where match_id = m.id and status = 'confirmed' and court = new.court loop
    perform public.notify(r.user_id, m, 'booked',
      case when r.user_id = m.organiser_id and new.booked_by <> m.organiser_id
           then public.first_name(new.booked_by) || ' booked a court' else 'Court booked 🏸' end,
      m.title || ' · ' || public.when_label(m) || ' · ' || m.venue || ' · ' || new.label);
  end loop;
  if not exists (select 1 from public.match_players where match_id = m.id and user_id = m.organiser_id and court = new.court) then
    perform public.notify(m.organiser_id, m, 'booked', public.first_name(new.booked_by) || ' booked a court',
      m.title || ' · ' || new.label);
  end if;
  return null;
end $$;

create trigger match_courts_notify
  after insert on public.match_courts
  for each row execute function public.on_court_booked();

-- New courts and time changes (bookings are announced per court above).
create or replace function public.on_match_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if public.match_past(new) then return null; end if;
  for r in select user_id, status from public.match_players where match_id = new.id and user_id <> new.organiser_id loop
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

create or replace function public.on_player_change() returns trigger
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
    if actor is distinct from new.user_id then
      -- Someone added them: tell them, and tell the organiser if it wasn't the organiser.
      perform public.notify(new.user_id, m, 'added', public.first_name(actor) || ' added you to ' || m.title,
        case when new.status = 'confirmed' then 'You''re in · ' else 'You''re on the waitlist · ' end || public.when_label(m));
      if actor is distinct from m.organiser_id then
        perform public.notify(m.organiser_id, m, 'joined',
          public.first_name(actor) || ' added ' || public.first_name(new.user_id) || ' to ' || m.title,
          n_conf || '/' || m.size || ' confirmed' || case when n_wait > 0 then ' · ' || n_wait || ' waiting' else '' end);
      end if;
    else
      perform public.notify(m.organiser_id, m, 'joined',
        public.first_name(new.user_id) || case when new.status = 'confirmed' then ' joined ' else ' joined the waitlist for ' end || m.title,
        n_conf || '/' || m.size || ' confirmed' || case when n_wait > 0 then ' · ' || n_wait || ' waiting' else '' end);
    end if;
    if new.status = 'confirmed' and n_conf = m.size and actor is distinct from m.organiser_id then
      perform public.notify(m.organiser_id, m, 'full', m.title || ' is full',
        m.size || '/' || m.size || ' confirmed.' || case when m.status = 'planning' then ' Time to book the court.' else ' Book the open court when you''re ready.' end);
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
      || case when old.status = 'confirmed' and public.court_booked(m.id, old.court)
              then ' The court is booked, so you still owe your share unless someone takes your spot.' else '' end);
  end if;
  return null;
end $$;

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
             else jsonb_build_object('hidden', true) end || jsonb_build_object('court', mp.court) order by mp.court, mp.seq)
        from public.match_players mp join public.profiles p on p.id = mp.user_id
       where mp.match_id = m.id and mp.status = 'confirmed'), '[]'::jsonb),
    'waitlist', case when is_org then coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'is_guest', p.is_guest) order by mp.seq)
        from public.match_players mp join public.profiles p on p.id = mp.user_id
       where mp.match_id = m.id and mp.status = 'waitlist'), '[]'::jsonb) end,
    'liable', case when can_see then coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name) order by l.created_at)
        from public.match_liable l join public.profiles p on p.id = l.user_id
       where l.match_id = m.id and l.user_id = any (public.share_holders(m.id))
         and not exists (select 1 from public.match_players mp
                          where mp.match_id = m.id and mp.user_id = l.user_id and mp.status = 'confirmed')), '[]'::jsonb) end,
    'split_ids', case when can_see then to_jsonb(public.split_ids(m.id)) end,
    'split_ready', public.split_ready(m.id),
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
     where m.organiser_id = auth.uid()
        or exists (select 1 from public.match_players where match_id = m.id and user_id = auth.uid())
  ) x;
$$;

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
                               union select unnest(public.split_ids(m.id))))
  ) order by m.starts_at desc), '[]'::jsonb)
  from public.matches m
  where public.split_ready(m.id)
    and (m.organiser_id = auth.uid() or auth.uid() = any (public.split_ids(m.id))
         -- Paid for something (e.g. booked a court) and then dropped out: still owed.
         or exists (select 1 from public.expenses e where e.match_id = m.id and e.paid_by = auth.uid()));
$$;

create or replace function public.add_expense(p_match uuid, p_label text, p_amount numeric) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  m public.matches := public.lock_match(p_match);
begin
  if me <> m.organiser_id and not exists (
    select 1 from public.match_players where match_id = m.id and user_id = me and status = 'confirmed') then
    raise exception 'Only confirmed players can add expenses';
  end if;
  if not public.split_ready(m.id) then
    raise exception 'Costs are split once the court is booked and its cost is entered';
  end if;
  insert into public.expenses (match_id, label, amount, paid_by) values (m.id, btrim(p_label), p_amount, me);
end $$;

-- Existing bookings: one court expense per court (same total as before).
select public.sync_court_expense(id) from public.matches where status = 'booked';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.court_booked(uuid, int) from public, anon, authenticated;
revoke all on function public.split_ready(uuid) from public, anon, authenticated;
revoke all on function public.free_court(public.matches) from public, anon, authenticated;
revoke all on function public.assign_court() from public, anon, authenticated;
revoke all on function public.repack(uuid) from public, anon, authenticated;
revoke all on function public.refresh_bookings(uuid) from public, anon, authenticated;
revoke all on function public.on_court_booked() from public, anon, authenticated;
revoke all on function public.book_court(uuid, int, text, text, text, numeric) from public, anon;
revoke all on function public.cancel_court(uuid, int) from public, anon;
grant execute on function public.book_court(uuid, int, text, text, text, numeric) to authenticated;
grant execute on function public.cancel_court(uuid, int) to authenticated;
