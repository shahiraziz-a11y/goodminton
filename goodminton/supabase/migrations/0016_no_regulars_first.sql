-- "Regulars first" is gone: anyone can take a free spot straight away, in every match.
-- Weekly matches still repeat, and last week's players are still told when next week's opens.
-- People waiting only because of a regulars window move into free spots now, in order.
-- The waitlist for a full match is unchanged.
-- Run once, after 0015. Safe to run again.

do $$ begin
  if to_regprocedure('public.my_stats()') is null then
    raise exception 'Run 0015_home_streak.sql first, then this file.';
  end if;
end $$;

-- Weekly copies are made from the match before them, so with this off no window is ever set again.
update public.matches set regulars_first = false, regulars_until = null
 where regulars_first or regulars_until is not null;
alter table public.matches alter column regulars_first set default false;

-- Release anyone stuck waiting while there's room.
do $$ declare m public.matches;
begin
  for m in select * from public.matches x
            where not public.match_past(x)
              and exists (select 1 from public.match_players where match_id = x.id and status = 'waitlist') loop
    perform public.fill_from_waitlist(m);
  end loop;
end $$;

-- p_regulars_first is kept so older app versions keep working; it's ignored.
create or replace function public.set_repeat(p_match uuid, p_weekly boolean, p_regulars_first boolean) returns void
language plpgsql security definer set search_path = public as $$
declare m public.matches := public.lock_match(p_match);
begin
  perform public.require_organiser(m);
  update public.matches set repeat_weekly = coalesce(p_weekly, false), regulars_first = false where id = m.id;
end $$;

create or replace function public.join_match(p_match uuid, p_court int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  m public.matches := public.lock_match(p_match);
  n_conf int;
  n_wait int;
  c int;
begin
  if exists (select 1 from public.match_players where match_id = m.id and user_id = me) then
    raise exception 'You''re already in this match';
  end if;
  if public.match_past(m) then raise exception 'This match has already been played'; end if;
  if public.match_locked(m) and me <> m.organiser_id then raise exception 'Sign-ups are closed'; end if;

  select count(*) filter (where status = 'confirmed'), count(*) filter (where status = 'waitlist')
    into n_conf, n_wait from public.match_players where match_id = m.id;

  if n_conf < m.size then
    -- The tapped court if it still has room; null lets assign_court pick one.
    if p_court between 1 and m.court_count
       and (select count(*) from public.match_players
             where match_id = m.id and status = 'confirmed' and court = p_court) < public.per_court(m) then
      c := p_court;
    end if;
    insert into public.match_players (match_id, user_id, status, court) values (m.id, me, 'confirmed', c)
    returning court into c;
    return jsonb_build_object('status', 'confirmed', 'filled', n_conf + 1 = m.size, 'court', c);
  end if;
  insert into public.match_players (match_id, user_id, status) values (m.id, me, 'waitlist');
  return jsonb_build_object('status', 'waitlist', 'position', n_wait + 1, 'filled', false);
end $$;

revoke all on function public.set_repeat(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_repeat(uuid, boolean, boolean) to authenticated;
revoke all on function public.join_match(uuid, int) from public, anon;
grant execute on function public.join_match(uuid, int) to authenticated;
