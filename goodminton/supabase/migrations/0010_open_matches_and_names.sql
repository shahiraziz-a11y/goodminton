-- Everyone signed in sees every match on their home page, and player names are
-- never hidden (not when a match is full, not on the waitlist, not to people
-- opening a shared link). Court numbers and costs stay with confirmed players.
-- Run once, after 0009. Safe to run again.

do $$ begin
  if to_regprocedure('public.book_court(uuid, integer, text, text, text, numeric)') is null then
    raise exception 'Run 0009_book_courts_one_at_a_time.sql first, then this file.';
  end if;
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

create or replace function public.my_matches() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.past, case when x.past then null else x.starts_at end, x.starts_at desc), '[]'::jsonb)
  from (
    select m.slug, m.title, m.venue, m.size, m.format, m.court_count, m.starts_at, m.duration_min, m.timezone, m.status,
           now() >= m.starts_at as started,
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
