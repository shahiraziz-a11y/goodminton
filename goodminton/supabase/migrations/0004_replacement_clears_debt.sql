-- A player removed after booking owes their share only while their spot is empty.
-- When someone takes it (waitlist, a new join, or the organiser adding someone), their
-- debt clears for good; earliest-removed clears first. Adding a court doesn't clear
-- debts by itself, but once the match is full again nobody is covering an empty spot.
-- Run once, after 0003.

-- Who splits the costs: confirmed players, plus the most recently removed players
-- for as many spots as are still empty.
create or replace function public.split_ids(p_match uuid) returns uuid[]
language sql stable set search_path = public as $$
  with m as (select size from public.matches where id = p_match),
  conf as (select user_id, seq from public.match_players where match_id = p_match and status = 'confirmed'),
  owing as (
    select l.user_id, l.created_at from public.match_liable l
     where l.match_id = p_match and l.user_id not in (select user_id from conf)
     order by l.created_at desc
     limit greatest((select size from m) - (select count(*) from conf), 0)
  )
  select coalesce(array_agg(user_id order by o, k), '{}') from (
    select user_id, 0 as o, seq::numeric as k from conf
    union all
    select user_id, 1, extract(epoch from created_at)::numeric from owing
  ) x;
$$;

-- Clearing is permanent: drop debts that are no longer covering an empty spot,
-- so adding a court later can't bring a settled debt back.
create function public.prune_debts(p_match uuid) returns void
language sql set search_path = public as $$
  delete from public.match_liable
   where match_id = p_match and not (user_id = any (public.split_ids(p_match)));
  delete from public.match_liable l
   where l.match_id = p_match
     and exists (select 1 from public.match_players mp
                  where mp.match_id = p_match and mp.user_id = l.user_id and mp.status = 'confirmed');
$$;

create function public.prune_debts_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.prune_debts(coalesce(new.match_id, old.match_id));
  return null;
end $$;
create trigger match_players_prune_debts
  after insert or update or delete on public.match_players
  for each row execute function public.prune_debts_trigger();

-- Editing or adding courts: settle what's already covered before spots change, and after.
create or replace function public.update_match(
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
  perform public.prune_debts(m.id);

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

  perform public.prune_debts(m.id);
  perform public.sync_court_expense(m.id);
  return jsonb_build_object('demoted', demoted, 'promoted', coalesce(array_length(promoted, 1), 0));
end $$;

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
  update public.matches
     set court_count = court_count + 1, size = size + public.per_court(m),
         courts = public.resize_courts(courts, court_count + 1)
   where id = m.id returning * into m;
  perform public.fill_from_waitlist(m);
  perform public.prune_debts(m.id);
  perform public.sync_court_expense(m.id);
end $$;

-- still_owes now reflects whether anyone took the spot straight away.
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
    insert into public.match_liable (match_id, user_id) values (m.id, p_user)
    on conflict (match_id, user_id) do update set created_at = now();
  end if;
  if v_status = 'confirmed' then promoted := public.fill_from_waitlist(m); end if;
  return jsonb_build_object('status', v_status, 'still_owes', p_user = any (public.split_ids(m.id)),
    'promoted', (select full_name from public.profiles where id = promoted[1]));
end $$;

revoke all on function public.split_ids(uuid) from public, anon, authenticated;
revoke all on function public.prune_debts(uuid) from public, anon, authenticated;
revoke all on function public.prune_debts_trigger() from public, anon, authenticated;
revoke all on function public.update_match(uuid, text, text, int, date, time, int, int) from public, anon;
revoke all on function public.upgrade_match(uuid) from public, anon;
grant execute on function public.update_match(uuid, text, text, int, date, time, int, int) to authenticated;
grant execute on function public.upgrade_match(uuid) to authenticated;
revoke all on function public.remove_player(uuid, uuid) from public, anon;
grant execute on function public.remove_player(uuid, uuid) to authenticated;
