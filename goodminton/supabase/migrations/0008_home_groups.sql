-- Home screen groups (in progress / upcoming / completed / called off).
-- my_matches also returns whether the match has started, the court numbers for
-- confirmed players, and who won the latest game logged for it.
-- Run once, after 0007.

create or replace function public.my_matches() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.past, case when x.past then null else x.starts_at end, x.starts_at desc), '[]'::jsonb)
  from (
    select m.slug, m.title, m.venue, m.size, m.format, m.court_count, m.starts_at, m.duration_min, m.timezone, m.status,
           now() >= m.starts_at as started,
           public.match_past(m) as past, public.match_locked(m) as locked,
           (select count(*) from public.match_players where match_id = m.id and status = 'confirmed') as confirmed_count,
           (select count(*) from public.match_players where match_id = m.id and status = 'waitlist') as waitlist_count,
           case when m.organiser_id = auth.uid()
                  or exists (select 1 from public.match_players where match_id = m.id and user_id = auth.uid() and status = 'confirmed')
                then m.courts end as courts,
           (select count(*) from public.games where match_id = m.id) as games_count,
           (select string_agg(public.first_name(w), ' & ')
              from (select g.* from public.games g where g.match_id = m.id order by g.created_at desc limit 1) g,
                   unnest(case when g.winner = 'a' then array[g.a1, g.a2] else array[g.b1, g.b2] end) w
             where w is not null) as last_winners
      from public.matches m
     where m.organiser_id = auth.uid()
        or exists (select 1 from public.match_players where match_id = m.id and user_id = auth.uid())
  ) x;
$$;
