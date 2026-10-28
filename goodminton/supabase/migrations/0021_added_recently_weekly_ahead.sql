-- 1. Add player: remember who I added before, so they can go at the top of my list.
-- 2. Weekly matches: always have this week's and next week's match made, not just
--    next week's once this one starts. "Repeat weekly" now belongs to the whole series.
-- Run once, after 0020. Safe to run again.

do $$ begin
  if to_regprocedure('public.player_stats(uuid, timestamp with time zone)') is null then
    raise exception 'Run 0020_streak_weeks.sql first, then this file.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. my_players also says when I last added each person (null if never).
-- ---------------------------------------------------------------------------

create or replace function public.my_players(p_group uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'is_guest', p.is_guest,
                                               'added_at', a.added_at)
                            order by p.id <> auth.uid(), lower(p.full_name)), '[]'::jsonb)
    from public.profiles p
    left join lateral (select max(mp.joined_at) as added_at from public.match_players mp
                        where mp.user_id = p.id and mp.added_by = auth.uid() and p.id <> auth.uid()) a on true
   where case when p_group is null then p.id in (select public.circle_of(auth.uid()))
              else public.is_member(p_group, auth.uid())
                   and (p.id = auth.uid() or public.is_member(p_group, p.id)) end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Weekly matches, two weeks ahead.
-- ---------------------------------------------------------------------------

-- Keep every weekly series stocked: while its latest match starts within the next
-- 7 days, make the one a week after it. So this week's and next week's always exist.
-- p_series limits it to one series (used when the organiser turns repeat on).
drop function if exists public.roll_recurring(timestamptz);
create or replace function public.roll_recurring(p_now timestamptz default now(), p_series uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
  n public.matches;
  made int := 0;
  r record;
  v_series uuid;
  v_regulars uuid[];
  k int;
begin
  -- The 5-minute job and an organiser's tap could both run this; one at a time.
  perform pg_advisory_xact_lock(hashtext('goodminton-roll-recurring'));
  for v_series in
    select distinct coalesce(series_id, id) from public.matches
     where repeat_weekly and (p_series is null or coalesce(series_id, id) = p_series)
  loop
    -- At most two new weeks per run: a series left alone for months doesn't refill the past.
    for k in 1..2 loop
      select * into m from public.matches where coalesce(series_id, id) = v_series order by starts_at desc limit 1;
      exit when not m.repeat_weekly or m.starts_at > p_now + interval '7 days'
             or m.starts_at < p_now - interval '7 days';
      select coalesce(array_agg(mp.user_id order by mp.seq), '{}') into v_regulars
        from public.match_players mp join public.profiles p on p.id = mp.user_id
       where mp.match_id = m.id and mp.status = 'confirmed' and not p.is_guest;
      insert into public.matches (slug, organiser_id, title, format, court_count, size, venue, parking, starts_at,
                                  duration_min, rsvp_close_hours, court_cost, currency, timezone,
                                  repeat_weekly, regulars_first, series_id, regulars, group_id)
      values (coalesce(nullif(left(trim(both '-' from regexp_replace(lower(m.title), '[^a-z0-9]+', '-', 'g')), 24), ''), 'match')
                || '-' || substr(md5(gen_random_uuid()::text), 1, 6),
              m.organiser_id, m.title, m.format, m.court_count, m.size, m.venue, m.parking, m.starts_at + interval '7 days',
              m.duration_min, m.rsvp_close_hours, m.court_cost, m.currency, m.timezone,
              true, false, v_series, v_regulars, m.group_id)
      returning * into n;
      if m.organiser_id = any (v_regulars) then
        insert into public.match_players (match_id, user_id, status) values (n.id, m.organiser_id, 'confirmed');
      end if;
      for r in select u from unnest(v_regulars) u where u <> m.organiser_id loop
        perform public.notify(r.u, n, 'repeat', n.title || ' is open', public.when_label(n) || ' · Tap to join.');
      end loop;
      made := made + 1;
    end loop;
  end loop;
  return made;
end $$;

-- Repeat is for the whole series. Turning it on makes the next weeks straight away;
-- turning it off removes later weeks nobody else has joined (no booking, no costs).
create or replace function public.set_repeat(p_match uuid, p_weekly boolean, p_regulars_first boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  m public.matches := public.lock_match(p_match);
  v_series uuid := coalesce(m.series_id, m.id);
begin
  perform public.require_organiser(m);
  if coalesce(p_weekly, false) then
    update public.matches set repeat_weekly = true, regulars_first = false
     where coalesce(series_id, id) = v_series and starts_at >= m.starts_at;
    perform public.roll_recurring(now(), v_series);
  else
    update public.matches set repeat_weekly = false, regulars_first = false where coalesce(series_id, id) = v_series;
    delete from public.matches x
     where coalesce(x.series_id, x.id) = v_series and x.starts_at > m.starts_at and x.starts_at > now()
       and not exists (select 1 from public.match_players mp where mp.match_id = x.id and mp.user_id <> x.organiser_id)
       and not exists (select 1 from public.match_courts c where c.match_id = x.id)
       and not exists (select 1 from public.expenses e where e.match_id = x.id)
       and not exists (select 1 from public.games g where g.match_id = x.id);
  end if;
end $$;

-- Existing weekly series: the repeat now shows on every upcoming week, not just the newest.
update public.matches x set repeat_weekly = true
 where not x.repeat_weekly and x.starts_at > now() - interval '1 day'
   and exists (select 1 from public.matches h
                where coalesce(h.series_id, h.id) = coalesce(x.series_id, x.id) and h.repeat_weekly);

-- Make next week's matches now rather than at the next 5-minute run.
do $$ begin perform public.roll_recurring(); end $$;

revoke all on function public.roll_recurring(timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.set_repeat(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_repeat(uuid, boolean, boolean) to authenticated;
revoke all on function public.my_players(uuid) from public, anon;
grant execute on function public.my_players(uuid) to authenticated;
