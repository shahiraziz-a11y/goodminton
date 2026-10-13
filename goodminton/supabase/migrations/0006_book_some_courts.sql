-- Book only the courts you can fill. Planned 2 courts but only 5 signed up? Book 1:
-- the first 4 are confirmed and locked in, court 2 is dropped, and the 5th goes to
-- the front of the waitlist. "Open another court" brings court 2 back later.
-- Run once, after 0005.

-- Change the number of courts: the latest joiners (never the organiser) move to the
-- front of the waitlist when spots shrink; the waitlist moves up when they grow.
create function public.apply_court_count(p_match uuid, p_court_count int) returns jsonb
language plpgsql set search_path = public as $$
declare
  m public.matches;
  v_size int;
  n_conf int;
  demoted int := 0;
  promoted uuid[];
  front bigint;
  r record;
begin
  select * into m from public.matches where id = p_match;
  if p_court_count not between 1 and 4 then raise exception 'Pick 1 to 4 courts'; end if;
  if p_court_count = m.court_count then return jsonb_build_object('demoted', 0, 'promoted', 0); end if;
  v_size := p_court_count * public.per_court(m);
  perform public.prune_debts(m.id);
  update public.matches
     set court_count = p_court_count, size = v_size, courts = public.resize_courts(courts, p_court_count)
   where id = m.id returning * into m;

  select count(*) into n_conf from public.match_players where match_id = m.id and status = 'confirmed';
  if n_conf > v_size then
    select coalesce(min(seq), 0) into front from public.match_players where match_id = m.id;
    for r in
      select user_id from public.match_players
       where match_id = m.id and status = 'confirmed' and user_id <> m.organiser_id
       order by seq desc limit n_conf - v_size
    loop
      demoted := demoted + 1;
      update public.match_players set status = 'waitlist', seq = front - demoted
       where match_id = m.id and user_id = r.user_id;
    end loop;
  else
    promoted := public.fill_from_waitlist(m);
  end if;
  perform public.prune_debts(m.id);
  return jsonb_build_object('demoted', demoted, 'promoted', coalesce(array_length(promoted, 1), 0));
end $$;

drop function public.book_match(uuid, text, text, text, numeric);

-- Court booked (or details edited). p_court_count = how many courts were booked;
-- null keeps the current number. Returns how many moved to / from the waitlist.
create function public.book_match(
  p_match uuid, p_venue text, p_courts text, p_parking text, p_court_cost numeric, p_court_count int default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.matches := public.lock_match(p_match);
  moved jsonb := jsonb_build_object('demoted', 0, 'promoted', 0);
begin
  perform public.require_organiser(m);
  if btrim(coalesce(p_venue, '')) = '' then raise exception 'Add the venue'; end if;
  if btrim(coalesce(p_courts, '')) = '' then raise exception 'Add the court number'; end if;
  if coalesce(p_court_cost, 0) < 0 then raise exception 'Court cost can''t be negative'; end if;
  if public.match_past(m) then raise exception 'This match has already been played'; end if;

  -- Resize first, so booking alerts go to the players who actually got a court.
  if p_court_count is not null then
    moved := public.apply_court_count(m.id, p_court_count);
    select * into m from public.matches where id = m.id;
  end if;

  update public.matches
     set status = 'booked', booked_at = coalesce(booked_at, now()),
         venue = btrim(p_venue), courts = public.resize_courts(btrim(p_courts), court_count),
         parking = btrim(coalesce(p_parking, '')), court_cost = coalesce(p_court_cost, 0)
   where id = m.id;
  perform public.sync_court_expense(m.id);
  return moved;
end $$;

revoke all on function public.apply_court_count(uuid, int) from public, anon, authenticated;
revoke all on function public.book_match(uuid, text, text, text, numeric, int) from public, anon;
grant execute on function public.book_match(uuid, text, text, text, numeric, int) to authenticated;
