-- 1. Merge a guest into the real account it duplicates (someone typed a name before
--    that person joined), so their games, matches and money become one person.
-- 2. Balances: say which guests each match's sponsor should collect from.
-- Run once, after 0023. Safe to run again.

do $$ begin
  if to_regprocedure('public.log_games(uuid, uuid, jsonb)') is null then
    raise exception 'Run 0023_log_games_edit.sql first, then this file.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Merge
-- ---------------------------------------------------------------------------

create or replace function public.merge_player(p_from uuid, p_into uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  g public.profiles;
  r public.profiles;
  clash int;
  s record;
begin
  select * into g from public.profiles where id = p_from for update;
  select * into r from public.profiles where id = p_into;
  if g.id is null or r.id is null then raise exception 'Player not found'; end if;
  if p_from = p_into then raise exception 'Pick someone else to merge into'; end if;
  if not g.is_guest then raise exception 'Only a guest can be merged into someone'; end if;
  if r.is_guest then raise exception 'Merge into a real account, not another guest'; end if;
  -- The guest's creator, or the owner of a group they're both in.
  if me is distinct from g.created_by and not exists (
       select 1 from public.group_members o
         join public.group_members a on a.group_id = o.group_id and a.user_id = p_from
         join public.group_members b on b.group_id = o.group_id and b.user_id = p_into
        where o.user_id = me and o.role = 'owner') then
    raise exception 'Only the group owner can merge players';
  end if;

  select count(*) into clash from public.games
   where p_from in (a1, a2, b1, b2) and p_into in (a1, a2, b1, b2);
  if clash > 0 then
    raise exception 'They played in the same game % time(s). Fix or remove those results first', clash;
  end if;
  select count(*) into clash from public.planned_games
   where game_id is null and p_from in (a1, a2, b1, b2) and p_into in (a1, a2, b1, b2);
  if clash > 0 then raise exception 'They''re in the same planned game. Change the game plan first'; end if;

  update public.games set a1 = p_into where a1 = p_from;
  update public.games set a2 = p_into where a2 = p_from;
  update public.games set b1 = p_into where b1 = p_from;
  update public.games set b2 = p_into where b2 = p_from;
  update public.games set created_by = p_into where created_by = p_from;
  update public.planned_games set a1 = p_into where a1 = p_from;
  update public.planned_games set a2 = p_into where a2 = p_from;
  update public.planned_games set b1 = p_into where b1 = p_from;
  update public.planned_games set b2 = p_into where b2 = p_from;
  update public.planned_games set created_by = p_into where created_by = p_from;

  -- In the same match twice: keep the real one's place.
  delete from public.match_players mp where mp.user_id = p_from
     and exists (select 1 from public.match_players x where x.match_id = mp.match_id and x.user_id = p_into);
  update public.match_players set user_id = p_into where user_id = p_from;
  update public.match_players set added_by = p_into where added_by = p_from;
  delete from public.match_history h where h.user_id = p_from
     and exists (select 1 from public.match_history x where x.match_id = h.match_id and x.user_id = p_into);
  update public.match_history set user_id = p_into where user_id = p_from;
  delete from public.match_liable l where l.user_id = p_from
     and exists (select 1 from public.match_liable x where x.match_id = l.match_id and x.user_id = p_into);
  update public.match_liable set user_id = p_into where user_id = p_from;
  update public.expenses set paid_by = p_into where paid_by = p_from;
  update public.match_courts set booked_by = p_into where booked_by = p_from;
  update public.matches set organiser_id = p_into where organiser_id = p_from;
  update public.matches set regulars = array_replace(regulars, p_from, p_into) where p_from = any (regulars);
  update public.profiles set created_by = p_into where created_by = p_from;

  insert into public.group_members (group_id, user_id, role)
  select group_id, p_into, 'member' from public.group_members where user_id = p_from
  on conflict do nothing;
  delete from public.group_members where user_id = p_from;

  -- Settlements: move each, adding up where the real one already has the same pair.
  for s in select * from public.settlements where p_from in (from_user, to_user) loop
    delete from public.settlements where match_id = s.match_id and from_user = s.from_user and to_user = s.to_user;
    continue when (case when s.from_user = p_from then p_into else s.from_user end)
                = (case when s.to_user = p_from then p_into else s.to_user end);
    insert into public.settlements (match_id, from_user, to_user, amount, settled_by, settled_at)
    values (s.match_id, case when s.from_user = p_from then p_into else s.from_user end,
            case when s.to_user = p_from then p_into else s.to_user end, s.amount,
            case when s.settled_by = p_from then p_into else s.settled_by end, s.settled_at)
    on conflict (match_id, from_user, to_user) do update set amount = public.settlements.amount + excluded.amount;
  end loop;
  update public.settlements set settled_by = p_into where settled_by = p_from;

  delete from public.notifications where user_id = p_from;
  delete from public.push_subscriptions where user_id = p_from;
  delete from public.email_outbox where user_id = p_from;
  delete from public.profiles where id = p_from;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Ledger: guests in each match and who added them
-- ---------------------------------------------------------------------------

create or replace function public.my_ledger() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'slug', m.slug, 'title', m.title, 'starts_at', m.starts_at,
    'timezone', m.timezone, 'currency', m.currency,
    'group_id', m.group_id, 'group_name', (select name from public.groups where id = m.group_id),
    'players', to_jsonb(public.split_ids(m.id)),
    'expenses', (select coalesce(jsonb_agg(jsonb_build_object('amount', amount, 'paid_by', paid_by)), '[]'::jsonb)
                   from public.expenses where match_id = m.id),
    'settlements', (select coalesce(jsonb_agg(jsonb_build_object('from', from_user, 'to', to_user, 'amount', amount)), '[]'::jsonb)
                      from public.settlements where match_id = m.id),
    -- Guest → who pays their share (and should collect it from them).
    'guests', (select coalesce(jsonb_object_agg(h.id, public.payer_for(m, h.id)), '{}'::jsonb)
                 from unnest(public.share_holders(m.id)) h(id) join public.profiles p on p.id = h.id
                where p.is_guest),
    'people', (select coalesce(jsonb_object_agg(p.id, p.full_name), '{}'::jsonb) from public.profiles p
                where p.id in (select paid_by from public.expenses where match_id = m.id
                               union select unnest(public.split_ids(m.id))
                               union select unnest(public.share_holders(m.id))))
  ) order by m.starts_at desc), '[]'::jsonb)
  from public.matches m
  where public.split_ready(m.id)
    and (m.organiser_id = auth.uid() or auth.uid() = any (public.split_ids(m.id))
         -- Paid for something (e.g. booked a court) and then dropped out: still owed.
         or exists (select 1 from public.expenses e where e.match_id = m.id and e.paid_by = auth.uid()));
$$;

revoke all on function public.merge_player(uuid, uuid) from public, anon;
grant execute on function public.merge_player(uuid, uuid) to authenticated;
revoke all on function public.my_ledger() from public, anon;
grant execute on function public.my_ledger() to authenticated;
