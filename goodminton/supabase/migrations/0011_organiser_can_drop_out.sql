-- The organiser can drop out (and back in) like anyone else. They stay the
-- organiser: they still edit the match, book courts, add and remove players and
-- see the cost split; the next person waiting takes their spot.
-- Run once, after 0010. Safe to run again.

do $$ begin
  if to_regprocedure('public.book_court(uuid, integer, text, text, text, numeric)') is null then
    raise exception 'Run 0009 and 0010 first, then this file.';
  end if;
end $$;

-- Players on a booked court are locked in, except the organiser, who can step out
-- but (like a removed player) still owes their share until someone takes the spot.
create or replace function public.leave_match(p_match uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  m public.matches := public.lock_match(p_match);
  my_status text;
  my_court int;
  booked boolean;
  promoted uuid[];
begin
  if public.match_past(m) then raise exception 'This match has already been played'; end if;
  select status, court into my_status, my_court from public.match_players where match_id = m.id and user_id = me;
  if my_status is null then raise exception 'You''re not in this match'; end if;
  booked := my_status = 'confirmed' and public.court_booked(m.id, my_court);
  if booked and me <> m.organiser_id then
    raise exception 'Your court is booked, so you''re locked in. Ask the organiser to remove you.';
  end if;
  delete from public.match_players where match_id = m.id and user_id = me;
  if booked then
    insert into public.match_liable (match_id, user_id) values (m.id, me)
    on conflict (match_id, user_id) do update set created_at = now();
  end if;
  if my_status = 'confirmed' then promoted := public.fill_from_waitlist(m); end if;
  return jsonb_build_object('status', my_status, 'still_owes', me = any (public.share_holders(m.id)),
    'promoted', (select full_name from public.profiles where id = promoted[1]));
end $$;

-- The organiser can rejoin their own match even after sign-ups close.
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
-- Logging a game in a match saves its pairs as the court's order, so the next
-- "Log result" (and the court picture) starts with the same pairs until someone
-- shuffles, balances or logs a different pairing.
create or replace function public.keep_last_pairing() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ids uuid[] := array_remove(array[new.a1, new.a2, new.b1, new.b2], null);
  seqs bigint[];
begin
  if new.match_id is null then return null; end if;
  -- Only when the game is exactly one court's players.
  if (select count(*) from public.match_players
       where match_id = new.match_id and status = 'confirmed' and user_id = any (ids)) <> cardinality(ids)
     or (select count(distinct court) from public.match_players where match_id = new.match_id and user_id = any (ids)) <> 1
     or (select count(*) from public.match_players mp
          where mp.match_id = new.match_id and mp.status = 'confirmed'
            and mp.court = (select court from public.match_players where match_id = new.match_id and user_id = ids[1])) <> cardinality(ids) then
    return null;
  end if;
  select array_agg(seq order by seq) into seqs from public.match_players where match_id = new.match_id and user_id = any (ids);
  for i in 1..cardinality(ids) loop
    update public.match_players set seq = seqs[i] where match_id = new.match_id and user_id = ids[i];
  end loop;
  return null;
end $$;

drop trigger if exists games_keep_pairing on public.games;
create trigger games_keep_pairing
  after insert on public.games
  for each row execute function public.keep_last_pairing();

revoke all on function public.keep_last_pairing() from public, anon, authenticated;
