-- Log results faster: several games in one go, and fix a result instead of deleting it.
-- Run once, after 0022. Safe to run again.

do $$ begin
  if to_regprocedure('public.people_photos()') is null then
    raise exception 'Run 0022_photos_work_accounts.sql first, then this file.';
  end if;
end $$;

-- Several games at once (all or nothing). Each one goes through log_game's checks.
-- p_games: [{ "a1", "a2", "b1", "b2", "winner", "score_a", "score_b" }, ...]
create or replace function public.log_games(p_match uuid, p_group uuid, p_games jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  x jsonb;
  n int := 0;
begin
  perform public.require_user();
  if jsonb_typeof(p_games) is distinct from 'array' or jsonb_array_length(p_games) = 0 then
    raise exception 'Add a game first';
  end if;
  if jsonb_array_length(p_games) > 30 then raise exception 'Up to 30 games at a time'; end if;
  for x in select * from jsonb_array_elements(p_games) loop
    n := n + 1;
    begin
      perform public.log_game(p_match, (x ->> 'a1')::uuid, (x ->> 'a2')::uuid, (x ->> 'b1')::uuid, (x ->> 'b2')::uuid,
                              x ->> 'winner', (x ->> 'score_a')::int, (x ->> 'score_b')::int, p_group);
    exception when others then
      raise exception 'Game %: %', n, sqlerrm;
    end;
  end loop;
  return n;
end $$;

-- Change who played, who won or the score. Same people as delete_game may do it;
-- the game keeps its date, group and place in the game plan.
create or replace function public.edit_game(p_game uuid, p_a1 uuid, p_a2 uuid, p_b1 uuid, p_b2 uuid, p_winner text,
  p_score_a int default null, p_score_b int default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.require_user();
  g public.games;
  ids uuid[] := array_remove(array[p_a1, p_a2, p_b1, p_b2], null);
begin
  select * into g from public.games where id = p_game for update;
  if not found then raise exception 'Game not found'; end if;
  if me <> g.created_by and me is distinct from (select organiser_id from public.matches where id = g.match_id) then
    raise exception 'Only the person who logged it can change it';
  end if;
  if p_winner not in ('a', 'b') then raise exception 'Tap the side that won'; end if;
  if (p_score_a is null) <> (p_score_b is null) then raise exception 'Enter both scores, or neither'; end if;
  if p_score_a is not null and (p_score_a not between 0 and 99 or p_score_b not between 0 and 99) then
    raise exception 'Scores are 0 to 99';
  end if;
  if p_score_a is not null and (p_score_a = p_score_b or (p_score_a > p_score_b) <> (p_winner = 'a')) then
    raise exception 'The winning side needs the higher score';
  end if;
  if (p_a2 is null) <> (p_b2 is null) or p_a1 is null or p_b1 is null then
    raise exception 'Pick the same number of players on each side';
  end if;
  if (select count(distinct x) from unnest(ids) x) <> array_length(ids, 1) then
    raise exception 'Someone is on the court twice';
  end if;
  if g.match_id is not null then
    if (select count(*) from public.match_players
         where match_id = g.match_id and status = 'confirmed' and user_id = any (ids)) <> array_length(ids, 1) then
      raise exception 'All players must be confirmed in this match';
    end if;
  elsif exists (select x from unnest(ids) x where not public.is_member(g.group_id, x)) then
    raise exception 'Everyone in the game must be in the group';
  end if;
  update public.games set a1 = p_a1, a2 = p_a2, b1 = p_b1, b2 = p_b2, winner = p_winner,
                          score_a = p_score_a, score_b = p_score_b
   where id = g.id;
end $$;

revoke all on function public.log_games(uuid, uuid, jsonb) from public, anon;
grant execute on function public.log_games(uuid, uuid, jsonb) to authenticated;
revoke all on function public.edit_game(uuid, uuid, uuid, uuid, uuid, text, int, int) from public, anon;
grant execute on function public.edit_game(uuid, uuid, uuid, uuid, uuid, text, int, int) to authenticated;
