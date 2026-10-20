-- Tap an open spot on a court to join: join_match takes an optional court, and the
-- player goes on that court when it still has room (otherwise the usual free court).
-- Run once, after 0013. Safe to run again.

do $$ begin
  if to_regprocedure('public.get_email_updates()') is null then
    raise exception 'Run 0013_email_updates.sql first, then this file.';
  end if;
end $$;

drop function if exists public.join_match(uuid);

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

  -- A weekly match's regulars get first dibs: others wait until the window ends.
  if m.regulars_until is not null and now() < m.regulars_until and me <> m.organiser_id and not (me = any (m.regulars)) then
    insert into public.match_players (match_id, user_id, status) values (m.id, me, 'waitlist');
    return jsonb_build_object('status', 'waitlist', 'position', n_wait + 1, 'filled', false, 'regulars_until', m.regulars_until);
  end if;
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

revoke all on function public.join_match(uuid, int) from public, anon;
grant execute on function public.join_match(uuid, int) to authenticated;
