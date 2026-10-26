-- 1. Extra players: the organiser can let up to 2 waitlisted people onto a court beyond its size
--    (6 rotating on a doubles court, 4 on singles). They share the cost like everyone else.
-- 2. Costs are split once sign-ups close (the automatic lock, or "Lock now"), or once the
--    match starts if sign-ups were reopened. Until then nobody owes anything.
-- Run once, after 0017. Safe to run again.

do $$ begin
  if to_regprocedure('public.my_groups()') is null then
    raise exception 'Run 0017_groups.sql first, then this file.';
  end if;
end $$;

alter table public.match_players add column if not exists extra boolean not null default false;

-- Split only once the line-up is final.
create or replace function public.split_ready(p_match uuid) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from public.match_courts where match_id = p_match and cost > 0)
     and exists (select 1 from public.matches m where m.id = p_match and (public.match_locked(m) or now() >= m.starts_at));
$$;

-- Extra costs (shuttles etc.) can be added once a court is booked; they're shared when the split happens.
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
  if not exists (select 1 from public.match_courts where match_id = m.id and cost > 0) then
    raise exception 'Add costs once a court is booked and its cost is entered';
  end if;
  insert into public.expenses (match_id, label, amount, paid_by) values (m.id, btrim(p_label), p_amount, me);
end $$;

-- Organiser only: a waitlisted person plays on a court as an extra (rotating).
create or replace function public.allow_extra(p_match uuid, p_user uuid, p_court int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.matches := public.lock_match(p_match);
  c int := p_court;
  n int;
begin
  perform public.require_organiser(m);
  if public.match_past(m) then raise exception 'This match has already been played'; end if;
  if not exists (select 1 from public.match_players where match_id = m.id and user_id = p_user and status = 'waitlist') then
    raise exception 'They''re not on the waitlist';
  end if;
  if c is null and m.court_count = 1 then c := 1; end if;
  if c is null or c not between 1 and m.court_count then raise exception 'Pick a court'; end if;
  select count(*) into n from public.match_players where match_id = m.id and status = 'confirmed' and court = c;
  if n >= public.per_court(m) + 2 then raise exception 'Court % already has 2 extra players', c; end if;
  update public.match_players set status = 'confirmed', court = c, extra = n >= public.per_court(m), promoted = true,
         seq = nextval('public.match_players_seq')
   where match_id = m.id and user_id = p_user;
  return jsonb_build_object('court', c, 'on_court', n + 1);
end $$;

-- "Extra" only means something while the court is over its size.
create or replace function public.tidy_extras() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_match uuid := coalesce(new.match_id, old.match_id); m public.matches;
begin
  select * into m from public.matches where id = v_match;
  if m.id is null then return null; end if;
  -- Keep the flag on the latest extras only, as many as the court is over its size.
  with n as (select court, count(*) as k from public.match_players
              where match_id = v_match and status = 'confirmed' group by court),
  keep as (select user_id from (
             select x.user_id, n.k, row_number() over (partition by x.court order by x.seq desc) as rn
               from public.match_players x join n on n.court = x.court
              where x.match_id = v_match and x.extra and x.status = 'confirmed') s
            where rn <= k - public.per_court(m))
  update public.match_players set extra = false
   where match_id = v_match and extra and user_id not in (select user_id from keep);
  return null;
end $$;
drop trigger if exists match_players_tidy_extras on public.match_players;
create trigger match_players_tidy_extras after delete or update of status, court on public.match_players
  for each row execute function public.tidy_extras();

create or replace function public.get_match(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
             else jsonb_build_object('hidden', true) end || jsonb_build_object('court', mp.court, 'extra', mp.extra) order by mp.court, mp.seq)
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
    'group', (select jsonb_build_object('id', g.id, 'name', g.name) from public.groups g where g.id = m.group_id),
    'is_member', me is not null and exists (select 1 from public.group_members where group_id = m.group_id and user_id = me),
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
end $function$;

revoke all on function public.allow_extra(uuid, uuid, integer), public.tidy_extras(), public.split_ready(uuid) from public, anon, authenticated;
grant execute on function public.allow_extra(uuid, uuid, integer) to authenticated;
revoke all on function public.get_match(text) from public;
grant execute on function public.get_match(text) to anon, authenticated;
