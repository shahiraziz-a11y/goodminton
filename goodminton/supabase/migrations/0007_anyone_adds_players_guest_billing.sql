-- Anyone in a match can add players; a guest's share is billed to whoever added them.
-- Costs are split only once the court is booked with a cost.
-- Run once, after 0006.

alter table public.match_players add column added_by uuid references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Who owes vs who pays
-- ---------------------------------------------------------------------------

-- People who owe a share: confirmed players plus removed-after-booking players still
-- covering an empty spot (most recently removed first). Guests appear as themselves.
create function public.share_holders(p_match uuid) returns uuid[]
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

-- Who pays for a person in a match: themselves, or for a guest (no login) whoever
-- added them to this match, else whoever created the guest, else the organiser.
create function public.payer_for(m public.matches, p_user uuid) returns uuid
language sql stable set search_path = public as $$
  select case when not p.is_guest then p.id
              else coalesce(
                (select mp.added_by from public.match_players mp where mp.match_id = m.id and mp.user_id = p_user),
                p.created_by, m.organiser_id) end
    from public.profiles p where p.id = p_user;
$$;

-- The cost split, one entry per share, listing who pays it (a sponsor can appear twice).
create or replace function public.split_ids(p_match uuid) returns uuid[]
language sql stable set search_path = public as $$
  select coalesce(array_agg(public.payer_for(m, h.id) order by h.ord), '{}')
    from public.matches m, unnest(public.share_holders(p_match)) with ordinality as h(id, ord)
   where m.id = p_match;
$$;

create or replace function public.prune_debts(p_match uuid) returns void
language sql set search_path = public as $$
  delete from public.match_liable
   where match_id = p_match and not (user_id = any (public.share_holders(p_match)));
  delete from public.match_liable l
   where l.match_id = p_match
     and exists (select 1 from public.match_players mp
                  where mp.match_id = p_match and mp.user_id = l.user_id and mp.status = 'confirmed');
$$;

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
       where l.match_id = m.id and l.user_id = any (public.share_holders(m.id))
         and not exists (select 1 from public.match_players mp
                          where mp.match_id = m.id and mp.user_id = l.user_id and mp.status = 'confirmed')), '[]'::jsonb) end,
    'split_ids', case when can_see then to_jsonb(public.split_ids(m.id)) end,
    'split_ready', m.status = 'booked' and m.court_cost > 0,
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
                      union select public.payer_for(m, mp.user_id) from public.match_players mp
                       where mp.match_id = m.id)), '{}'::jsonb) end
  );
end $$;

-- Balances: only booked matches with a court cost; guests are billed to their sponsor.
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
  where m.status = 'booked' and m.court_cost > 0
    and (m.organiser_id = auth.uid() or auth.uid() = any (public.split_ids(m.id)));
$$;

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

-- The organiser or anyone confirmed can add someone from their circle, or a guest by name.
create or replace function public.add_player(p_match uuid, p_user uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  m public.matches := public.lock_match(p_match);
  v_user uuid := p_user;
  n_conf int;
  n_wait int;
begin
  if me <> m.organiser_id and not exists (
    select 1 from public.match_players where match_id = m.id and user_id = me and status = 'confirmed') then
    raise exception 'Join the match first to add players';
  end if;
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
    insert into public.match_players (match_id, user_id, status, added_by) values (m.id, v_user, 'confirmed', me);
    return jsonb_build_object('status', 'confirmed', 'filled', n_conf + 1 = m.size);
  end if;
  insert into public.match_players (match_id, user_id, status, added_by) values (m.id, v_user, 'waitlist', me);
  return jsonb_build_object('status', 'waitlist', 'position', n_wait + 1, 'filled', false);
end $$;

-- The organiser can remove anyone; whoever added a player can remove that player.
create or replace function public.remove_player(p_match uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  m public.matches := public.lock_match(p_match);
  v_status text;
  v_added_by uuid;
  promoted uuid[];
begin
  if p_user = m.organiser_id then raise exception 'The organiser can''t be removed'; end if;
  select status, added_by into v_status, v_added_by from public.match_players where match_id = m.id and user_id = p_user;
  if v_status is null then raise exception 'That player isn''t in this match'; end if;
  if me <> m.organiser_id and me is distinct from v_added_by then
    raise exception 'Only the organiser or whoever added them can remove a player';
  end if;
  delete from public.match_players where match_id = m.id and user_id = p_user;
  if v_status = 'confirmed' and m.status = 'booked' then
    insert into public.match_liable (match_id, user_id) values (m.id, p_user)
    on conflict (match_id, user_id) do update set created_at = now();
  end if;
  if v_status = 'confirmed' then promoted := public.fill_from_waitlist(m); end if;
  return jsonb_build_object('status', v_status, 'still_owes', p_user = any (public.share_holders(m.id)),
    'promoted', (select full_name from public.profiles where id = promoted[1]));
end $$;

-- Expenses are added once the court is booked with a cost, so splits start from real numbers.
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
  if m.status <> 'booked' or m.court_cost <= 0 then
    raise exception 'Costs are split once the court is booked and its cost is entered';
  end if;
  insert into public.expenses (match_id, label, amount, paid_by) values (m.id, btrim(p_label), p_amount, me);
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
        m.size || '/' || m.size || ' confirmed.' || case when m.status = 'planning' then ' Time to book the court.' else '' end);
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
      || case when old.status = 'confirmed' and m.status = 'booked'
              then ' The court is booked, so you still owe your share unless someone takes your spot.' else '' end);
  end if;
  return null;
end $$;

revoke all on function public.share_holders(uuid) from public, anon, authenticated;
revoke all on function public.payer_for(public.matches, uuid) from public, anon, authenticated;
revoke all on function public.split_ids(uuid) from public, anon, authenticated;
revoke all on function public.prune_debts(uuid) from public, anon, authenticated;
revoke all on function public.on_player_change() from public, anon, authenticated;
revoke all on function public.get_match(text) from public;
grant execute on function public.get_match(text) to anon, authenticated;
revoke all on function public.my_ledger() from public, anon;
grant execute on function public.my_ledger() to authenticated;
revoke all on function public.add_player(uuid, uuid, text) from public, anon;
grant execute on function public.add_player(uuid, uuid, text) to authenticated;
revoke all on function public.remove_player(uuid, uuid) from public, anon;
grant execute on function public.remove_player(uuid, uuid) to authenticated;
revoke all on function public.add_expense(uuid, text, numeric) from public, anon;
grant execute on function public.add_expense(uuid, text, numeric) to authenticated;
